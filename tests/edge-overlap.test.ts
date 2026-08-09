import assert from "node:assert/strict";
import test from "node:test";
import cytoscape from "cytoscape";
import { resolveEdgeOverlaps } from "../viewer/components/graph-view/resolveOverlaps";

test("连线穿过非端点节点时会自动选择绕行曲线", () => {
	const cy = cytoscape({
		headless: true,
		styleEnabled: true,
		elements: [
			{ data: { id: "source" }, position: { x: -120, y: 0 } },
			{ data: { id: "blocker" }, position: { x: 0, y: 0 } },
			{ data: { id: "target" }, position: { x: 120, y: 0 } },
			{ data: { id: "edge", source: "source", target: "target" } },
		],
		style: [{ selector: "node", style: { width: 50, height: 50 } }],
		layout: { name: "preset" },
	});

	const changed = resolveEdgeOverlaps(cy);
	assert.equal(changed, 1);
	assert.notEqual(cy.getElementById("edge").data("routeOffset"), 0);
	cy.destroy();
});

test("无障碍的单条连线保持直达，不制造无意义弯曲", () => {
	const cy = cytoscape({
		headless: true,
		styleEnabled: true,
		elements: [
			{ data: { id: "source" }, position: { x: -120, y: 0 } },
			{ data: { id: "target" }, position: { x: 120, y: 0 } },
			{ data: { id: "edge", source: "source", target: "target" } },
		],
		style: [{ selector: "node", style: { width: 50, height: 50 } }],
		layout: { name: "preset" },
	});

	assert.equal(resolveEdgeOverlaps(cy), 0);
	assert.equal(cy.getElementById("edge").data("routeOffset"), undefined);
	cy.destroy();
});

test("强制直线关系不会被自动避障改成曲线", () => {
	const cy = cytoscape({
		headless: true,
		styleEnabled: true,
		elements: [
			{ data: { id: "source" }, position: { x: -120, y: 0 } },
			{ data: { id: "blocker" }, position: { x: 0, y: 0 } },
			{ data: { id: "target" }, position: { x: 120, y: 0 } },
			{ data: { id: "edge", source: "source", target: "target" }, classes: "spec-straight" },
		],
		style: [{ selector: "node", style: { width: 50, height: 50 } }],
		layout: { name: "preset" },
	});

	assert.equal(resolveEdgeOverlaps(cy), 0);
	assert.equal(cy.getElementById("edge").data("routeOffset"), undefined);
	assert.notEqual(cy.getElementById("edge").style("curve-style"), "unbundled-bezier");
	cy.destroy();
});
