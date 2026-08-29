// Graph Brain / tools - C1 上下文包导出（只读派生，不新增事实）
//
// 把某个 subsystem（可再按 module/class 过滤）的代码事实 + 人工标注 + 新鲜度声明
// 导出为带 front-matter 的 Markdown，供 CGS / agent prompt 直接消费。
// 数据来源：core/evidence/resolver（唯一事实边界）+ core/reading-context/store（知识层）；
// 不直读 data/ 内部布局，不发明新语义。front-matter 格式：graphbrain-context-pack/1。
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	evidenceNeighborhood,
	evidenceSymbolDetail,
	searchEvidenceSymbols,
} from "../core/evidence/query.js";
import { EvidenceResolutionError, resolvePublishedEvidence } from "../core/evidence/resolver.js";
import { assessEvidenceAccess } from "../core/evidence/status.js";
import { loadReadingContext } from "../core/reading-context/store.js";
import { readEvidenceStatus } from "../server/evidence.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "data");

function option(name: string): string | null {
	const index = process.argv.indexOf(name);
	return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const subsystem = option("--subsystem") ?? "project";
const moduleFilter = option("--module");
const classFilter = option("--class");
const outArg = option("--out") ?? join(DATA_DIR, "context-packs", `ue5_code_${subsystem}${moduleFilter ? `_${moduleFilter}` : ""}.md`);
const allowNonFresh = process.argv.includes("--allow-nonfresh");

try {
	const status = readEvidenceStatus(DATA_DIR);
	const gate = assessEvidenceAccess(status);
	if (!gate.allowed && !allowNonFresh) {
		console.error(`[export-context] 证据不满足新鲜度门槛（${status.freshness}）。确认要导出旧事实请加 --allow-nonfresh。`);
		process.exit(3);
	}
	const resolved = resolvePublishedEvidence(DATA_DIR);
	const graph = resolved.graph;
	const annotationsByNode = new Map(loadReadingContext("ue5_code", join(DATA_DIR, "annotations"))
		.annotations.filter((entry) => entry.subsystem === subsystem)
		.map((entry) => [entry.node_id, entry.annotations]));
	// 结构性节点（目录/文件/元分组）对 prompt 消费者是噪音：默认剔除，除非 --class 精确点名。
	const STRUCTURAL_TYPES = new Set(["folder", "file", "meta_group"]);
	const symbols = searchEvidenceSymbols(graph, { module: moduleFilter ?? null, limit: 500 }).symbols
		.filter((symbol) => !STRUCTURAL_TYPES.has(symbol.type));
	const selected = classFilter
		? symbols.filter((symbol) => symbol.id === classFilter || symbol.label === classFilter)
		: symbols;
	if (selected.length === 0) throw new Error(`过滤条件下没有命中符号（module=${moduleFilter ?? "*"} class=${classFilter ?? "*"}）`);
	const frontMatter = [
		"format_version: graphbrain-context-pack/1",
		`generated_at: ${new Date().toISOString()}`,
		`subsystem: ${subsystem}`,
		moduleFilter ? `module_filter: ${moduleFilter}` : null,
		classFilter ? `class_filter: ${classFilter}` : null,
		`snapshot_id: ${resolved.snapshot_id}`,
		`publication_revision: ${resolved.publication_revision}`,
		`source_generation: ${resolved.source_v2_generation.graph.file}`,
		`source_sha256: ${resolved.source_v2_generation.graph.sha256}`,
		`engine_association: ${resolved.engine_identity?.engine_association ?? "unknown"}`,
		`freshness: ${status.freshness}`,
		`consumer_gate_allowed: ${gate.allowed}`,
	].filter((line): line is string => line !== null);

	const bodyLines: string[] = [];
	bodyLines.push(`# GraphBrain 上下文包 · ue5_code/${subsystem}`, "");
	bodyLines.push(`> 新鲜度：**${status.freshness}**（快照 ${resolved.snapshot_id.slice(0, 16)}…，发布 revision ${resolved.publication_revision}）。`);
	bodyLines.push("> 引用本包结论时必须保留本声明与 provenance。", "");

	for (const symbol of selected) {
		bodyLines.push(`## ${symbol.label}（${symbol.type}）`, "");
		bodyLines.push(`- id: \`${symbol.id}\``);
		if (symbol.module !== null) bodyLines.push(`- module: ${symbol.module}`);
		if (symbol.layer !== null) bodyLines.push(`- layer: ${symbol.layer}`);
		bodyLines.push("");

		const detail = evidenceSymbolDetail(graph, symbol.id);
		const attributes = (detail as { attributes?: Record<string, unknown> } | null)?.attributes;
		if (attributes && Object.keys(attributes).length > 0) {
			bodyLines.push("**事实属性**", "", "```json", JSON.stringify(attributes, null, 2), "```", "");
		}

		const neighborhood = evidenceNeighborhood(graph, symbol.id);
		if (neighborhood && neighborhood.relations.length > 0) {
			bodyLines.push("**一跳关系邻域**", "");
			for (const relation of neighborhood.relations) {
				bodyLines.push(`- \`${relation.source_id}\` -[${relation.relation}]-> \`${relation.target_id}\``);
			}
			bodyLines.push("");
		}

		const annotations = annotationsByNode.get(symbol.id) ?? [];
		if (annotations.length > 0) {
			bodyLines.push("**工程标注（人工知识，非提取事实）**", "");
			for (const annotation of annotations) {
				bodyLines.push(`- [${annotation.type}]${annotation.stale ? " ⚠ stale" : ""} ${annotation.content}`);
			}
			bodyLines.push("");
		}
	}

	const withoutHash = ["---", ...frontMatter, "---", "", ...bodyLines].join("\n");
	const output = withoutHash.replace(/sha256: .*/, `sha256: ${createHash("sha256").update(withoutHash).digest("hex")}`);
	mkdirSync(dirname(outArg), { recursive: true });
	writeFileSync(outArg, output, "utf8");
	console.log(`[export-context] 已写出 ${selected.length} 个符号的上下文包：${outArg}`);
} catch (error) {
	if (error instanceof EvidenceResolutionError) {
		console.error("[export-context] 证据快照不可用");
		process.exit(4);
	}
	console.error(`[export-context] ${(error as Error).message}`);
	process.exit(1);
}
