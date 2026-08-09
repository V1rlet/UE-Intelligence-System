// Graph Brain / core/annotation - 标注陈旧检测（P4U3）：节点源文件 hash 采集与比对
//
// 机制：标注创建/更新/复核时记录节点源文件的 sha1（source_hash）；扫描时重算比对，
// 不匹配（或源文件已消失）置 stale=true，匹配则清除 stale（幂等，可反复跑）。
// 无 source_hash 的存量标注跳过——通过面板"已复核"补挂 hash 后纳入检测。
//
// 节点 → 源文件解析顺序（取第一个存在的候选）：
//   1. 各 source_root（meta，";" 分隔）+ node.source_path —— 项目层文件
//   2. 解析缓存的 engine_root + Engine/Source + node.source_path —— 引擎层文件
//      （直读 data/cache/ 的 JSON，不 import adapter 代码，保持 core 领域无关；
//        字段契约见 adapters/ue5-code/parse-cache.ts 的 ParseCache）
//   3. 节点无 source_path 时无法建立代码证据，返回 null。

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { graphSourceRoots } from "../schema/graph-version.js";
import { resolveGraphBrainProjectRoot } from "../source/project-root.js";
import { loadReadingContext, ReadingContextConflictError } from "../reading-context/store.js";
import { resolveCurrentGraphArtifact } from "../store/data-publication.js";
import { type AnnotationDocument, type AnnotationEntry, loadAnnotationDocument, saveAnnotations } from "./store.js";

const ROOT = resolveGraphBrainProjectRoot(import.meta.url, "..", "..");
const GRAPHS_DIR = join(ROOT, "data", "graphs");
const CACHE_DIR = join(ROOT, "data", "cache");
const PUBLICATIONS_DIR = join(ROOT, "data", "publications");

interface GraphNodeLite {
	data: { id: string; source_path?: string; [key: string]: unknown };
}

interface GraphLite {
	meta: Record<string, unknown>;
	elements: { nodes: GraphNodeLite[] };
}

function sha1(content: string): string {
	return createHash("sha1").update(content).digest("hex");
}

/** Exact published generation, with one legacy-catalog fallback for old repositories. */
export function latestGraphFile(domain: string, subsystem: string): string | null {
	if (domain !== "ue5_code") return null;
	return resolveCurrentGraphArtifact({ graphs: GRAPHS_DIR, publications: PUBLICATIONS_DIR }, subsystem)?.file ?? null;
}

function loadGraph(domain: string, subsystem: string): GraphLite | null {
	const file = latestGraphFile(domain, subsystem);
	if (!file) return null;
	return JSON.parse(readFileSync(join(GRAPHS_DIR, file), "utf-8").replace(/^﻿/, "")) as GraphLite;
}

function engineSourceRootFromCache(subsystem: string): string | null {
	// 解析缓存目录缺失（全新 checkout）时不做引擎 hash 判定，扫描不应崩溃。
	if (!existsSync(CACHE_DIR)) return null;
	// 引擎根是全局事实（不随 subsystem 变）：先查本子系统缓存，缺失时
	// fallback 到任意 ue5_code_*.parse-cache.json（reference 图无专属缓存，
	// 其 engine_root 由 project 图缓存携带——R1 修复：reference 标注此前永远无法检测）。
	const candidates = [`ue5_code_${subsystem}.parse-cache.json`, ...readdirSync(CACHE_DIR).filter((f) => /^ue5_code_.*\.parse-cache\.json$/.test(f) && f !== `ue5_code_${subsystem}.parse-cache.json`)];
	for (const name of candidates) {
		const cachePath = join(CACHE_DIR, name);
		if (!existsSync(cachePath)) continue;
		try {
			const cache = JSON.parse(readFileSync(cachePath, "utf-8")) as { engine_root?: string | null };
			if (cache.engine_root) return cache.engine_root;
		} catch {
			continue;
		}
	}
	return null;
}

/** 解析 ue5_code 节点当前源文件的 hash；非代码域或定位不到时返回 null。 */
export function resolveNodeSourceHash(
	domain: string,
	subsystem: string,
	nodeId: string,
	graph?: GraphLite | null,
): string | null {
	if (domain !== "ue5_code") return null;
	const g = graph !== undefined ? graph : loadGraph(domain, subsystem);
	if (!g) return null;
	const roots = graphSourceRoots(g.meta);
	const node = g.elements.nodes.find((n) => n.data.id === nodeId);
	const candidates: string[] = [];
	if (node?.data.source_path) {
		for (const root of roots) candidates.push(resolve(root, node.data.source_path));
		const engineRoot = engineSourceRootFromCache(subsystem);
		if (engineRoot) {
			// 引擎类 source_path 自带 Engine/Source 前缀（reference 图），项目类不带。
			// 引擎根是裸根（G:/Epic Games/UE_5.8），按前缀决定拼接层级。
			const sourcePath = node.data.source_path;
			if (sourcePath.startsWith("Engine/")) candidates.push(resolve(engineRoot, sourcePath));
			else candidates.push(resolve(join(engineRoot, "Engine", "Source"), sourcePath));
		}
	}

	for (const c of candidates) {
		if (existsSync(c)) return sha1(readFileSync(c, "utf-8"));
	}
	return null;
}

export interface ScanResult {
	domain: string;
	subsystem: string;
	/** 有 source_hash、参与比对的标注数 */
	checked: number;
	/** 本次扫描后处于 stale 的标注数 */
	stale: number;
	/** 无 source_hash 跳过的存量标注数 */
	skipped: number;
	/** 本次扫描是否改动并写回了 reading-context */
	changed: boolean;
}

/** 基于一份文档快照计算 stale 标记（纯函数，不写回）。 */
function computeStale(document: AnnotationDocument, subsystem: string, graph: GraphLite | null): { result: ScanResult; entries: AnnotationEntry[] } {
	const entries: AnnotationEntry[] = document.entries;
	const result: ScanResult = { domain: entries[0]?.domain ?? "ue5_code", subsystem, checked: 0, stale: 0, skipped: 0, changed: false };
	const hashByNode = new Map<string, string | null>();

	for (const entry of entries) {
		let hash = hashByNode.get(entry.node_id);
		if (hash === undefined) {
			hash = resolveNodeSourceHash(entry.domain, subsystem, entry.node_id, graph);
			hashByNode.set(entry.node_id, hash);
		}
		for (const ann of entry.annotations) {
			if (!ann.source_hash) {
				result.skipped++;
				continue;
			}
			result.checked++;
			const isStale = hash === null || hash !== ann.source_hash;
			if (isStale) result.stale++;
			if ((ann.stale ?? false) !== isStale) {
				if (isStale) ann.stale = true;
				else delete ann.stale;
				result.changed = true;
			}
		}
	}
	return { result, entries };
}

/**
 * 扫描一个标注子系统：比对 source_hash 与当前源文件，写回 stale 标记。
 * 与用户正在写入 reading-context 冲突时最多重试 3 次；每次重试都重新读取最新
 * 文档并重新计算，绝不复用旧 draft 或覆盖并发写入的新标注。
 */
export function scanStale(domain: string, subsystem: string): ScanResult {
	const graph = loadGraph(domain, subsystem);
	let document = loadAnnotationDocument(domain, subsystem);
	for (let attempt = 0; ; attempt += 1) {
		const { result, entries } = computeStale(document, subsystem, graph);
		if (!result.changed) return result;
		try {
			saveAnnotations(domain, subsystem, entries, document.revision);
			return result;
		} catch (error) {
			if (!(error instanceof ReadingContextConflictError) || attempt >= 2) throw error;
			// 冲突：并发写入了新标注。重新读取最新文档后重新计算 stale 再写。
			document = loadAnnotationDocument(domain, subsystem);
		}
	}
}

/** 扫描 canonical reading-context 中所有拥有标注的 subsystem。 */
export function scanAllStale(): ScanResult[] {
	const document = loadReadingContext("ue5_code");
	const subsystems = [...new Set(document.annotations.map((entry) => entry.subsystem))].sort();
	return subsystems.map((subsystem) => scanStale(document.domain, subsystem));
}
