import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SOURCE_PROVENANCE_SCHEMA_VERSION } from "../core/schema/graph-version.js";
import { buildSourceSnapshot } from "../core/source/source-evidence.js";
import { graphCatalogEntries } from "../server/catalog.js";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "graphbrain-catalog-"));
	const graphs = join(root, "graphs");
	const source = join(root, "Source");
	mkdirSync(graphs);
	mkdirSync(source);
	const sourceFile = join(source, "Current.cpp");
	writeFileSync(sourceFile, "void Current() {}\n", "utf8");
	writeFileSync(join(graphs, "ue5_code_project.cyto.json"), JSON.stringify({
		meta: {
			domain: "ue5_code",
			subsystem: "project",
			format_version: 1,
			generated_at: "2026-01-01T00:00:00.000Z",
			source_root: source,
		},
		elements: {
			nodes: [
				{ data: { id: "Module", label: "Module", type: "module", source_path: "Source/Private/Secret.cpp" }, position: { x: 10, y: 20 } },
				{ data: { id: "Class", label: "Class", type: "uclass", parent: "Module" }, position: { x: 30, y: 40 } },
			],
			edges: [{ data: { id: "Module-Class", source: "Module", target: "Class", relation: "contains" } }],
		},
	}), "utf8");
	return { root, graphs, sourceFile };
}

test("catalog proves a v1 graph stale when source files are newer than extraction", () => {
	const current = fixture();
	try {
		const newer = new Date("2026-01-02T00:00:00.000Z");
		utimesSync(current.sourceFile, newer, newer);
		const [entry] = graphCatalogEntries(current.graphs);
		assert.equal(entry.generated_at, "2026-01-01T00:00:00.000Z");
		assert.equal(entry.freshness, "stale");
		assert.equal(entry.freshness_reason, "source-newer");
		assert.equal(entry.source_file_count, 1);
		assert.equal(entry.source_files_newer, 1);
	} finally {
		rmSync(current.root, { recursive: true, force: true });
	}
});

test("catalog exposes a bounded versioned preview without leaking full node facts", () => {
	const current = fixture();
	try {
		const [entry] = graphCatalogEntries(current.graphs);
		assert.equal(entry.preview?.format_version, 1);
		assert.deepEqual(entry.preview?.nodes.map((node) => node.id), ["Module", "Class"]);
		assert.deepEqual(entry.preview?.edges, [{ source: "Module", target: "Class", type: "contains" }]);
		assert.equal("source_path" in (entry.preview?.nodes[0] ?? {}), false);
		assert.deepEqual(entry.capabilities, {}, "non-forest graphs must not advertise the projection");
	} finally {
		rmSync(current.root, { recursive: true, force: true });
	}
});

test("catalog declares the versioned file-forest projection from canonical node types", () => {
	const current = fixture();
	try {
		writeFileSync(join(current.graphs, "ue5_code_project.cyto.json"), JSON.stringify({
			meta: { domain: "ue5_code", subsystem: "project", format_version: 2 },
			elements: {
				nodes: [
					{ data: { id: "Source", type: "folder" } },
					{ data: { id: "Source/Widget.h", type: "file" } },
				],
				edges: [{ data: { id: "contains", source: "Source", target: "Source/Widget.h", relation: "contains" } }],
			},
		}), "utf8");
		const [entry] = graphCatalogEntries(current.graphs);
		assert.deepEqual(entry.capabilities, { file_forest_projection: 1 });
	} finally {
		rmSync(current.root, { recursive: true, force: true });
	}
});

test("catalog proves a v2 graph current only when its content fingerprint matches", () => {
	const current = fixture();
	try {
		const snapshot = buildSourceSnapshot([join(current.root, "Source")]);
		assert.ok(snapshot.fingerprint);
		writeFileSync(join(current.graphs, "ue5_code_project.cyto.json"), JSON.stringify({
			meta: {
				domain: "ue5_code",
				subsystem: "project",
				format_version: 2,
				generated_at: "2030-01-01T00:00:00.000Z",
				generator: "test",
				provenance: {
					schema_version: SOURCE_PROVENANCE_SCHEMA_VERSION,
					status: "verified",
					source_kind: "working_tree",
					source_roots: snapshot.roots,
					fingerprint: snapshot.fingerprint,
				},
				coverage: { status: "complete", discovered_files: 1, consumed_files: 1, skipped_files: 0, failed_files: 0, diagnostics: [] },
			},
			elements: { nodes: [], edges: [] },
		}), "utf8");
		let [entry] = graphCatalogEntries(current.graphs);
		assert.equal(entry.freshness, "current");
		assert.equal(entry.freshness_reason, "fingerprint-match");

		writeFileSync(current.sourceFile, "void ChangedWithoutNewerMtime() {}\n", "utf8");
		const older = new Date("2025-12-31T00:00:00.000Z");
		utimesSync(current.sourceFile, older, older);
		[entry] = graphCatalogEntries(current.graphs);
		assert.equal(entry.source_files_newer, 0);
		assert.equal(entry.freshness, "stale");
		assert.equal(entry.freshness_reason, "fingerprint-mismatch");
	} finally {
		rmSync(current.root, { recursive: true, force: true });
	}
});

test("catalog never claims a v1 graph verified-current from mtimes alone", () => {
	const current = fixture();
	try {
		const older = new Date("2025-12-31T00:00:00.000Z");
		utimesSync(current.sourceFile, older, older);
		const [entry] = graphCatalogEntries(current.graphs);
		assert.equal(entry.freshness, "unverified");
		assert.equal(entry.freshness_reason, "v1-no-fingerprint");
		assert.equal(entry.source_files_newer, 0);
	} finally {
		rmSync(current.root, { recursive: true, force: true });
	}
});
