// Graph Brain / service - deterministic HTTP contract probe for candidate and active releases.

interface GraphCatalogEntry {
	file?: unknown;
	domain?: unknown;
}

interface EvidenceStatusPayload {
	format_version?: unknown;
	publication_revision?: unknown;
	snapshot_id?: unknown;
	freshness?: unknown;
	consumer_gate?: { require_fresh?: unknown; allowed?: unknown; code?: unknown };
}

function readBase(): string {
	const argument = process.argv.find((value) => value.startsWith("--base="));
	const raw = argument?.slice("--base=".length) ?? process.env.GB_SMOKE_BASE ?? "http://127.0.0.1:3030";
	const url = new URL(raw);
	if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
		throw new Error("service health check 只允许本机 HTTP 地址");
	}
	return url.origin;
}

async function fetchOk(base: string, path: string, timeoutMs = 10_000): Promise<Response> {
	try {
		const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return response;
	} catch (error) {
		throw new Error(`${path} 验收失败（预算 ${timeoutMs}ms）：${String(error)}`);
	}
}

const base = readBase();
const home = await (await fetchOk(base, "/")).text();
if (!home.includes("id=\"root\"") || !home.includes("bootstrap-recovery.js")) {
	throw new Error("首页缺少 GraphBrain bootstrap 标记");
}
const retiredEmbed = await fetch(`${base}/embed/ue5_code/project`, { signal: AbortSignal.timeout(10_000) });
const retiredEmbedPayload = await retiredEmbed.json() as { code?: unknown; surface?: unknown };
if (retiredEmbed.status !== 410
	|| retiredEmbedPayload.code !== "VIEWER_SURFACE_RETIRED"
	|| retiredEmbedPayload.surface !== "generic-embed") {
	throw new Error("generic embed 退役边界未稳定返回 410 诊断");
}

const graphCatalog = await (await fetchOk(base, "/api/graph-catalog")).json() as GraphCatalogEntry[];
if (!Array.isArray(graphCatalog) || graphCatalog.length === 0) throw new Error("graph catalog 必须为非空数组");
const graph = graphCatalog.find((entry) => entry.domain === "ue5_code" && typeof entry.file === "string");
if (!graph || typeof graph.file !== "string") throw new Error("graph catalog 缺少 ue5_code 图");
await fetchOk(base, `/data/graphs/${encodeURIComponent(graph.file)}`);

const evidence = await (await fetchOk(base, "/api/evidence/v1/status")).json() as EvidenceStatusPayload;
if (evidence.format_version !== "graphbrain-evidence-status/1"
	|| !Number.isSafeInteger(evidence.publication_revision)
	|| typeof evidence.snapshot_id !== "string"
	|| !["current", "stale", "unverified"].includes(String(evidence.freshness))) {
	throw new Error("Evidence Status 不是完整 graphbrain-evidence-status/1 合约");
}
if (evidence.consumer_gate?.require_fresh !== true
	|| evidence.consumer_gate.allowed !== (evidence.freshness === "current")) {
	throw new Error("Evidence Status consumer gate 未按 freshness fail closed");
}

const changeCatalog = await (await fetchOk(base, "/api/change-reports")).json() as { format_version?: unknown; reports?: unknown[] };
if (changeCatalog.format_version !== 1 || !Array.isArray(changeCatalog.reports)) {
	throw new Error("change report catalog 不是显式 v1 合约");
}
const defaultReport = (changeCatalog as { default_report?: unknown }).default_report;
if (typeof defaultReport !== "string" || changeCatalog.reports.length === 0) {
	throw new Error("change report catalog 必须包含显式默认报告");
}
const report = await (await fetchOk(base, `/api/change-reports/${encodeURIComponent(defaultReport)}`)).json() as {
	publication_binding?: { current_snapshot_is_active_publication?: unknown };
};
if (typeof report.publication_binding?.current_snapshot_is_active_publication !== "boolean") {
	throw new Error("change report 缺少活动 publication 绑定声明");
}
// A fresh process may need to build the UE header-name index once. Keep that
// cold-start budget local to this endpoint instead of weakening all probes.
await fetchOk(base, "/api/engine-catalog/classes?limit=1", 60_000);

console.log(`[service-health-check] 通过：${base} 首页、嵌入退役 410、Evidence Status v1、变化 publication 绑定、引擎目录`);
