// Browser-scale gate for the versioned Changes workspace.
import type { ChangeReport } from "../core/query/change-report.js";
import { VIEWER_PERFORMANCE_BUDGETS } from "../viewer/src/viewerPerformance.js";
import { BASE, launchBrowser, waitForSelector, waitUntil } from "./browser-smoke-lib.js";

const NODE_COUNT = VIEWER_PERFORMANCE_BUDGETS.changeScaleFacts / 2;
const EDGE_COUNT = VIEWER_PERFORMANCE_BUDGETS.changeScaleFacts - NODE_COUNT;
const REPORT_FILE = "scale-50000.change.json";

function nodeId(index: number): string {
	return `ScaleNode_${String(index).padStart(5, "0")}`;
}

function createReport(): ChangeReport {
	const addedNodes = Array.from({ length: NODE_COUNT }, (_, index) => ({
		id: nodeId(index),
		label: `Scale node ${index}`,
		type: index % 2 === 0 ? "uclass" : "ufunction",
		module: `Module${index % 10}`,
		source_path: `Source/Module${index % 10}/ScaleNode_${index}.h`,
	}));
	const addedEdges = Array.from({ length: EDGE_COUNT }, (_, index) => ({
		id: `scale-edge-${index}`,
		source: nodeId(index % NODE_COUNT),
		target: nodeId((index + 1) % NODE_COUNT),
		relation: index % 2 === 0 ? "inherits" : "depends_on",
	}));
	return {
		format_version: 1,
		domain: "ue5_code",
		subsystem: "scale-fixture",
		generated_at: "2026-08-09T00:00:00.000Z",
		generator: "graphbrain/change-scale-smoke@1",
		baseline: { file: "scale-before.cyto.json", generated_at: null, fingerprint: null },
		current: { file: "scale-after.cyto.json", generated_at: null, fingerprint: "scale-current" },
		summary: {
			nodes: { added: NODE_COUNT, removed: 0, changed: 0 },
			edges: { added: EDGE_COUNT, removed: 0, changed: 0 },
			direct_nodes: NODE_COUNT,
			affected_nodes: 0,
			affected_modules: 10,
		},
		changes: { added_nodes: addedNodes, removed_nodes: [], changed_nodes: [], added_edges: addedEdges, removed_edges: [], changed_edges: [] },
		impact: {
			direct_node_ids: addedNodes.map((node) => node.id),
			affected_node_ids: [],
			modules: Array.from({ length: 10 }, (_, index) => ({ module: `Module${index}`, direct: NODE_COUNT / 10, affected: 0 })),
		},
	};
}

const report = createReport();
const catalogEntry = {
	format_version: report.format_version,
	subsystem: report.subsystem,
	generated_at: report.generated_at,
	baseline: report.baseline,
	current: report.current,
	summary: report.summary,
	file: REPORT_FILE,
};
const catalogBody = Buffer.from(JSON.stringify({
	format_version: 1,
	default_report: REPORT_FILE,
	reports: [catalogEntry],
})).toString("base64");
const reportBody = Buffer.from(JSON.stringify(report)).toString("base64");

const session = await launchBrowser("about:blank", { windowSize: "1440,900" });
let interceptionError: Error | null = null;
try {
	const { cdp } = session;
	const removeListener = cdp.on<{ requestId: string; request: { url: string } }>("Fetch.requestPaused", (event) => {
		const path = new URL(event.request.url).pathname;
		const body = path === "/api/change-reports" ? catalogBody
			: path === `/api/change-reports/${REPORT_FILE}` ? reportBody
				: null;
		const response = body
			? cdp.send("Fetch.fulfillRequest", {
				requestId: event.requestId,
				responseCode: 200,
				responseHeaders: [{ name: "Content-Type", value: "application/json; charset=utf-8" }],
				body,
			})
			: cdp.send("Fetch.continueRequest", { requestId: event.requestId });
		void response.catch((reason) => { interceptionError = reason as Error; });
	});
	await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/change-reports*", requestStage: "Request" }] });
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `
		window.__graphBrainLongTasks = [];
		try {
			new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) window.__graphBrainLongTasks.push(entry.duration);
			}).observe({ type: 'longtask', buffered: true });
		} catch {}
	` });
	await cdp.send("Page.navigate", { url: `${BASE}/?view=changes` });
	await waitForSelector(cdp, ".changes-summary");
	await waitForSelector(cdp, ".change-row-card");
	await cdp.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
	if (interceptionError) throw interceptionError;

	const initial = await cdp.evaluate<{ interactiveMs: number; rows: number; elements: number; longestTaskMs: number; summary: string; overflow: number }>(`({
		interactiveMs: performance.now(),
		rows: document.querySelectorAll('.change-row-card').length,
		elements: document.querySelectorAll('*').length,
		longestTaskMs: Math.max(0, ...(window.__graphBrainLongTasks ?? [])),
		summary: document.querySelector('.changes-section-head > b')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
		overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
	})`);
	if (initial.interactiveMs > VIEWER_PERFORMANCE_BUDGETS.changeScaleInteractiveMs) throw new Error(`5 万变化事实可交互超预算：${initial.interactiveMs.toFixed(1)} ms`);
	if (initial.rows > 120 || initial.elements > VIEWER_PERFORMANCE_BUDGETS.changeScaleDomElements) throw new Error(`5 万变化事实 DOM 超预算：${JSON.stringify(initial)}`);
	if (!initial.summary.includes("2500") || !initial.summary.includes("25000")) throw new Error(`5 万变化事实默认模块计数异常：${initial.summary}`);
	if (initial.overflow > 1) throw new Error(`5 万变化事实发生 ${initial.overflow}px 横向溢出`);

	const filterStarted = await cdp.evaluate<boolean>(`(() => {
		const select = document.querySelector('.changes-module-filter select');
		if (!(select instanceof HTMLSelectElement) || !Array.from(select.options).some((option) => option.value === 'Module1')) return false;
		window.__graphBrainFilterStart = performance.now();
		select.value = 'Module1';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		return true;
	})()`);
	if (!filterStarted) throw new Error("5 万变化事实没有可切换的模块筛选");
	await waitUntil(async () => await cdp.evaluate<boolean>(`Array.from(document.querySelectorAll('.change-meta')).length > 0 && Array.from(document.querySelectorAll('.change-meta')).every((node) => node.textContent.includes('Module1'))`) ? true : null, "5 万变化事实模块筛选");
	await cdp.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
	const filterMs = await cdp.evaluate<number>("performance.now() - window.__graphBrainFilterStart");
	if (filterMs > VIEWER_PERFORMANCE_BUDGETS.changeScaleFilterMs) throw new Error(`5 万变化事实筛选超预算：${filterMs.toFixed(1)} ms`);

	const heap = await cdp.send("Runtime.getHeapUsage") as { usedSize: number };
	if (heap.usedSize > VIEWER_PERFORMANCE_BUDGETS.changeScaleHeapBytes) throw new Error(`5 万变化事实 JS 堆超预算：${heap.usedSize} B`);
	console.log(`[change-scale] ${VIEWER_PERFORMANCE_BUDGETS.changeScaleFacts.toLocaleString()} facts · interactive ${initial.interactiveMs.toFixed(1)} ms · filter ${filterMs.toFixed(1)} ms · DOM ${initial.elements} · heap ${(heap.usedSize / 1024 / 1024).toFixed(1)} MiB · longest task ${initial.longestTaskMs.toFixed(1)} ms`);

	removeListener();
} finally {
	await session.close();
}
