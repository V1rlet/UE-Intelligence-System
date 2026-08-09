// Production-build route budgets based on the exact asset set requested by Chrome.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { preview } from "vite";
import { launchBrowser, navigate, waitForSelector, waitUntil } from "./browser-smoke-lib.js";
import { VIEWER_PERFORMANCE_BUDGETS, VIEWER_PERFORMANCE_NAMES } from "../viewer/src/viewerPerformance.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, "viewer", "dist");
const PORT = 3131;
const BASE = `http://127.0.0.1:${PORT}`;

type RouteName = keyof typeof VIEWER_PERFORMANCE_BUDGETS.productionRoutes;
interface ResourceFact {
	path: string;
	initiator: string;
	transfer: number;
	encoded: number;
	decoded: number;
}

function gzipRequestedAssets(resources: ResourceFact[], pattern: RegExp): number {
	const paths = [...new Set(resources.map((entry) => entry.path).filter((path) => pattern.test(path)))];
	return paths.reduce((sum, path) => {
		const target = resolve(DIST, `.${path}`);
		if (!target.startsWith(DIST)) throw new Error(`构建资源越界：${path}`);
		return sum + gzipSync(readFileSync(target)).byteLength;
	}, 0);
}

async function inspectRoute(name: RouteName, path: string, selector: string, ready?: (cdp: Awaited<ReturnType<typeof launchBrowser>>["cdp"]) => Promise<void>) {
	const session = await launchBrowser("about:blank", { reducedMotion: true });
	try {
		const { cdp } = session;
		await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `
			window.__graphBrainLongTasks = [];
			try {
				new PerformanceObserver((list) => {
					for (const entry of list.getEntries()) window.__graphBrainLongTasks.push(entry.duration);
				}).observe({ type: 'longtask', buffered: true });
			} catch {}
		` });
		await navigate(cdp, `${BASE}${path}`, selector);
		if (ready) await ready(cdp);
		await cdp.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 120))))`);
		const resources = await cdp.evaluate<ResourceFact[]>(`performance.getEntriesByType('resource').map((entry) => ({
			path: new URL(entry.name).pathname,
			initiator: entry.initiatorType,
			transfer: entry.transferSize,
			encoded: entry.encodedBodySize,
			decoded: entry.decodedBodySize,
		}))`);
		const longTasks = await cdp.evaluate<number[]>(`window.__graphBrainLongTasks ?? []`);
		const scriptsGzip = gzipRequestedAssets(resources, /^\/assets\/.*\.js$/);
		const staticGzip = gzipRequestedAssets(resources, /^\/assets\/.*\.(?:js|css)$/);
		const transferred = resources.reduce((sum, entry) => sum + entry.transfer, 0);
		const longestTask = Math.max(0, ...longTasks);
		const budget = VIEWER_PERFORMANCE_BUDGETS.productionRoutes[name];
		if (scriptsGzip > budget.scriptGzipBytes) throw new Error(`${name} 生产脚本 gzip 超预算：${scriptsGzip} B > ${budget.scriptGzipBytes} B`);
		if (staticGzip > budget.staticGzipBytes) throw new Error(`${name} 生产静态 gzip 超预算：${staticGzip} B > ${budget.staticGzipBytes} B`);
		if (longestTask > budget.longestTaskMs) throw new Error(`${name} 最长 Long Task 超预算：${longestTask.toFixed(1)} ms > ${budget.longestTaskMs} ms`);
		console.log(`[production-budget] ${name} · static ${(staticGzip / 1024).toFixed(1)} KiB gzip · transfer ${(transferred / 1024).toFixed(1)} KiB · longest task ${longestTask.toFixed(1)} ms`);
		return resources;
	} finally {
		await session.close();
	}
}

const server = await preview({
	configFile: resolve(ROOT, "vite.config.ts"),
	logLevel: "silent",
	preview: { host: "127.0.0.1", port: PORT, strictPort: true },
});

try {
	await waitUntil(async () => {
		try {
			const response = await fetch(`${BASE}/api/graph-catalog`);
			return response.ok ? true : null;
		} catch {
			return null;
		}
	}, "生产预览 API");
	const catalog = await fetch(`${BASE}/api/graph-catalog`).then((response) => response.json()) as Array<{ file: string; subsystem: string; kind?: string; capabilities?: { file_forest_projection?: 1 } }>;
	const project = catalog.find((entry) => entry.subsystem === "project" && entry.kind !== "mindmap" && entry.capabilities?.file_forest_projection === 1);
	if (!project) throw new Error("生产资源门禁没有找到声明文件森林投影的项目图");

	await inspectRoute("home", "/", ".home-code-viewer", async (cdp) => {
		await waitForSelector(cdp, ".home-catalog-entry");
	});
	await inspectRoute("changes", "/?view=changes", ".changes-view", async (cdp) => {
		await waitForSelector(cdp, ".changes-summary");
		await waitForSelector(cdp, ".change-row-card");
	});
	const projectResources = await inspectRoute(
		"projectRelations",
		`/?view=explore&mode=relations&source=project&file=${encodeURIComponent(project.file)}`,
		'.graph-wrap[data-layout-capability="forest"]',
		async (cdp) => {
			await waitUntil(async () => await cdp.evaluate<boolean>(`performance.getEntriesByName(${JSON.stringify(VIEWER_PERFORMANCE_NAMES.projectionInteractive)}, 'measure').length > 0`) ? true : null, "生产项目关系图可交互");
		},
	);
	if (projectResources.some((entry) => /cytoscape-fcose|registerFcose/i.test(entry.path))) throw new Error("生产项目关系冷路径不应请求 fCoSE");
	if (projectResources.some((entry) => entry.path === `/data/graphs/${project.file}`)) throw new Error("生产项目关系冷路径不应请求完整事实图");
} finally {
	await server.close();
}
