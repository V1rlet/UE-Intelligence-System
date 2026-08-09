import assert from "node:assert/strict";
import test from "node:test";
import cytoscape from "cytoscape";
import { buildLayeredArchitectureGraph, mindmapRelationPresentation } from "../viewer/components/mindmap/mindmapForest.js";
import { stylesheetFor } from "../viewer/styles/stylesheets.js";
import { architectureRelationFrame } from "../viewer/components/graph-view/GraphView.js";
import {
	decorateSemanticRelationEdge,
	directlyDirectedSemanticEdges,
	orientCodeTypeRelationForReading,
	relationPresentation,
	RELATION_LOOP_DELAY_MS,
} from "../viewer/components/graph-view/relationPresentation.js";

test("layered architecture keeps all code relations while deriving an acyclic layout trunk", () => {
	const forest = buildLayeredArchitectureGraph({
		nodes: ["A", "B", "C", "D"].map((id) => ({ data: { id, label: id, type: "uclass", domain: "ue5_code" }, position: { x: 999, y: 999 } })),
		edges: [
			{ data: { id: "a-b", source: "A", target: "B", relation: "creates" } },
			{ data: { id: "c-b", source: "C", target: "B", relation: "depends_on" } },
			{ data: { id: "b-c", source: "B", target: "C", relation: "configures" } },
		],
	});
	assert.deepEqual(forest.edges.map((edge) => edge.data.id), ["a-b", "b-c", "c-b"]);
	assert.ok(forest.edges.every((edge) => edge.data.architectureEdge === true));
	assert.deepEqual(forest.edges.filter((edge) => edge.data.forestSecondary).map((edge) => edge.data.id), ["c-b"]);
	assert.equal(forest.edges[0].data.label, "◆ 创建");
	assert.equal(forest.edges[1].data.label, "⚡ 配置");
	assert.ok(forest.nodes.every((node) => node.position !== undefined));
	const position = Object.fromEntries(forest.nodes.map((node) => [String(node.data.id), node.position]));
	assert.ok(position.A!.x < position.B!.x);
	assert.ok(position.B!.x < position.C!.x);
	assert.notDeepEqual(position.A, { x: 999, y: 999 });

	const reordered = buildLayeredArchitectureGraph({
		nodes: [...forest.nodes].reverse(),
		edges: [
			{ data: { id: "b-c", source: "B", target: "C", relation: "configures" } },
			{ data: { id: "c-b", source: "C", target: "B", relation: "depends_on" } },
			{ data: { id: "a-b", source: "A", target: "B", relation: "creates" } },
		],
	});
	assert.deepEqual(
		Object.fromEntries(reordered.nodes.map((node) => [String(node.data.id), node.position])),
		position,
	);
});

test("code relation semantics share one icon and motion registry", () => {
	assert.deepEqual(mindmapRelationPresentation("creates"), { icon: "◆", motion: "emit", label: "创建" });
	assert.equal(mindmapRelationPresentation("composes").icon, mindmapRelationPresentation("owns").icon);
	assert.equal(mindmapRelationPresentation("dispatches_to").motion, "flow");
	assert.equal(mindmapRelationPresentation("implements").motion, "type");
	assert.deepEqual(relationPresentation("custom_relation"), { icon: "•", motion: "related", label: "custom relation" });
});

test("hover relation animation advances, pauses, and resumes deterministically", () => {
	const start = architectureRelationFrame("flow", 0);
	const sourceRunning = architectureRelationFrame("flow", 80);
	const targetRunning = architectureRelationFrame("flow", 550);
	assert.equal(start.edge["line-style"], "dashed");
	assert.notEqual(start.edge["line-dash-offset"], targetRunning.edge["line-dash-offset"]);
	assert.notEqual(start.source["overlay-opacity"], sourceRunning.source["overlay-opacity"]);
	assert.notEqual(start.target["overlay-opacity"], targetRunning.target["overlay-opacity"]);
	const pauseStart = architectureRelationFrame("flow", 760);
	const pauseEnd = architectureRelationFrame("flow", 760 + RELATION_LOOP_DELAY_MS - 1);
	const restart = architectureRelationFrame("flow", 760 + RELATION_LOOP_DELAY_MS);
	assert.equal(pauseStart.edge["line-dash-offset"], pauseEnd.edge["line-dash-offset"]);
	assert.equal(pauseEnd.source["overlay-opacity"], restart.source["overlay-opacity"]);
});

test("code inheritance is displayed from contract to implementation without mutating model endpoints", () => {
	const modelEdge = { data: { id: "ACharacter--inherits-->APawn", source: "ACharacter", target: "APawn", relation: "inherits" } };
	const visual = decorateSemanticRelationEdge(orientCodeTypeRelationForReading(modelEdge, "ue5_code"));
	assert.equal(visual.data.source, "APawn");
	assert.equal(visual.data.target, "ACharacter");
	assert.equal(visual.data.modelSource, "ACharacter");
	assert.equal(visual.data.modelTarget, "APawn");
	assert.equal(visual.data.visualDirection, "base_to_derived");
	assert.equal(orientCodeTypeRelationForReading(modelEdge, "retired"), modelEdge);
});

test("node hover activates only directly emitted code relations", () => {
	const cy = cytoscape({
		headless: true,
		elements: {
			nodes: ["runtime", "thread", "session", "context", "incoming", "second-hop"].map((id) => ({ data: { id } })),
			edges: [
				decorateSemanticRelationEdge({ data: { id: "startup", source: "runtime", target: "thread", relation: "dispatches_to" } }),
				decorateSemanticRelationEdge({ data: { id: "session-edge", source: "runtime", target: "session", relation: "creates" } }),
				decorateSemanticRelationEdge({ data: { id: "context-edge", source: "runtime", target: "context", relation: "owns" } }),
				decorateSemanticRelationEdge({ data: { id: "incoming", source: "incoming", target: "runtime", relation: "depends_on" } }),
				decorateSemanticRelationEdge({ data: { id: "second-hop", source: "session", target: "second-hop", relation: "creates" } }),
			],
		},
	});
	try {
		assert.deepEqual(directlyDirectedSemanticEdges(cy.getElementById("runtime")).map((edge) => edge.id()).sort(), ["context-edge", "session-edge", "startup"]);
	} finally {
		cy.destroy();
	}
});

test("only the ue5_code stylesheet is available and architecture labels stay readable", () => {
	const rules = stylesheetFor("ue5_code") as unknown as Array<{ selector: string; style: Record<string, unknown> }>;
	const architectureRules = rules.filter((entry) => entry.selector === "edge[?architectureEdge]");
	const rule = architectureRules.at(-1);
	assert.ok(rule);
	assert.equal(rule.style["text-rotation"], "none");
	assert.equal(rule.style["text-background-opacity"], 0.96);
	assert.equal(architectureRules.find((entry) => entry.style["taxi-direction"])?.style["taxi-direction"], "auto");
	assert.throws(() => stylesheetFor("level_design"), /只提供 ue5_code/);
});
