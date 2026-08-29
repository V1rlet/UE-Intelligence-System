import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { GraphFile } from "../adapters/adapter-interface.js";
import {
	evidenceEnvelope,
	evidenceNeighborhood,
	evidenceSymbolDetail,
	queryEvidenceChanges,
	searchEvidenceSymbols,
} from "../core/evidence/query.js";
import {
	assessEvidenceAccess,
	buildEvidenceStatus,
	type EvidenceStatus,
} from "../core/evidence/status.js";
import { EvidenceResolutionError, resolvePublishedEvidence } from "../core/evidence/resolver.js";
import {
	loadEvidenceRefreshConfig,
	evidenceRefreshLockPath,
	refreshProjectEvidence,
	resolveEvidenceRefreshProject,
	type EvidenceRefreshResult,
	type EvidenceRefreshStep,
} from "../core/evidence/refresh.js";
import { loadDataPublicationState, sha256, type PublishedGeneration } from "../core/store/data-publication.js";
import { graphCatalogEntries } from "./catalog.js";
import { recordLocalUsage } from "../core/usage/local-usage.js";
import { changeReportPublicationBinding, parseChangeReportText } from "./changes.js";
import {
	type ApiHandler,
	HttpInputError,
	methodNotAllowed,
	readJsonBody,
	searchParamsOf,
	sendHttpError,
	sendInternalError,
	sendJson,
} from "./http.js";

const EVIDENCE_ERROR_FORMAT = "graphbrain-evidence-error/1" as const;

class EvidenceSnapshotError extends Error {
	constructor(readonly code: string) {
		super(code);
	}
}

export function readPublishedEvidenceGraph(dataDir: string): { graph: GraphFile; generation: PublishedGeneration } {
	const resolved = resolvePublishedEvidence(dataDir);
	return { graph: resolved.graph, generation: resolved.source_v2_generation };
}

function boundedText(params: URLSearchParams, name: string, maxLength = 300): string | null {
	const value = params.get(name)?.trim() ?? "";
	if (value.length > maxLength) throw new HttpInputError(`${name} is too long`, "EVIDENCE_QUERY_INVALID");
	return value || null;
}

function boundedInteger(params: URLSearchParams, name: string, fallback: number, maximum: number): number {
	const raw = params.get(name);
	if (raw === null || raw === "") return fallback;
	// 只接受十进制字面量，拒绝 1e2/0x10 等非预期数值形式（与 engine.ts integerQuery 对齐）。
	if (!/^\d+$/.test(raw)) {
		throw new HttpInputError(`${name} must be an integer between 1 and ${maximum}`, "EVIDENCE_QUERY_INVALID");
	}
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
		throw new HttpInputError(`${name} must be an integer between 1 and ${maximum}`, "EVIDENCE_QUERY_INVALID");
	}
	return value;
}

function requireFreshEvidence(params: URLSearchParams): boolean {
	const value = params.get("require_fresh");
	if (value === null || value === "" || value === "true" || value === "1") return true;
	if (value === "false" || value === "0") return false;
	throw new HttpInputError("require_fresh must be true or false", "EVIDENCE_QUERY_INVALID");
}

function gateEvidenceRequest(res: Parameters<ApiHandler>[0]["res"], status: EvidenceStatus, params: URLSearchParams): boolean {
	const gate = assessEvidenceAccess(status, requireFreshEvidence(params));
	if (gate.allowed) return true;
	sendJson(res, 412, {
		format_version: EVIDENCE_ERROR_FORMAT,
		code: gate.code,
		error: gate.diagnostic,
		evidence_status: status,
		consumer_gate: gate,
	});
	return false;
}

function sendEvidenceFailure(res: Parameters<ApiHandler>[0]["res"], error: unknown): void {
	if (error instanceof EvidenceSnapshotError || error instanceof EvidenceResolutionError) {
		sendJson(res, 503, { format_version: EVIDENCE_ERROR_FORMAT, code: error.code, error: "active evidence snapshot is unavailable" });
		return;
	}
	if (!sendHttpError(res, error)) sendInternalError(res, error, "evidence query failed");
}

export function readEvidenceStatus(dataDir: string): EvidenceStatus {
	let state;
	try {
		state = loadDataPublicationState(join(dataDir, "publications"));
	} catch {
		return buildEvidenceStatus({
			publicationRevision: null,
			generation: null,
			catalogEntry: null,
			failureReason: "publication-state-invalid",
			failureDiagnostic: { code: "publication-state-invalid" },
		});
	}
	const activeGeneration = state.publications.find((item) => item.subsystem === "project")?.generations[0] ?? null;
	if (!activeGeneration) {
		return buildEvidenceStatus({
			publicationRevision: state.revision,
			generation: null,
			catalogEntry: null,
			failureReason: "publication-missing",
		});
	}
	let resolved;
	try {
		resolved = resolvePublishedEvidence(dataDir);
	} catch (error) {
		return buildEvidenceStatus({
			publicationRevision: state.revision,
			generation: activeGeneration,
			catalogEntry: null,
			failureReason: "active-snapshot-unavailable",
			failureDiagnostic: { code: error instanceof EvidenceResolutionError ? error.code : "evidence-resolution-failed" },
		});
	}
	let entry = null;
	try {
		entry = graphCatalogEntries(join(dataDir, "graphs")).find((item) => item.file === resolved.source_v2_generation.graph.file) ?? null;
	} catch {
		return buildEvidenceStatus({
			publicationRevision: resolved.publication_revision,
			generation: resolved.source_v2_generation,
			catalogEntry: null,
			snapshotId: resolved.snapshot_id,
			failureReason: "active-snapshot-unavailable",
			failureDiagnostic: { code: "catalog-resolution-failed" },
		});
	}
	const identity = resolved.engine_identity;
	return buildEvidenceStatus({
		publicationRevision: resolved.publication_revision,
		generation: resolved.source_v2_generation,
		catalogEntry: entry,
		snapshotId: resolved.snapshot_id,
		engine: identity ? {
			version: identity.engine_association,
			root_identity: identity.root_identity?.value ?? null,
			status: identity.status,
		} : undefined,
	});
}

function liveTsxRunner(root: string, onCacheHit: (value: boolean) => void): EvidenceRefreshStep {
	return async (script, args) => {
		const cli = join(root, "node_modules", "tsx", "dist", "cli.mjs");
		// 异步子进程：spawnSync 会把常驻服务的事件循环冻结到提取结束（分钟级），
		// 期间静态资源、健康探测与其余 API 全部停摆。
		const child = spawn(process.execPath, [cli, script, ...args], { cwd: root, windowsHide: true });
		const output: string[] = [];
		let buffered = 0;
		// 用数组承载 spawn 失败事件：回调内的赋值不参与控制流窄化，
		// 直接 let 变量在读取点会被窄化成 never。
		const spawnErrors: Error[] = [];
		// 保留最近 2 MiB 输出即可：metrics 行在末尾，更早的逐文件日志只是诊断噪音。
		const push = (chunk: string) => {
			output.push(chunk);
			buffered += chunk.length;
			while (buffered > 2 * 1024 * 1024 && output.length > 1) buffered -= output.shift()!.length;
		};
		child.stdout?.on("data", (chunk) => push(String(chunk)));
		child.stderr?.on("data", (chunk) => push(String(chunk)));
		child.once("error", (error) => { spawnErrors.push(error); });
		// 与原 spawnSync 的 10 分钟超时对齐；unref 保证超时定时器不阻止进程退出。
		const timeout = setTimeout(() => { child.kill("SIGKILL"); }, 10 * 60 * 1000);
		timeout.unref?.();
		const status = await new Promise<number>((resolve) => {
			child.once("close", (code) => resolve(code ?? 1));
		});
		clearTimeout(timeout);
		const text = output.join("").trim();
		const metrics = text.match(/\[graphbrain-extract-metrics\]\s+(\{[^\r\n]+\})/);
		if (metrics) {
			try {
				const parsed = JSON.parse(metrics[1]) as { cache_hit?: unknown };
				if (typeof parsed.cache_hit === "boolean") onCacheHit(parsed.cache_hit);
			} catch { /* malformed child diagnostics remain non-authoritative */ }
		}
		if (text) console.log(`[evidence-refresh] ${text}`);
		const spawnError = spawnErrors[0];
		if (spawnError) console.error("[evidence-refresh] child process failed", spawnError.message);
		return status ?? 1;
	};
}

export async function refreshRegisteredEvidence(input: {
	root: string;
	project?: string | null;
	runStep?: EvidenceRefreshStep;
	onEvent?: (message: string) => void;
}): Promise<EvidenceRefreshResult & { duration_ms: number; cache_hit: boolean | null }> {
	const root = resolve(input.root);
	const startedAt = Date.now();
	let cacheHit: boolean | null = null;
	const config = loadEvidenceRefreshConfig(join(root, "core", "hooks", "hook-projects.json"));
	const project = resolveEvidenceRefreshProject(config, input.project);
	const result = await refreshProjectEvidence({
		project,
		lockPath: evidenceRefreshLockPath(root),
		runStep: input.runStep ?? liveTsxRunner(root, (value) => { cacheHit = value; }),
		onEvent: input.onEvent,
	});
	const enriched = { ...result, duration_ms: Date.now() - startedAt, cache_hit: cacheHit };
	try { recordLocalUsage(root, "evidence.refresh", { durationMs: enriched.duration_ms, cacheHit }); }
	catch (error) { console.warn("[local-usage] evidence.refresh record failed", error); }
	return enriched;
}

export const handleEvidenceStatus: ApiHandler = ({ req, res, url, dataDir }) => {
	if (url !== "/api/evidence/v1/status") return false;
	if (req.method !== "GET") {
		methodNotAllowed(res);
		return true;
	}
	res.setHeader("Cache-Control", "no-store");
	const status = readEvidenceStatus(dataDir);
	sendJson(res, 200, { ...status, consumer_gate: assessEvidenceAccess(status) });
	return true;
};

export const handleEvidenceQueries: ApiHandler = ({ req, res, url, dataDir }) => {
	const route = url === "/api/evidence/v1/symbols"
		|| url === "/api/evidence/v1/symbol"
		|| url === "/api/evidence/v1/neighborhood"
		|| url === "/api/evidence/v1/changes";
	if (!route) return false;
	if (req.method !== "GET") {
		methodNotAllowed(res);
		return true;
	}
	res.setHeader("Cache-Control", "no-store");
	try {
		const params = searchParamsOf(req);
		const status = readEvidenceStatus(dataDir);
		if (!gateEvidenceRequest(res, status, params)) return true;

		const resolved = resolvePublishedEvidence(dataDir);
		if (url === "/api/evidence/v1/changes") {
			const generation = resolved.source_v2_generation;
			if (!generation?.change_report) throw new EvidenceSnapshotError("EVIDENCE_CHANGE_REPORT_UNAVAILABLE");
			const reportPath = join(dataDir, "changes", generation.change_report.file);
			const reportBytes = readFileSync(reportPath);
			// 先对原始字节验证完整性再解析：被篡改的报告必须表现为 503 快照不可用，
			// 而不是把不可信内容送进 schema 校验后以 500 泄漏诊断。
			if (sha256(reportBytes) !== generation.change_report.sha256) {
				throw new EvidenceSnapshotError("EVIDENCE_CHANGE_REPORT_HASH_MISMATCH");
			}
			const report = parseChangeReportText(reportBytes.toString("utf8"));
			const rawKind = boundedText(params, "kind", 20) ?? "all";
			if (!["all", "added", "changed", "removed"].includes(rawKind)) {
				throw new HttpInputError("kind must be all, added, changed, or removed", "EVIDENCE_QUERY_INVALID");
			}
			const result = queryEvidenceChanges(report, {
				kind: rawKind as "all" | "added" | "changed" | "removed",
				module: boundedText(params, "module"),
				type: boundedText(params, "type"),
				limit: boundedInteger(params, "limit", 100, 500),
			});
			sendJson(res, 200, {
				...evidenceEnvelope(status, "changes"),
				...result,
				publication_binding: changeReportPublicationBinding(dataDir, report),
			});
			return true;
		}

		const graph = resolved.graph;
		if (url === "/api/evidence/v1/symbols") {
			const result = searchEvidenceSymbols(graph, {
				text: boundedText(params, "q"),
				type: boundedText(params, "type"),
				module: boundedText(params, "module"),
				layer: boundedText(params, "layer"),
				limit: boundedInteger(params, "limit", 50, 200),
			});
			sendJson(res, 200, { ...evidenceEnvelope(status, "symbol-search"), query: params.get("q") ?? "", ...result });
			return true;
		}

		const id = boundedText(params, "id", 500);
		if (!id) throw new HttpInputError("id is required", "EVIDENCE_QUERY_INVALID");
		if (url === "/api/evidence/v1/symbol") {
			const symbol = evidenceSymbolDetail(graph, id);
			if (!symbol) {
				sendJson(res, 404, { format_version: EVIDENCE_ERROR_FORMAT, code: "EVIDENCE_SYMBOL_NOT_FOUND", error: "symbol not found" });
				return true;
			}
			sendJson(res, 200, { ...evidenceEnvelope(status, "symbol-detail"), symbol });
			return true;
		}

		const depth = boundedInteger(params, "depth", 1, 1);
		const neighborhood = evidenceNeighborhood(graph, id);
		if (!neighborhood) {
			sendJson(res, 404, { format_version: EVIDENCE_ERROR_FORMAT, code: "EVIDENCE_SYMBOL_NOT_FOUND", error: "symbol not found" });
			return true;
		}
		sendJson(res, 200, { ...evidenceEnvelope(status, "symbol-neighborhood"), ...neighborhood, depth });
	} catch (error) {
		sendEvidenceFailure(res, error);
	}
	return true;
};

export const handleEvidenceRefresh: ApiHandler = async ({ req, res, url, root, dataDir }) => {
	if (url !== "/api/evidence/v1/refresh") return false;
	if (req.method !== "POST") {
		methodNotAllowed(res, "POST");
		return true;
	}
	try {
		const body = await readJsonBody(req);
		if (body.project !== undefined && typeof body.project !== "string") {
			throw new HttpInputError("project must be a registered project name or root", "EVIDENCE_REFRESH_PROJECT_INVALID");
		}
		const result = await refreshRegisteredEvidence({
			root,
			project: typeof body.project === "string" ? body.project : null,
			onEvent: (message) => console.log(`[evidence-refresh] ${message}`),
		});
		if (result.status === "busy") {
			sendJson(res, 409, { ...result, code: "EVIDENCE_REFRESH_BUSY" });
			return true;
		}
		if (result.status === "failed") {
			sendJson(res, 503, { ...result, code: "EVIDENCE_REFRESH_FAILED" });
			return true;
		}
		if (result.status === "skipped") {
			sendJson(res, 422, { ...result, code: "EVIDENCE_REFRESH_SKIPPED" });
			return true;
		}
		const status = readEvidenceStatus(dataDir);
		sendJson(res, 200, { refresh: result, evidence_status: status, consumer_gate: assessEvidenceAccess(status) });
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("unknown evidence refresh project:")) {
			sendJson(res, 404, { error: "registered evidence project not found", code: "EVIDENCE_REFRESH_PROJECT_NOT_FOUND" });
			return true;
		}
		if (!sendHttpError(res, error)) sendInternalError(res, error, "evidence refresh failed");
	}
	return true;
};

export const evidenceHandlers: ApiHandler[] = [handleEvidenceStatus, handleEvidenceQueries, handleEvidenceRefresh];
