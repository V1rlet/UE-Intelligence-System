// Graph Brain / service - retained-runtime trend analysis for browser soak reports.

export const RUNTIME_STABILITY_FORMAT_VERSION = 1 as const;

export interface RuntimeMetricSample {
	cycle: number;
	js_heap_used_bytes: number;
	dom_nodes: number;
	event_listeners: number;
	documents: number;
}

export interface RuntimeStabilityBudgets {
	heap_slope_mib_per_cycle: number;
	heap_growth_mib: number;
	dom_nodes_slope_per_cycle: number;
	event_listeners_slope_per_cycle: number;
	max_documents: number;
}

export interface RuntimeStabilityTrend {
	heap_slope_mib_per_cycle: number;
	heap_growth_mib: number;
	dom_nodes_slope_per_cycle: number;
	event_listeners_slope_per_cycle: number;
	max_documents: number;
}

export interface RuntimeStabilityReportV1 {
	format_version: typeof RUNTIME_STABILITY_FORMAT_VERSION;
	kind: "graphbrain_runtime_stability";
	base_url: string;
	started_at: string;
	completed_at: string;
	cycles: number;
	warmup_cycles: number;
	budgets: RuntimeStabilityBudgets;
	samples: RuntimeMetricSample[];
	trend: RuntimeStabilityTrend;
	runtime_diagnostics: string[];
	passed: boolean;
}

function slope(samples: RuntimeMetricSample[], read: (sample: RuntimeMetricSample) => number): number {
	if (samples.length < 2) return 0;
	const meanX = samples.reduce((sum, sample) => sum + sample.cycle, 0) / samples.length;
	const meanY = samples.reduce((sum, sample) => sum + read(sample), 0) / samples.length;
	let numerator = 0;
	let denominator = 0;
	for (const sample of samples) {
		const dx = sample.cycle - meanX;
		numerator += dx * (read(sample) - meanY);
		denominator += dx * dx;
	}
	return denominator === 0 ? 0 : numerator / denominator;
}

function rounded(value: number): number {
	return Number(value.toFixed(3));
}

export function analyzeRuntimeStability(
	samples: RuntimeMetricSample[],
	warmupCycles: number,
): RuntimeStabilityTrend {
	if (!Number.isSafeInteger(warmupCycles) || warmupCycles < 0) throw new Error("warmupCycles 必须是非负整数");
	const retained = samples.filter((sample) => sample.cycle > warmupCycles);
	if (retained.length < 2) throw new Error("warmup 后至少需要两个 runtime sample");
	const first = retained[0];
	const last = retained.at(-1)!;
	const mib = 1024 * 1024;
	return {
		heap_slope_mib_per_cycle: rounded(slope(retained, (sample) => sample.js_heap_used_bytes) / mib),
		heap_growth_mib: rounded((last.js_heap_used_bytes - first.js_heap_used_bytes) / mib),
		dom_nodes_slope_per_cycle: rounded(slope(retained, (sample) => sample.dom_nodes)),
		event_listeners_slope_per_cycle: rounded(slope(retained, (sample) => sample.event_listeners)),
		max_documents: Math.max(...retained.map((sample) => sample.documents)),
	};
}

export function runtimeStabilityFailures(
	trend: RuntimeStabilityTrend,
	budgets: RuntimeStabilityBudgets,
): string[] {
	const failures: string[] = [];
	if (trend.heap_slope_mib_per_cycle > budgets.heap_slope_mib_per_cycle) {
		failures.push(`堆内存斜率 ${trend.heap_slope_mib_per_cycle} MiB/cycle > ${budgets.heap_slope_mib_per_cycle}`);
	}
	if (trend.heap_growth_mib > budgets.heap_growth_mib) {
		failures.push(`堆内存净增长 ${trend.heap_growth_mib} MiB > ${budgets.heap_growth_mib}`);
	}
	if (trend.dom_nodes_slope_per_cycle > budgets.dom_nodes_slope_per_cycle) {
		failures.push(`DOM 节点斜率 ${trend.dom_nodes_slope_per_cycle}/cycle > ${budgets.dom_nodes_slope_per_cycle}`);
	}
	if (trend.event_listeners_slope_per_cycle > budgets.event_listeners_slope_per_cycle) {
		failures.push(`事件监听器斜率 ${trend.event_listeners_slope_per_cycle}/cycle > ${budgets.event_listeners_slope_per_cycle}`);
	}
	if (trend.max_documents > budgets.max_documents) {
		failures.push(`文档保留峰值 ${trend.max_documents} > ${budgets.max_documents}`);
	}
	return failures;
}
