// Graph Brain / tests - 复合图邻域跨容器高亮回归测试
import assert from "node:assert/strict";
import test from "node:test";
import cytoscape from "cytoscape";
import { applyNeighborhoodHighlight, createHoverHighlightController } from "../viewer/components/graph-view/graphHighlight";
import { compoundNHopHood } from "../viewer/components/graph-view/neighborhood";

test("复合图一跳邻域包含跨容器邻接节点的父容器", () => {
	const cy = cytoscape({
		headless: true,
		elements: [
			{ data: { id: "module-a" } },
			{ data: { id: "module-b" } },
			{ data: { id: "same-module", parent: "module-a" } },
			{ data: { id: "selected", parent: "module-a" } },
			{ data: { id: "other-module", parent: "module-b" } },
			{ data: { id: "same-edge", source: "selected", target: "same-module" } },
			{ data: { id: "module-edge", source: "selected", target: "other-module" } },
		],
	});

	const hood = compoundNHopHood(cy.getElementById("selected"), 1);
	const ids = new Set(hood.map((element) => element.id()));

	assert.ok(ids.has("same-module"));
	assert.ok(ids.has("other-module"));
	assert.ok(ids.has("module-a"));
	assert.ok(ids.has("module-b"));
	assert.ok(ids.has("same-edge"));
	assert.ok(ids.has("module-edge"));
});

test("区域框的一跳邻域包含相邻区域框内的全部事实节点", () => {
	const cy = cytoscape({
		headless: true,
		elements: [
			{ data: { id: "region-a" } },
			{ data: { id: "region-b" } },
			{ data: { id: "a-fact", parent: "region-a" } },
			{ data: { id: "b-character", parent: "region-b" } },
			{ data: { id: "b-event", parent: "region-b" } },
			{ data: { id: "region-link", source: "region-a", target: "region-b" } },
		],
	});

	const hood = applyNeighborhoodHighlight(cy, cy.getElementById("region-a"), 1);
	const ids = new Set(hood.map((element) => element.id()));

	assert.ok(ids.has("a-fact"));
	assert.ok(ids.has("region-b"));
	assert.ok(ids.has("b-character"));
	assert.ok(ids.has("b-event"));
	assert.ok(cy.getElementById("b-character").hasClass("highlight-neighbor"));
	assert.ok(cy.getElementById("b-event").hasClass("highlight-neighbor"));
	assert.ok(!cy.getElementById("b-character").hasClass("dimmed"));
});

test("代码事实节点没有关系边时回退到同一直接容器", () => {
	const cy = cytoscape({
		headless: true,
		elements: [
			{ data: { id: "zone" } },
			{ data: { id: "room", parent: "zone" } },
			{ data: { id: "hazard", parent: "room" } },
			{ data: { id: "objective", parent: "room" } },
			{ data: { id: "other-room", parent: "zone" } },
		],
	});

	const hood = compoundNHopHood(cy.getElementById("hazard"), 1, { structuralFallback: true });
	const ids = new Set(hood.map((element) => element.id()));

	assert.ok(ids.has("room"));
	assert.ok(ids.has("objective"));
	assert.ok(ids.has("zone"));
	assert.ok(!ids.has("other-room"));
});

test("直接后继突出展开，直接前驱只作来源提示，非邻居被压暗", () => {
	const cy = cytoscape({
		headless: true,
		elements: [
			{ data: { id: "origin" } },
			{ data: { id: "successor" } },
			{ data: { id: "predecessor" } },
			{ data: { id: "unrelated" } },
			{ data: { id: "outgoing", source: "origin", target: "successor" } },
			{ data: { id: "incoming", source: "predecessor", target: "origin" } },
		],
	});

	applyNeighborhoodHighlight(cy, cy.getElementById("origin"), 1);
	assert.ok(cy.getElementById("origin").hasClass("highlight-origin"));
	assert.ok(cy.getElementById("successor").hasClass("highlight-successor"));
	assert.ok(cy.getElementById("outgoing").hasClass("highlight-successor"));
	assert.ok(cy.getElementById("predecessor").hasClass("highlight-predecessor"));
	assert.ok(cy.getElementById("incoming").hasClass("highlight-predecessor"));
	assert.ok(!cy.getElementById("predecessor").hasClass("highlight-successor"));
	assert.ok(!cy.getElementById("successor").hasClass("dimmed"));
	assert.ok(cy.getElementById("unrelated").hasClass("dimmed"));
});

test("复合节点交错 mouseout 不会清掉新进入节点的邻域", () => {
	const cy = cytoscape({
		headless: true,
		elements: [
			{ data: { id: "a" } },
			{ data: { id: "b" } },
			{ data: { id: "ab", source: "a", target: "b" } },
		],
	});
	const pending = new Map<number, () => void>();
	let token = 0;
	const controller = createHoverHighlightController(cy, {
		schedule: (callback) => { token += 1; pending.set(token, callback); return token; },
		cancel: (id) => { pending.delete(id); },
	});

	controller.enter(cy.getElementById("a"));
	controller.leave(cy.getElementById("a"));
	controller.enter(cy.getElementById("b"));
	for (const callback of pending.values()) callback();

	assert.ok(cy.getElementById("b").hasClass("highlight-origin"));
	assert.ok(cy.getElementById("a").hasClass("highlight-neighbor"));
});
