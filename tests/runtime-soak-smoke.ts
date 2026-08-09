// In-process workspace-switch soak gate. One browser document repeatedly moves
// through all GraphBrain destinations; forced-GC retained resource trends are
// written as a versioned diagnostic report.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	RUNTIME_STABILITY_FORMAT_VERSION,
	analyzeRuntimeStability,
	runtimeStabilityFailures,
	type RuntimeMetricSample,
	type RuntimeStabilityBudgets,
	type RuntimeStabilityReportV1,
} from "../core/service/runtime-stability.js";
import { BASE, delay, launchBrowser, navigate, resolveCodeFixture, waitForSelector } from "./browser-smoke-lib.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = resolve(ROOT, "logs", "smoke", "runtime-soak.json");

function readInteger(name: string, fallback: number, min: number, max: number): number {
	const raw = process.env[name];
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} 必须是 ${min}–${max} 的整数`);
	return value;
}

const cycles = readInteger("GB_SOAK_CYCLES", 30, 4, 600);
const warmupCycles = readInteger("GB_SOAK_WARMUP", Math.min(5, cycles - 2), 0, cycles - 2);
const settleMs = readInteger("GB_SOAK_SETTLE_MS", 180, 50, 5_000);
const budgets: RuntimeStabilityBudgets = {
	heap_slope_mib_per_cycle: 0.5,
	heap_growth_mib: 12,
	dom_nodes_slope_per_cycle: 30,
	event_listeners_slope_per_cycle: 8,
	max_documents: 1,
};

const fixture = await resolveCodeFixture();
const session = await launchBrowser("about:blank");
const startedAt = new Date().toISOString();
const runtimeDiagnostics: string[] = [];
const samples: RuntimeMetricSample[] = [];

const routes = [
	{ label: "home", path: "/?view=overview", selector: ".home-code-viewer" },
	{ label: "architecture", path: "/?view=explore&mode=architecture", selector: ".architecture-commandbar" },
	{ label: "relations", path: `/?view=explore&mode=relations&source=project&file=${encodeURIComponent(fixture.file)}`, selector: '.graph-wrap[data-layout-capability="forest"]' },
	{ label: "api", path: `/?view=explore&mode=api&source=project&file=${encodeURIComponent(fixture.file)}`, selector: ".api-view" },
	{ label: "changes", path: "/?view=changes", selector: ".change-row-card" },
] as const;

try {
	const { cdp } = session;
	cdp.on<{ exceptionDetails?: { text?: string; exception?: { description?: string; value?: unknown } } }>("Runtime.exceptionThrown", ({ exceptionDetails }) => {
		const detail = exceptionDetails?.exception?.description ?? exceptionDetails?.exception?.value ?? exceptionDetails?.text ?? "unknown";
		runtimeDiagnostics.push(`exception: ${String(detail)}`);
	});
	cdp.on<{ type?: string; args?: Array<{ value?: unknown; description?: string }> }>("Runtime.consoleAPICalled", ({ type, args }) => {
		if (type !== "error" && type !== "assert") return;
		runtimeDiagnostics.push(`console.${type}: ${(args ?? []).map((arg) => String(arg.value ?? arg.description ?? "")).join(" ")}`);
	});
	await cdp.send("Performance.enable");
	await cdp.send("HeapProfiler.enable");
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `
		window.__graphBrainSoakProblems = [];
		window.addEventListener('error', (event) => window.__graphBrainSoakProblems.push('error: ' + (event.message || 'unknown')));
		window.addEventListener('unhandledrejection', (event) => window.__graphBrainSoakProblems.push('rejection: ' + String(event.reason?.stack || event.reason || 'unknown')));
	` });
	await navigate(cdp, `${BASE}${routes[0].path}`, routes[0].selector);

	for (let cycle = 1; cycle <= cycles; cycle += 1) {
		for (const route of routes) {
			await cdp.evaluate(`history.pushState(null, '', ${JSON.stringify(route.path)}); window.dispatchEvent(new PopStateEvent('popstate'));`);
			await waitForSelector(cdp, route.selector);
			await delay(settleMs);
		}
		const pageProblems = await cdp.evaluate<string[]>("window.__graphBrainSoakProblems ?? []");
		for (const problem of pageProblems) runtimeDiagnostics.push(`cycle ${cycle}: ${problem}`);
		await cdp.evaluate("window.__graphBrainSoakProblems = []");
		await cdp.send("HeapProfiler.collectGarbage");
		await delay(50);
		const response = await cdp.send("Performance.getMetrics") as { metrics?: Array<{ name: string; value: number }> };
		const metrics = new Map((response.metrics ?? []).map((metric) => [metric.name, metric.value]));
		samples.push({
			cycle,
			js_heap_used_bytes: metrics.get("JSHeapUsedSize") ?? 0,
			dom_nodes: metrics.get("Nodes") ?? 0,
			event_listeners: metrics.get("JSEventListeners") ?? 0,
			documents: metrics.get("Documents") ?? 0,
		});
		console.log(`[runtime-soak] ${cycle}/${cycles} heap=${(samples.at(-1)!.js_heap_used_bytes / 1024 / 1024).toFixed(1)}MiB nodes=${samples.at(-1)!.dom_nodes} listeners=${samples.at(-1)!.event_listeners}`);
	}

	const trend = analyzeRuntimeStability(samples, warmupCycles);
	const failures = [...new Set(runtimeDiagnostics), ...runtimeStabilityFailures(trend, budgets)];
	const report: RuntimeStabilityReportV1 = {
		format_version: RUNTIME_STABILITY_FORMAT_VERSION,
		kind: "graphbrain_runtime_stability",
		base_url: BASE,
		started_at: startedAt,
		completed_at: new Date().toISOString(),
		cycles,
		warmup_cycles: warmupCycles,
		budgets,
		samples,
		trend,
		runtime_diagnostics: [...new Set(runtimeDiagnostics)],
		passed: failures.length === 0,
	};
	mkdirSync(dirname(REPORT), { recursive: true });
	writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	if (failures.length > 0) throw new Error(`长时稳定性门禁失败：${failures.join("；")}`);
	console.log(`[runtime-soak] 通过：heap slope ${trend.heap_slope_mib_per_cycle} MiB/cycle，DOM slope ${trend.dom_nodes_slope_per_cycle}/cycle，报告 ${REPORT}`);
} finally {
	await session.close();
}
