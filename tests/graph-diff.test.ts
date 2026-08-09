// Graph Brain / core/query - on-demand code graph merge diff tests.
//
// 覆盖：
//   - added / removed / changed 三集合正确（节点 + 边）
//   - 同 id data 字段变化 → changed（label/type/size/嵌套对象/边 relation）
//   - 同 id data 全等 → 无 changed
//   - 顶层 position（布局产物）不参与比较——增量更新不动已有节点位置
//   - 与 id 级 diff（diffGraphElements）的 removed/added 语义一致

import assert from "node:assert/strict";
import test from "node:test";
import { diffGraphElements, diffGraphElementsDetailed } from "../core/query/graph-diff";

const N = (id: string, extra: Record<string, unknown> = {}) => ({
	data: { id, label: `L-${id}`, type: "uclass", ...extra },
});
const E = (id: string, source: string, target: string, relation = "inherits") => ({
	data: { id, source, target, relation },
});

test("详细 diff：纯新增节点与边", () => {
	const prev = { nodes: [N("A"), N("B")], edges: [E("e1", "A", "B")] };
	const curr = {
		nodes: [N("A"), N("B"), N("C"), N("D")],
		edges: [E("e1", "A", "B"), E("e2", "B", "C"), E("e3", "C", "D")],
	};
	const d = diffGraphElementsDetailed(prev, curr);
	assert.deepEqual(d.addedNodes.map((n) => n.data.id), ["C", "D"]);
	assert.deepEqual(d.addedEdges.map((e) => e.data.id), ["e2", "e3"]);
	assert.deepEqual(d.removedNodeIds, []);
	assert.deepEqual(d.removedEdgeIds, []);
	assert.deepEqual(d.changedNodes, []);
	assert.deepEqual(d.changedEdges, []);
});

test("详细 diff：纯删除节点与边", () => {
	const prev = { nodes: [N("A"), N("B"), N("C")], edges: [E("e1", "A", "B"), E("e2", "B", "C")] };
	const curr = { nodes: [N("A")], edges: [] };
	const d = diffGraphElementsDetailed(prev, curr);
	assert.deepEqual(d.removedNodeIds, ["B", "C"]);
	assert.deepEqual(d.removedEdgeIds, ["e1", "e2"]);
	assert.deepEqual(d.addedNodes, []);
	assert.deepEqual(d.addedEdges, []);
});

test("详细 diff：同 id 字段变化 → changed（label/type/size）", () => {
	const prev = { nodes: [N("A", { size: 30, system: "combat" })], edges: [] };
	const curr = {
		nodes: [N("A", { size: 48, system: "combat", description: "改过" })],
		edges: [],
	};
	const d = diffGraphElementsDetailed(prev, curr);
	assert.equal(d.changedNodes.length, 1);
	assert.equal(d.changedNodes[0].id, "A");
	// changed 携带完整新 data（增量通道直接 setData 用）
	assert.equal(d.changedNodes[0].data.label, "L-A");
	assert.equal(d.changedNodes[0].data.size, 48);
	assert.equal(d.changedNodes[0].data.description, "改过");
	assert.deepEqual(d.addedNodes, []);
	assert.deepEqual(d.removedNodeIds, []);
});

test("详细 diff：嵌套对象字段变化 → changed", () => {
	const metrics = { in_degree: 2, out_degree: 1 };
	const prev = { nodes: [N("A", { metrics })], edges: [] };
	const curr = { nodes: [N("A", { metrics: { in_degree: 2, out_degree: 3 } })], edges: [] };
	const d = diffGraphElementsDetailed(prev, curr);
	assert.equal(d.changedNodes.length, 1, "嵌套对象深层变化必须报出");
});

test("详细 diff：同 id data 全等 → 无 changed", () => {
	const prev = { nodes: [N("A"), N("B")], edges: [E("e1", "A", "B")] };
	// 完全相同的结构与 data（新的对象引用）
	const curr = { nodes: [N("A"), N("B")], edges: [E("e1", "A", "B")] };
	const d = diffGraphElementsDetailed(prev, curr);
	assert.deepEqual(d.changedNodes, []);
	assert.deepEqual(d.changedEdges, []);
	assert.deepEqual(d.addedNodes, []);
	assert.deepEqual(d.removedNodeIds, []);
});

test("详细 diff：JSON 对象成员顺序不构成事实变化", () => {
	const prev = { nodes: [N("A", { api: { flags: { callable: true, pure: false }, category: "Test" } })], edges: [] };
	const curr = { nodes: [N("A", { api: { category: "Test", flags: { pure: false, callable: true } } })], edges: [] };
	assert.deepEqual(diffGraphElementsDetailed(prev, curr).changedNodes, []);
});

test("详细 diff：边 relation 变化 → changedEdges", () => {
	const prev = { nodes: [N("A"), N("B")], edges: [E("e1", "A", "B", "inherits")] };
	const curr = { nodes: [N("A"), N("B")], edges: [E("e1", "A", "B", "implements")] };
	const d = diffGraphElementsDetailed(prev, curr);
	assert.deepEqual(d.changedEdges, [{ id: "e1", data: { id: "e1", source: "A", target: "B", relation: "implements" } }]);
	assert.deepEqual(d.changedNodes, []);
});

test("详细 diff：顶层 position（布局产物）不参与比较", () => {
	const prev = { nodes: [{ ...N("A"), position: { x: 0, y: 0 } }], edges: [] };
	const curr = { nodes: [{ ...N("A"), position: { x: 999, y: 999 } }], edges: [] };
	const d = diffGraphElementsDetailed(prev, curr);
	assert.deepEqual(d.changedNodes, [], "position 移动不得触发增量 setData/重建");
});

test("详细 diff：removed/added 与 id 级 diff 语义一致", () => {
	const prev = { nodes: [N("A"), N("B"), N("C")], edges: [E("e1", "A", "B")] };
	const curr = {
		nodes: [N("A"), N("B", { description: "字段变了" }), N("D")], // C 没了、D 新增；B 字段也变了
		edges: [E("e1", "A", "B"), E("e2", "B", "D")],
	};
	const detailed = diffGraphElementsDetailed(prev, curr);
	const idLevel = diffGraphElements(prev, curr);
	// id 级语义：新增节点集 / 删除节点 id 集一致
	assert.deepEqual(
		[...detailed.addedNodes.map((n) => n.data.id)].sort(),
		[...idLevel.addedNodeIds].sort(),
	);
	assert.deepEqual(
		[...detailed.removedNodeIds].sort(),
		idLevel.removedNodes.map((n) => n.id).sort(),
	);
	// 字段级增量：B 变了但未增删
	assert.deepEqual(detailed.changedNodes.map((n) => n.id), ["B"]);
});
