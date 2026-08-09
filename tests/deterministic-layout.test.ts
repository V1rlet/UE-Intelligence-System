// Graph Brain / tests - 中小图确定性布局种子
import assert from "node:assert/strict";
import test from "node:test";
import { deterministicSeedPositions } from "../viewer/components/graph-view/deterministicLayout";

const nodes = [
	{ id: "group-b" },
	{ id: "b2", parent: "group-b" },
	{ id: "b1", parent: "group-b" },
	{ id: "group-a" },
	{ id: "a1", parent: "group-a" },
	{ id: "standalone" },
];

test("布局种子不受输入顺序影响", () => {
	const forward = deterministicSeedPositions(nodes);
	const reverse = deterministicSeedPositions([...nodes].reverse());
	assert.deepEqual([...forward.entries()].sort(), [...reverse.entries()].sort());
});

test("同一复合组叶节点聚集，不同顶层组占据不同中心", () => {
	const positions = deterministicSeedPositions(nodes);
	const b1 = positions.get("b1")!;
	const b2 = positions.get("b2")!;
	const a1 = positions.get("a1")!;
	assert.ok(Math.hypot(b1.x - b2.x, b1.y - b2.y) < 180);
	assert.notDeepEqual(a1, positions.get("standalone"));
});

