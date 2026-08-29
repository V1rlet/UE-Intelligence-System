import assert from "node:assert/strict";
import test from "node:test";
import type { GraphFile } from "../adapters/adapter-interface.js";
import { evidenceNeighborhood, evidenceSymbolDetail, queryEvidenceChanges, searchEvidenceSymbols } from "../core/evidence/query.js";
import type { ChangeReport } from "../core/query/change-report.js";

const graph: GraphFile = {
	meta: { domain: "ue5_code", format_version: 2 },
	elements: {
		nodes: [
			{ data: { id: "UBravo", label: "Bravo", type: "uclass", domain: "ue5_code", module: "B", layer: "project", source_path: "B/Bravo.h", description: "detail" } },
			{ data: { id: "UAlpha", label: "Alpha", type: "uclass", domain: "ue5_code", module: "A", layer: "project" } },
		],
		edges: [{ data: { id: "edge", source: "UAlpha", target: "UBravo", relation: "uses", domain: "ue5_code" } }],
	},
};

test("symbol search and detail project canonical graph facts deterministically", () => {
	assert.deepEqual(searchEvidenceSymbols(graph, { limit: 1 }).symbols.map((item) => item.id), ["UAlpha"]);
	assert.deepEqual(searchEvidenceSymbols(graph, { module: "B" }).symbols.map((item) => item.id), ["UBravo"]);
	assert.deepEqual(evidenceSymbolDetail(graph, "UBravo")?.attributes, { description: "detail" });
	assert.equal(evidenceSymbolDetail(graph, "missing"), null);
});

test("one-hop neighborhoods use graph relations as the single connectivity owner", () => {
	const result = evidenceNeighborhood(graph, "UAlpha");
	assert.deepEqual(result?.symbols.map((item) => item.id), ["UAlpha", "UBravo"]);
	assert.deepEqual(result?.relations.map((item) => item.id), ["edge"]);
});

test("change queries reuse the report index and preserve change categories", () => {
	const report: ChangeReport = {
		format_version: 1,
		domain: "ue5_code",
		subsystem: "project",
		generated_at: "2026-08-13T00:00:00.000Z",
		generator: "test",
		baseline: { file: "before.cyto.json", generated_at: null, fingerprint: null },
		current: { file: "after.cyto.json", generated_at: null, fingerprint: null },
		summary: { nodes: { added: 1, removed: 0, changed: 0 }, edges: { added: 1, removed: 0, changed: 0 }, direct_nodes: 1, affected_nodes: 0, affected_modules: 1 },
		changes: {
			added_nodes: [{ id: "UBravo", label: "Bravo", type: "uclass", module: "B", source_path: "B/Bravo.h" }],
			removed_nodes: [], changed_nodes: [],
			added_edges: [{ id: "edge", source: "UAlpha", target: "UBravo", relation: "uses" }],
			removed_edges: [], changed_edges: [],
		},
		impact: { direct_node_ids: ["UBravo"], affected_node_ids: [], modules: [{ module: "B", direct: 1, affected: 0 }] },
	};
	const result = queryEvidenceChanges(report, { kind: "added", module: "B" });
	assert.equal(result.nodes[0].kind, "added");
	assert.equal(result.nodes[0].evidence.classification, "direct");
	assert.equal(result.relations[0].evidence.confidence, null);
});
