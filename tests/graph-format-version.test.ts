import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
	downgradeGraphToV1,
	graphSourceRoots,
	migrateGraphToCurrent,
	UE5_CODE_GRAPH_FORMAT,
	type VersionedGraphRecord,
} from "../core/schema/graph-version.js";

test("all active graph files explicitly use the ue5_code format", () => {
	const directory = join(process.cwd(), "data", "graphs");
	const files = readdirSync(directory).filter((file) => file.endsWith(".cyto.json"));
	assert.ok(files.length > 0);
	for (const file of files) {
		const graph = JSON.parse(readFileSync(join(directory, file), "utf8").replace(/^\uFEFF/, ""));
		assert.equal(graph.meta?.domain, "ue5_code", file);
		assert.equal(graph.meta?.format_version, UE5_CODE_GRAPH_FORMAT, file);
	}
});

test("v1 migration is deterministic, idempotent, and does not invent provenance", () => {
	const legacy = {
		meta: {
			domain: "ue5_code",
			format_version: 1,
			generated_at: "2026-01-01T00:00:00.000Z",
			generator: "legacy-test",
			source_root: "C:/Project/Source;C:/Plugin/Source",
		},
		elements: { nodes: [], edges: [] },
	} as VersionedGraphRecord;
	const first = migrateGraphToCurrent(legacy);
	const second = migrateGraphToCurrent(first.graph);
	assert.equal(first.changed, true);
	assert.equal(second.changed, false);
	assert.equal(first.graph.meta.format_version, UE5_CODE_GRAPH_FORMAT);
	assert.equal(first.graph.meta.provenance?.status, "unknown");
	assert.equal(first.graph.meta.provenance?.fingerprint, undefined);
	assert.equal(first.graph.meta.coverage?.status, "unknown");
	assert.deepEqual(graphSourceRoots(first.graph.meta), ["C:/Project/Source", "C:/Plugin/Source"]);
	assert.equal("source_root" in first.graph.meta, false);
});

test("v2 rollback restores the v1 source-root adapter and drops v2-only evidence", () => {
	const legacy = {
		meta: {
			domain: "ue5_code",
			format_version: 1,
			generated_at: "2026-01-01T00:00:00.000Z",
			generator: "legacy-test",
			source_root: "C:/Project/Source",
		},
		elements: { nodes: [], edges: [] },
	} as VersionedGraphRecord;
	const current = migrateGraphToCurrent(legacy).graph;
	const rollback = downgradeGraphToV1(current);
	assert.equal(rollback.graph.meta.format_version, 1);
	assert.equal(rollback.graph.meta.source_root, "C:/Project/Source");
	assert.equal(rollback.graph.meta.provenance, undefined);
	assert.equal(rollback.graph.meta.coverage, undefined);
});
