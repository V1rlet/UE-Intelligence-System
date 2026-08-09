// Fresh-browser resource budget for the project relationship workspace.
import { BASE, launchBrowser, navigate, resolveCodeFixture, waitForSelector, waitUntil } from "./browser-smoke-lib.js";
import { VIEWER_PERFORMANCE_BUDGETS, VIEWER_PERFORMANCE_NAMES } from "../viewer/src/viewerPerformance.js";

const fixture = await resolveCodeFixture();
const catalogResponse = await fetch(`${BASE}/api/graph-catalog`, { signal: AbortSignal.timeout(5_000) });
const catalog = await catalogResponse.json() as Array<{ file: string; kind?: string }>;
const reference = catalog.find((entry) => entry.kind === "reference");
if (!reference) throw new Error("资源预算需要一份非森林参考图验证 fCoSE 兼容路径");
const projectGraphPath = `/data/graphs/${encodeURIComponent(fixture.file)}`;
const url = `${BASE}/?view=explore&mode=relations&source=project&file=${encodeURIComponent(fixture.file)}`;
const session = await launchBrowser(url);

try {
	const { cdp } = session;
	await waitForSelector(cdp, '.graph-wrap[data-layout-capability="forest"]');
	await waitUntil(async () => await cdp.evaluate<boolean>(`performance.getEntriesByName(${JSON.stringify(VIEWER_PERFORMANCE_NAMES.projectionInteractive)}, 'measure').length > 0`) ? true : null, "项目关系图可交互度量");
	const resources = await cdp.evaluate<Array<{ path: string; initiator: string; decoded: number; transfer: number }>>(`performance.getEntriesByType('resource').map((entry) => ({
		path: new URL(entry.name).pathname,
		initiator: entry.initiatorType,
		decoded: entry.decodedBodySize,
		transfer: entry.transferSize,
	}))`);
	const scripts = resources.filter((entry) => entry.initiator === "script" || /\.(?:js|mjs|ts|tsx)$/.test(entry.path));
	const decodedScriptBytes = scripts.reduce((sum, entry) => sum + entry.decoded, 0);
	const fcoseRequests = resources.filter((entry) => /cytoscape-fcose|registerFcose/i.test(entry.path));
	if (fcoseRequests.length > 0) throw new Error(`文件森林不应下载 fCoSE：${JSON.stringify(fcoseRequests)}`);
	if (resources.some((entry) => entry.path === projectGraphPath)) throw new Error("项目关系图冷启动错误下载了完整事实图");
	if (decodedScriptBytes > VIEWER_PERFORMANCE_BUDGETS.projectRelationColdScriptBytes) {
		const largest = [...scripts].sort((left, right) => right.decoded - left.decoded).slice(0, 8);
		throw new Error(`项目关系图冷启动脚本超预算：${decodedScriptBytes} B > ${VIEWER_PERFORMANCE_BUDGETS.projectRelationColdScriptBytes} B；最大资源 ${JSON.stringify(largest)}`);
	}
	console.log(`[resource-budget] project relations ${decodedScriptBytes} B decoded JS · ${scripts.length} scripts · fCoSE 0 requests`);

	const referenceUrl = `${BASE}/?view=explore&mode=relations&source=project&file=${encodeURIComponent(reference.file)}`;
	await navigate(cdp, referenceUrl, '.graph-wrap[data-layout-capability="fcose"]');
	await waitUntil(async () => await cdp.evaluate<boolean>(`document.querySelector('.topbar-code-workspace')?.getAttribute('data-graph-load-mode') === 'full'`) ? true : null, "参考图完整事实兼容路径");
	const referenceResources = await cdp.evaluate<string[]>(`performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname)`);
	if (!referenceResources.some((path) => /cytoscape-fcose|registerFcose/i.test(path))) throw new Error("非森林参考图没有按需加载 fCoSE");
	if (!referenceResources.includes(`/data/graphs/${encodeURIComponent(reference.file)}`)) throw new Error("非森林参考图没有走完整事实加载路径");
	console.log("[resource-budget] reference graph full facts · fCoSE loaded on demand");
} finally {
	await session.close();
}
