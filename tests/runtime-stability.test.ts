import assert from "node:assert/strict";
import test from "node:test";
import {
	analyzeRuntimeStability,
	runtimeStabilityFailures,
	type RuntimeMetricSample,
} from "../core/service/runtime-stability.js";

function sample(cycle: number, heapMiB: number, nodes: number, listeners: number, documents = 1): RuntimeMetricSample {
	return { cycle, js_heap_used_bytes: heapMiB * 1024 * 1024, dom_nodes: nodes, event_listeners: listeners, documents };
}

test("runtime trend ignores warmup and calculates per-cycle retained slopes", () => {
	const trend = analyzeRuntimeStability([
		sample(1, 50, 100, 20),
		sample(2, 20, 100, 20),
		sample(3, 20.25, 102, 21),
		sample(4, 20.5, 104, 22),
	], 1);
	assert.equal(trend.heap_slope_mib_per_cycle, 0.25);
	assert.equal(trend.heap_growth_mib, 0.5);
	assert.equal(trend.dom_nodes_slope_per_cycle, 2);
	assert.equal(trend.event_listeners_slope_per_cycle, 1);
});

test("runtime budget failures identify each unbounded resource", () => {
	const failures = runtimeStabilityFailures({
		heap_slope_mib_per_cycle: 1,
		heap_growth_mib: 10,
		dom_nodes_slope_per_cycle: 20,
		event_listeners_slope_per_cycle: 5,
		max_documents: 3,
	}, {
		heap_slope_mib_per_cycle: 0.5,
		heap_growth_mib: 8,
		dom_nodes_slope_per_cycle: 10,
		event_listeners_slope_per_cycle: 2,
		max_documents: 1,
	});
	assert.equal(failures.length, 5);
});
