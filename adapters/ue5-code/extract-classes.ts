// Graph Brain / adapters/ue5-code - 项目图提取器 CLI（管线本体在 extract-classes-lib.ts）
//
// 用法：
//   npx tsx adapters/ue5-code/extract-classes.ts <SourceDir...> [--out data/graphs]
//       [--subsystem project] [--uproject <path>] [--no-engine]
//       [--incremental] [--cache <path>]
//
// 全量（默认）：全部重解析，写图 + 重写解析缓存（data/cache/，供增量与 adapter.diff 用）
// 增量（--incremental）：消费缓存只重解析变更文件，与 outDir 里最新同 subsystem 图
// 比对打印 diff 摘要，写新图 + 更新缓存。产物与全量重建逐字节一致（组装共用同一路径）。

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { GraphFile } from "../adapter-interface.js";
import { diffGraphs, summarizeDiff } from "../diff-lib.js";
import { buildChangeReport, checkChangeReportConsistency, hasChangeSummaryFacts, type ChangeReport } from "../../core/query/change-report.js";
import { migratePublishedGraphToEvidenceV3, readEngineAssociation } from "../../core/evidence/migration.js";
import { checkChangeReportSchema, checkGraphReferences, checkGraphSchema, type GraphShape } from "../../core/schema/graph-checks.js";
import {
	DataPublicationConflictError,
	loadDataPublicationState,
	managedArtifactName,
	publishDataGeneration,
	resolveCurrentGraphArtifact,
	sha256,
	type PublicationDirectories,
} from "../../core/store/data-publication.js";
import { loadEvidencePublicationState, publishEvidenceSnapshotPair } from "../../core/store/evidence-publication.js";
import { extractClassGraphWithCache } from "./extract-classes-lib.js";
import { defaultCachePath, loadParseCache, saveParseCache } from "./parse-cache.js";

const argv = process.argv.slice(2);
const roots: string[] = [];
let outDir = "data/graphs";
let subsystem = "project";
let uprojectArg: string | null = null;
let withEngine = true;
let incremental = false;
let cacheArg: string | null = null;
let changesOutDir = "data/changes";
const usage = "用法: npx tsx adapters/ue5-code/extract-classes.ts <SourceDir...> [--out data/graphs] [--subsystem project] [--uproject <path>] [--no-engine] [--incremental] [--cache <path>] [--changes-out data/changes]";
// 取带值参数：值缺失（flag 是最后一个参数）时给 usage 错误，而不是把 undefined
// 一路带进文件路径再以费解的 TypeError 失败。
let i = 0;
const flagValue = (name: string): string => {
	const value = argv[++i];
	if (value === undefined) {
		console.error(`${name} 缺少值\n${usage}`);
		process.exit(2);
	}
	return value;
};
for (; i < argv.length; i++) {
	if (argv[i] === "--out") outDir = flagValue("--out");
	else if (argv[i] === "--subsystem") subsystem = flagValue("--subsystem");
	else if (argv[i] === "--uproject") uprojectArg = flagValue("--uproject");
	else if (argv[i] === "--no-engine") withEngine = false;
	else if (argv[i] === "--incremental") incremental = true;
	else if (argv[i] === "--cache") cacheArg = flagValue("--cache");
	else if (argv[i] === "--changes-out") changesOutDir = flagValue("--changes-out");
	else roots.push(argv[i]);
}
if (roots.length === 0) {
	console.error(usage);
	process.exit(2);
}

const cachePath = cacheArg ?? defaultCachePath(subsystem);

// —— 增量模式：优先读缓存；缺失/版本过旧时安全降级为全量重建 ——
let prior = null;
if (incremental) {
	prior = loadParseCache(cachePath);
	if (!prior) {
		console.warn(`解析缓存缺失或版本过旧（${cachePath}），本次自动全量重建并刷新缓存`);
	}
}

const graphsDirectory = resolve(outDir);
const changesDirectory = resolve(changesOutDir);
const publicationsDirectory = join(dirname(graphsDirectory), "publications");
const publicationDirectories: PublicationDirectories = {
	graphs: graphsDirectory,
	changes: changesDirectory,
	publications: publicationsDirectory,
};
const publicationState = loadDataPublicationState(publicationsDirectory);
const baselineArtifact = resolveCurrentGraphArtifact(publicationDirectories, subsystem);

// —— 提取 ——
let result;
try {
	result = extractClassGraphWithCache(roots, { subsystem, uproject: uprojectArg, withEngine }, prior);
} catch (e) {
	console.error((e as Error).message);
	process.exit(1);
}
const { graph, cache, stats } = result;
let changeReport: ChangeReport | null = null;
const graphErrors = [...checkGraphSchema(graph), ...checkGraphReferences(graph as unknown as GraphShape)];
if (graphErrors.length > 0) {
	console.error(`拒绝发布无效图谱：${graphErrors.join("; ")}`);
	process.exit(1);
}
const graphContent = `${JSON.stringify(graph, null, 2)}\n`;
const graphFile = managedArtifactName(subsystem, sha256(graphContent), "graph");

// —— 增量 diff 摘要（对 outDir 里最新同 subsystem 图） ——
if (incremental) {
	if (baselineArtifact) {
		const old = JSON.parse(
			readFileSync(baselineArtifact.path, "utf-8").replace(/^﻿/, ""),
		) as GraphFile;
		const diff = diffGraphs(old, graph);
		console.log(`增量 diff（对 ${baselineArtifact.file}）：${summarizeDiff(diff)}`);
		for (const n of diff.added.nodes.slice(0, 20)) console.log(`  + 节点 ${n.data.id}`);
		for (const id of diff.removed.nodeIds.slice(0, 20)) console.log(`  - 节点 ${id}`);
		changeReport = buildChangeReport(old, graph, { baselineFile: baselineArtifact.file, currentFile: graphFile });
		if (!hasChangeSummaryFacts(changeReport.summary)) {
			console.log("语义 diff 为空：发布新图 generation，但不制造空变化报告。");
			changeReport = null;
		}
		if (baselineArtifact.source === "legacy-catalog") {
			console.warn(`兼容基线 ${baselineArtifact.file} 只在发布边界读取；不会被猜测写入 version 1 活动清单。`);
		}
	} else {
		console.log(`outDir 无既有 ${subsystem} 图，跳过 diff 摘要`);
	}
}

let changeReportContent: string | null = null;
if (changeReport !== null) {
	const reportErrors = [...checkChangeReportSchema(changeReport), ...checkChangeReportConsistency(changeReport)];
	if (reportErrors.length > 0) {
		console.error(`拒绝发布无效变化报告：${reportErrors.join("; ")}`);
		process.exit(1);
	}
	changeReportContent = `${JSON.stringify(changeReport, null, 2)}\n`;
}

// Cache is a rebuildable acceleration layer. Persist it atomically before the
// publication pointer moves; a cache failure therefore cannot expose a partial
// graph/report generation. 写缓存失败（Windows 上缓存文件被并发占用等）只降级为
// 告警——下次运行安全重建，不该废弃一次可能长达数分钟的提取成果。
try {
	saveParseCache(cachePath, cache);
} catch (error) {
	console.warn(`解析缓存写入失败（下次运行将全量重建）: ${(error as Error).message}`);
}
let published;
try {
	published = publishDataGeneration({
		directories: publicationDirectories,
		subsystem,
		expectedRevision: publicationState.revision,
		graphContent,
		changeReportContent,
	});
} catch (error) {
	if (error instanceof DataPublicationConflictError) {
		// 并发发布（如多个 subsystem 手动运行或 watcher 竞态）：冲突保护已生效、
		// 数据不损坏，仅需友好提示并重试。
		console.error(`publication 已被并发更新（期望 revision ${error.expectedRevision}，实际 ${error.current.revision}）；请重试`);
		process.exit(1);
	}
	throw error;
}
const outPath = join(graphsDirectory, published.generation.graph.file);
if (subsystem === "project") {
	const dataDir = dirname(graphsDirectory);
	const evidenceState = loadEvidencePublicationState(dataDir);
	const pair = migratePublishedGraphToEvidenceV3({
		graph,
		generation: published.generation,
		cache,
		engineAssociation: readEngineAssociation(uprojectArg),
	});
	const evidence = publishEvidenceSnapshotPair({
		dataDir,
		pair,
		expectedRevision: evidenceState.revision,
		compatibilityV2GenerationId: published.generation.id,
	});
	console.log(`Evidence v3 已发布: ${evidence.generation.id}（revision ${evidence.state.revision}，v2 兼容回滚已保留）`);
}
if (published.generation.change_report) {
	console.log(`变化报告已发布: ${join(changesDirectory, published.generation.change_report.file)}`);
}
console.log(`\n已发布 ${outPath}: ${graph.elements.nodes.length} 个节点, ${graph.elements.edges.length} 条边（publication revision ${published.state.revision}）`);
console.log(`解析缓存已更新: ${cachePath}`);
console.log(`[graphbrain-extract-metrics] ${JSON.stringify({
	cache_hit: incremental ? stats.projectCached + stats.engineCached > 0 : false,
	project_cached: stats.projectCached,
	project_parsed: stats.projectParsed,
	engine_cached: stats.engineCached,
	engine_parsed: stats.engineParsed,
})}`);
