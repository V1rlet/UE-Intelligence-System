// Graph Brain / tools - gb/1 MCP 只读工具面（A1）
//
// 宪法第 10 条边界声明：
// - 拥有：gb/1 工具清单与其 JSON-RPC(stdio) 接入点——把既有只读查询能力以标准工具协议
//   暴露给任意 MCP 宿主。本文件是唯一接入点。
// - 复用：core/evidence/query（符号/邻域/变化查询）、core/evidence/resolver（唯一发布
//   证据解析边界）、core/evidence/status + server/evidence.readEvidenceStatus（新鲜度与
//   fail-closed 消费门槛）、core/query/analysis 纯函数（影响/闭包）、
//   core/reading-context/store（标注知识层）。不复制第二套事实逻辑，不直读 data/ 内部
//   文件布局；与 HTTP API 消费同一 resolver 与同一门槛语义。
// - 交换协议：stdio 上的 MCP（@modelcontextprotocol/sdk）。全部工具只读：不存在任何写
//   方法、资源模板或 prompt 面；HTTP mutation guard 的同源语义在进程边界内天然不适用，
//   但"无写入口"由本文件工具清单穷举保证。
// - 退出路径：删除本文件与 package.json 的 "mcp" 脚本即完全退役，对 viewer/server/hook
//   零影响；工具名前缀 gb/1 显式版本化，破坏性变更升 gb/2 并行退役 gb/1。
//
// 新鲜度语义与 HTTP v1 一致：快照过期时默认 fail-closed，返回 EVIDENCE_STALE 诊断而非
// 事实数据；调用方可用 allowStale=true 显式降级（对应 HTTP ?allow-nonfresh）。
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
	evidenceNeighborhood,
	evidenceSymbolDetail,
	queryEvidenceChanges,
	searchEvidenceSymbols,
} from "../core/evidence/query.js";
import { EvidenceResolutionError, resolvePublishedEvidence } from "../core/evidence/resolver.js";
import { assessEvidenceAccess, type EvidenceGateDecision, type EvidenceStatus } from "../core/evidence/status.js";
import { forwardClosure, impactAnalysis, projectGraph } from "../core/query/analysis.js";
import { loadReadingContext } from "../core/reading-context/store.js";
import { parseChangeReportText } from "../server/changes.js";
import { readEvidenceStatus } from "../server/evidence.js";
// 根锚点：缺省仓库工作树；测试/便携场景可用 GRAPH_BRAIN_ROOT 覆盖（与 GB_PROJECT_ROOT
// 语义一致：指向包含 core/ 与 data/ 的 GraphBrain 工作树）。
const ROOT = resolve(process.env.GRAPH_BRAIN_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
const DATA_DIR = join(ROOT, "data");
const MCP_FORMAT = "graphbrain-mcp/1" as const;

interface GateRejection {
	code: "EVIDENCE_STALE";
	error: string;
	consumer_gate: EvidenceGateDecision;
	freshness: EvidenceStatus["freshness"];
}

/** 与 HTTP v1 相同的 fail-closed 门槛：不允许新鲜度降级时返回诊断而非数据。 */
function gateEvidence(allowStale: boolean): { status: EvidenceStatus; rejection: GateRejection | null } {
	const status = readEvidenceStatus(DATA_DIR);
	const decision = assessEvidenceAccess(status, !allowStale);
	if (!decision.allowed) {
		return {
			status,
			rejection: {
				code: "EVIDENCE_STALE",
				error: "证据快照不满足新鲜度门槛；未返回事实数据。可显式传 allowStale=true 获取诊断上下文。",
				consumer_gate: decision,
				freshness: status.freshness,
			},
		};
	}
	return { status, rejection: null };
}

function resolvedOrThrow() {
	return resolvePublishedEvidence(DATA_DIR);
}

/** provenance 原样透传：快照身份、引擎身份与发布代次一起随每份事实返回。 */
function provenanceOf(resolved: ReturnType<typeof resolvePublishedEvidence>) {
	return {
		format_version: MCP_FORMAT,
		mode: resolved.mode,
		snapshot_id: resolved.snapshot_id,
		publication_revision: resolved.publication_revision,
		source_v2_generation: {
			id: resolved.source_v2_generation.id,
			file: resolved.source_v2_generation.graph.file,
			sha256: resolved.source_v2_generation.graph.sha256,
		},
		engine_identity: resolved.engine_identity,
	};
}

function jsonResult(payload: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(code: string, message: string, detail?: unknown) {
	return {
		isError: true as const,
		content: [{ type: "text" as const, text: JSON.stringify({ code, error: message, ...(detail !== undefined ? { detail } : {}) }, null, 2) }],
	};
}

const server = new McpServer(
	{ name: "graphbrain", title: "GraphBrain UE Code Facts", version: "gb/1" },
	{ capabilities: { tools: {} } },
);

server.registerTool("gb_status", {
	title: "GraphBrain 证据状态",
	description: "只读：当前发布证据的新鲜度、消费门槛与快照/发布身份（不返回代码事实）。",
	inputSchema: {},
}, async () => {
	const status = readEvidenceStatus(DATA_DIR);
	return jsonResult({
		format_version: MCP_FORMAT,
		freshness: status.freshness,
		freshness_reason: status.freshness_reason,
		publication_revision: status.publication_revision,
		snapshot_id: status.snapshot_id,
		diagnostics: status.diagnostics,
		consumer_gate: assessEvidenceAccess(status),
	});
});

server.registerTool("gb_search_symbols", {
	title: "符号检索",
	description: "只读：按文本/类型/模块/层过滤检索代码事实符号，附带 provenance。",
	inputSchema: {
		text: z.string().max(300).optional(),
		type: z.string().max(60).optional(),
		module: z.string().max(300).optional(),
		layer: z.string().max(60).optional(),
		limit: z.number().int().min(1).max(200).optional(),
		allowStale: z.boolean().optional(),
	},
}, async ({ text, type, module, layer, limit, allowStale }) => {
	const gate = gateEvidence(allowStale ?? false);
	if (gate.rejection) return errorResult(gate.rejection.code, gate.rejection.error, gate.rejection);
	try {
		const resolved = resolvedOrThrow();
		const result = searchEvidenceSymbols(resolved.graph, {
			text: text ?? null,
			type: type ?? null,
			module: module ?? null,
			layer: layer ?? null,
			limit: limit ?? 50,
		});
		return jsonResult({ ...provenanceOf(resolved), freshness: gate.status.freshness, ...result });
	} catch (error) {
		return resolverError(error);
	}
});

server.registerTool("gb_symbol_detail", {
	title: "符号详情",
	description: "只读：单个符号的完整事实（定义、关系计数、证据指纹），附带 provenance。",
	inputSchema: {
		id: z.string().min(1).max(500),
		allowStale: z.boolean().optional(),
	},
}, async ({ id, allowStale }) => {
	const gate = gateEvidence(allowStale ?? false);
	if (gate.rejection) return errorResult(gate.rejection.code, gate.rejection.error, gate.rejection);
	try {
		const resolved = resolvedOrThrow();
		const symbol = evidenceSymbolDetail(resolved.graph, id);
		if (!symbol) return errorResult("EVIDENCE_SYMBOL_NOT_FOUND", `symbol not found: ${id}`);
		return jsonResult({ ...provenanceOf(resolved), freshness: gate.status.freshness, symbol });
	} catch (error) {
		return resolverError(error);
	}
});

server.registerTool("gb_neighborhood", {
	title: "一跳邻域",
	description: "只读：某符号的一跳依赖/被依赖邻域。",
	inputSchema: {
		id: z.string().min(1).max(500),
		allowStale: z.boolean().optional(),
	},
}, async ({ id, allowStale }) => {
	const gate = gateEvidence(allowStale ?? false);
	if (gate.rejection) return errorResult(gate.rejection.code, gate.rejection.error, gate.rejection);
	try {
		const resolved = resolvedOrThrow();
		const neighborhood = evidenceNeighborhood(resolved.graph, id);
		if (!neighborhood) return errorResult("EVIDENCE_SYMBOL_NOT_FOUND", `symbol not found: ${id}`);
		return jsonResult({ ...provenanceOf(resolved), freshness: gate.status.freshness, ...neighborhood });
	} catch (error) {
		return resolverError(error);
	}
});

server.registerTool("gb_impact", {
	title: "影响/闭包分析",
	description: "只读：包装 core/query/analysis 纯函数——seeds 的反向影响波及（impact）或正向需读懂闭包（closure）。",
	inputSchema: {
		seeds: z.array(z.string().min(1).max(500)).min(1).max(64),
		groupBy: z.enum(["module", "system"]).optional(),
		direction: z.enum(["impact", "closure"]).optional(),
		allowStale: z.boolean().optional(),
	},
}, async ({ seeds, groupBy, direction, allowStale }) => {
	const gate = gateEvidence(allowStale ?? false);
	if (gate.rejection) return errorResult(gate.rejection.code, gate.rejection.error, gate.rejection);
	try {
		const resolved = resolvedOrThrow();
		const pg = projectGraph(resolved.graph);
		const report = direction === "closure"
			? forwardClosure(pg, seeds, groupBy ?? "module")
			: impactAnalysis(pg, seeds, groupBy ?? "module");
		return jsonResult({ ...provenanceOf(resolved), freshness: gate.status.freshness, direction: direction === "closure" ? "closure" : "impact", report });
	} catch (error) {
		return resolverError(error);
	}
});

server.registerTool("gb_changes", {
	title: "变化查询",
	description: "只读：活动发布绑定的一跳影响报告切片（added/changed/removed × 节点/关系语义）。",
	inputSchema: {
		kind: z.enum(["all", "added", "changed", "removed"]).optional(),
		module: z.string().max(300).optional(),
		type: z.string().max(300).optional(),
		limit: z.number().int().min(1).max(500).optional(),
		allowStale: z.boolean().optional(),
	},
}, async ({ kind, module, type, limit, allowStale }) => {
	const gate = gateEvidence(allowStale ?? false);
	if (gate.rejection) return errorResult(gate.rejection.code, gate.rejection.error, gate.rejection);
	try {
		const resolved = resolvedOrThrow();
		const generation = resolved.source_v2_generation;
		if (!generation?.change_report) return errorResult("EVIDENCE_CHANGE_REPORT_UNAVAILABLE", "活动快照没有绑定的变化报告");
		const reportPath = join(DATA_DIR, "changes", generation.change_report.file);
		const reportBytes = readFileSync(reportPath);
		if (createHash("sha256").update(reportBytes).digest("hex") !== generation.change_report.sha256) {
			return errorResult("EVIDENCE_CHANGE_REPORT_HASH_MISMATCH", "变化报告哈希不一致，拒绝提供内容");
		}
		const report = parseChangeReportText(reportBytes.toString("utf8"));
		const result = queryEvidenceChanges(report, {
			kind: kind ?? "all",
			module: module ?? null,
			type: type ?? null,
			limit: limit ?? 100,
		});
		return jsonResult({ ...provenanceOf(resolved), freshness: gate.status.freshness, change_report: generation.change_report.file, ...result });
	} catch (error) {
		return resolverError(error);
	}
});

server.registerTool("gb_annotations_get", {
	title: "工程标注读取",
	description: "只读：读取 ue5_code 阅读上下文（工程标注知识层），可按 subsystem/node_id 过滤。标注是人工知识，非提取事实。",
	inputSchema: {
		subsystem: z.string().max(120).optional(),
		node_id: z.string().max(500).optional(),
	},
}, async ({ subsystem, node_id }) => {
	try {
		const document = loadReadingContext("ue5_code");
		let entries = document.annotations;
		if (subsystem !== undefined) entries = entries.filter((entry) => entry.subsystem === subsystem);
		if (node_id !== undefined) entries = entries.filter((entry) => entry.node_id === node_id);
		return jsonResult({
			format_version: MCP_FORMAT,
			revision: document.revision,
			updated_at: document.updated_at,
			count: entries.reduce((sum, entry) => sum + entry.annotations.length, 0),
			annotations: entries,
		});
	} catch (error) {
		return errorResult("READING_CONTEXT_UNAVAILABLE", String((error as Error).message ?? error));
	}
});

function resolverError(error: unknown) {
	if (error instanceof EvidenceResolutionError) {
		return errorResult(error.code, "evidence snapshot unavailable");
	}
	const message = error instanceof Error ? error.message : String(error);
	return errorResult("MCP_TOOL_FAILED", message);
}

await server.connect(new StdioServerTransport());
console.error("[graphbrain-mcp] gb/1 ready on stdio");
