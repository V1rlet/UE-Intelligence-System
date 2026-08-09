// Graph Brain / core/query - 图分析算法库测试：投影、回路、耦合、影响面、正向闭包、基线比较、文件种子。

import assert from "node:assert/strict";
import test from "node:test";
import {
	couplingReport,
	diffCycles,
	findCycles,
	forwardClosure,
	impactAnalysis,
	projectGraph,
	resolveSeedsFromFiles,
	type CycleFinding,
	type GraphShape,
} from "../core/query/analysis.js";

/** A→B→C→A 循环 + D→E→F 直线链。 */
function cyclicGraph(): GraphShape {
	return {
		meta: { domain: "ue5_code", subsystem: "project", format_version: 2 },
		elements: {
			nodes: [
				{ data: { id: "A", type: "uclass", module: "Core", source_path: "A.h" } },
				{ data: { id: "B", type: "uclass", module: "Core", source_path: "B.h" } },
				{ data: { id: "C", type: "uclass", module: "Game", source_path: "C.h" } },
				{ data: { id: "D", type: "uclass", module: "Game", source_path: "D.h" } },
				{ data: { id: "E", type: "uclass", module: "Game", source_path: "E.h" } },
				{ data: { id: "F", type: "uclass", module: "Util", source_path: "F.h" } },
				// 展示/函数节点不应成为分析单元或制造假依赖。
				{ data: { id: "AFoo::Run", type: "ufunction", parent: "A" } },
				{ data: { id: "folder:Core", type: "folder" } },
			],
			edges: [
				{ data: { id: "e1", source: "A", target: "B", relation: "depends_on" } },
				{ data: { id: "e2", source: "B", target: "C", relation: "depends_on" } },
				{ data: { id: "e3", source: "C", target: "A", relation: "depends_on" } },
				{ data: { id: "e4", source: "D", target: "E", relation: "depends_on" } },
				{ data: { id: "e5", source: "E", target: "F", relation: "inherits" } },
				// 函数级边归并回类 + 结构边剔除。
				{ data: { id: "e6", source: "AFoo::Run", target: "B", relation: "calls" } },
				{ data: { id: "e7", source: "A", target: "folder:Core", relation: "contains" } },
			],
		},
	};
}

test("projectGraph folds function endpoints, drops structure edges and self-dependencies", () => {
	const pg = projectGraph(cyclicGraph());
	assert.ok(!pg.units.includes("AFoo::Run"), "函数端点不得成为分析单元");
	assert.ok(!pg.units.includes("folder:Core"), "文件夹不得成为分析单元");
	// e6 函数级边归并后 A→B 已存在（e1），不重复计数；e7 contains 剔除。
	assert.equal(pg.pairCount, 5, "依赖边应为 A→B、B→C、C→A、D→E、E→F 五对");
	assert.deepEqual([...pg.out.get("A")!].sort(), ["B"]);
	assert.deepEqual([...pg.in.get("C")!].sort(), ["B"]);
});

test("findCycles detects the A-B-C SCC with an example cycle", () => {
	const pg = projectGraph(cyclicGraph());
	const cycles = findCycles(pg);
	const abc = cycles.find((c) => c.nodes.includes("A") && c.nodes.includes("B") && c.nodes.includes("C"));
	assert.ok(abc, "A/B/C 应构成一个强连通分量");
	assert.equal(abc!.exampleCycle.length >= 2, true);
	assert.equal(abc!.exampleCycle[0], abc!.exampleCycle[abc!.exampleCycle.length - 1], "示例环首尾同点");
	assert.ok(!cycles.some((c) => c.nodes.includes("D") && c.nodes.includes("E") && c.nodes.includes("F")), "直线链不得报环");
});

test("impactAnalysis walks the reverse closure of a seed", () => {
	const pg = projectGraph(cyclicGraph());
	// 改 C 波及依赖它的 B、A（反向闭包）。
	const report = impactAnalysis(pg, ["C"]);
	assert.deepEqual(report.seeds, ["C"]);
	assert.equal(report.totalAffected, 2);
	assert.deepEqual(report.byDepth[0].nodes, ["B"]);
	assert.deepEqual(report.byDepth[1].nodes, ["A"]);
	assert.deepEqual(report.unknownSeeds, []);
	// 未知种子被隔离报告。
	const withUnknown = impactAnalysis(pg, ["C", "Ghost"]);
	assert.deepEqual(withUnknown.unknownSeeds, ["Ghost"]);
});

test("forwardClosure walks the forward dependency closure of a seed", () => {
	const pg = projectGraph(cyclicGraph());
	const report = forwardClosure(pg, ["D"]);
	assert.equal(report.totalAffected, 2, "D 依赖 E 与 F（正向闭包）");
	assert.deepEqual(report.byDepth[0].nodes, ["E"]);
	assert.deepEqual(report.byDepth[1].nodes, ["F"]);
});

test("couplingReport computes fan-in/out, betweenness and group instability", () => {
	const pg = projectGraph(cyclicGraph());
	const report = couplingReport(pg, "module");
	assert.equal(report.groupBy, "module");
	const a = report.nodes.find((n) => n.id === "A")!;
	assert.equal(a.fanIn, 1, "A 被 C 依赖");
	assert.equal(a.fanOut, 1, "A 依赖 B");
	const core = report.groups.find((g) => g.group === "Core")!;
	assert.ok(core.internalPairs >= 1, "Core 内 A→B 为内部耦合");
	const util = report.groups.find((g) => g.group === "Util")!;
	assert.equal(util.afferent, 1, "F 被 E 依赖");
});

test("diffCycles separates added, removed and unchanged cycles by node set", () => {
	const baseline: CycleFinding[] = [
		{ nodes: ["A", "B", "C"], exampleCycle: ["A", "B", "C", "A"] },
	];
	const current: CycleFinding[] = [
		{ nodes: ["A", "B", "C"], exampleCycle: ["A", "B", "C", "A"] },
		{ nodes: ["D", "E", "F"], exampleCycle: ["D", "E", "F", "D"] },
	];
	const diff = diffCycles(baseline, current);
	assert.equal(diff.unchanged.length, 1);
	assert.deepEqual(diff.added.map((c) => c.nodes), [["D", "E", "F"]]);
	assert.equal(diff.removed.length, 0);
	// 消失方向。
	const shrunk = diffCycles(current, baseline);
	assert.equal(shrunk.removed.length, 1);
	assert.equal(shrunk.added.length, 0);
});

test("resolveSeedsFromFiles matches basenames and folds .cpp to .h", () => {
	const graph = cyclicGraph();
	assert.deepEqual(resolveSeedsFromFiles(graph, ["A.h", "F.h"]).sort(), ["A", "F"]);
	// .cpp 归并到同名 .h 的类。
	assert.deepEqual(resolveSeedsFromFiles(graph, ["Source/B.cpp"]), ["B"]);
	// 未知文件不产生种子。
	assert.deepEqual(resolveSeedsFromFiles(graph, ["Missing.h"]), []);
});
