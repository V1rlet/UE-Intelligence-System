import assert from "node:assert/strict";
import test from "node:test";
import { architectureScopeElements } from "../viewer/components/mindmap/architectureProjection.js";
import type { GraphCatalogPreview } from "../viewer/src/graphCatalog.js";

const preview: GraphCatalogPreview = {
	format_version: 1,
	nodes: [
		{ id: "ProjectA", label: "ProjectA", group: "Project", type: "uclass" },
		{ id: "ProjectB", label: "ProjectB", group: "Project", type: "ustruct" },
		{ id: "EngineA", label: "EngineA", group: "Engine", type: "uclass" },
		{ id: "EngineFar", label: "EngineFar", group: "Engine", type: "uclass" },
	],
	edges: [
		{ source: "ProjectA", target: "ProjectB", type: "composes" },
		{ source: "ProjectA", target: "EngineA", type: "inherits" },
		{ source: "EngineA", target: "EngineFar", type: "depends_on" },
	],
};

test("architecture scope retains only primary facts and their direct external context", () => {
	const scope = architectureScopeElements(preview, "Project");
	assert.deepEqual(scope.nodes.map((node) => node.data.id), ["ProjectA", "ProjectB", "EngineA"]);
	assert.deepEqual(scope.edges.map((edge) => [edge.data.source, edge.data.relation, edge.data.target]), [
		["ProjectA", "composes", "ProjectB"],
		["ProjectA", "inherits", "EngineA"],
	]);
	assert.equal(scope.nodes.find((node) => node.data.id === "EngineA")?.data.architectureContext, true);
	assert.equal(scope.nodes.find((node) => node.data.id === "ProjectA")?.data.architectureContext, false);
});

test("architecture scope never promotes a transitive external node into the focused view", () => {
	const scope = architectureScopeElements(preview, "Project");
	assert.equal(scope.nodes.some((node) => node.data.id === "EngineFar"), false);
	assert.equal(scope.edges.some((edge) => edge.data.target === "EngineFar"), false);
});
