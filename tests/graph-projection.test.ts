import assert from "node:assert/strict";
import test from "node:test";
import { buildFileForestProjection } from "../core/query/graph-projection.js";
import { GRAPH_PROJECTION_FORMAT_VERSION, GRAPH_PROJECTION_KIND } from "../core/schema/graph-projection.js";
import { graphLoadModeSatisfied, loadGraphDocument } from "../viewer/src/loadGraphProjection.js";

function canonicalFixture() {
	return {
		meta: { domain: "ue5_code", format_version: 2, revision: 7, generated_at: "2026-08-09T00:00:00.000Z" },
		elements: {
			nodes: [
				{ data: { id: "root", type: "folder", label: "Source" } },
				{ data: { id: "file", type: "file", label: "Widget", classes: ["UWidget"] } },
				{ data: { id: "UWidget", type: "uclass", source_path: "Widget.h" } },
			],
			edges: [
				{ data: { id: "contains", source: "root", target: "file", relation: "contains" } },
				{ data: { id: "declares", source: "file", target: "UWidget", relation: "declares" } },
			],
		},
	};
}

test("GraphProjection v1 selects canonical forest facts without becoming a second owner", () => {
	const graph = canonicalFixture();
	const projection = buildFileForestProjection(graph, "project.cyto.json");
	assert.equal(projection.format_version, GRAPH_PROJECTION_FORMAT_VERSION);
	assert.equal(projection.kind, GRAPH_PROJECTION_KIND);
	assert.deepEqual(projection.elements.nodes.map((node) => node.data.id), ["root", "file"]);
	assert.deepEqual(projection.elements.edges.map((edge) => edge.data.id), ["contains"]);
	assert.equal(projection.elements.nodes[0], graph.elements.nodes[0], "projection must retain the canonical node object");
	assert.deepEqual(projection.stats, { canonical_nodes: 3, canonical_edges: 2, projected_nodes: 2, projected_edges: 1 });
	assert.deepEqual(projection.source, {
		file: "project.cyto.json",
		graph_format_version: 2,
		revision: 7,
		generated_at: "2026-08-09T00:00:00.000Z",
	});
});

test("graph load capability has one owner and prevents downgrade reload spinners", () => {
	assert.equal(graphLoadModeSatisfied("full", "projection"), true);
	assert.equal(graphLoadModeSatisfied("projection", "projection"), true);
	assert.equal(graphLoadModeSatisfied("full", "full"), true);
	assert.equal(graphLoadModeSatisfied("projection", "full"), false);
	assert.equal(graphLoadModeSatisfied(null, "projection"), false);
});

test("projection loader centralizes old-server fallback onto the canonical full graph", async () => {
	const originalFetch = globalThis.fetch;
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		if (url.startsWith("/api/graph-projection")) {
			return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
		}
		return new Response(JSON.stringify(canonicalFixture()), { status: 200, headers: { "Content-Type": "application/json" } });
	};
	try {
		const loaded = await loadGraphDocument("project.cyto.json", "projection");
		assert.equal(loaded.mode, "full");
		assert.equal(loaded.compatibility, "legacy-full");
		assert.deepEqual(requests, [
			"/api/graph-projection?file=project.cyto.json",
			"/data/graphs/project.cyto.json",
		]);
		assert.equal(loaded.graph.elements.nodes.length, 3);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
