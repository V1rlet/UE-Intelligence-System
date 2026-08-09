// Graph Brain / service - deterministic HTTP contract probe for candidate and active releases.

interface GraphCatalogEntry {
	file?: unknown;
	domain?: unknown;
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
const embed = await (await fetchOk(base, "/embed.html")).text();
if (!embed.includes("id=\"root\"")) throw new Error("embed 页面缺少 React root");

const graphCatalog = await (await fetchOk(base, "/api/graph-catalog")).json() as GraphCatalogEntry[];
if (!Array.isArray(graphCatalog) || graphCatalog.length === 0) throw new Error("graph catalog 必须为非空数组");
const graph = graphCatalog.find((entry) => entry.domain === "ue5_code" && typeof entry.file === "string");
if (!graph || typeof graph.file !== "string") throw new Error("graph catalog 缺少 ue5_code 图");
await fetchOk(base, `/data/graphs/${encodeURIComponent(graph.file)}`);

const changeCatalog = await (await fetchOk(base, "/api/change-reports")).json() as { format_version?: unknown; reports?: unknown };
if (changeCatalog.format_version !== 1 || !Array.isArray(changeCatalog.reports)) {
	throw new Error("change report catalog 不是显式 v1 合约");
}
const defaultReport = (changeCatalog as { default_report?: unknown }).default_report;
if (typeof defaultReport !== "string" || changeCatalog.reports.length === 0) {
	throw new Error("change report catalog 必须包含显式默认报告");
}
await fetchOk(base, `/api/change-reports/${encodeURIComponent(defaultReport)}`);
// A fresh process may need to build the UE header-name index once. Keep that
// cold-start budget local to this endpoint instead of weakening all probes.
await fetchOk(base, "/api/engine-catalog/classes?limit=1", 60_000);

console.log(`[service-health-check] 通过：${base} 首页、嵌入页、图目录、变化目录、引擎目录`);
