import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { GraphFile } from "../adapters/adapter-interface.js";
import { checkGraphReferences, checkGraphSchema, type GraphShape } from "../core/schema/graph-checks.js";
import {
	engineIdentityFromCache,
	joinEvidenceSnapshotPairV3,
	migrateV2GraphToEvidenceV3,
	validateEvidenceSnapshotPairV3,
} from "../core/schema/evidence-snapshot-v3.js";
import { publicationDirectories, publishDataGeneration } from "../core/store/data-publication.js";
import {
	EvidencePublicationConflictError,
	evidencePublicationDirectories,
	loadEvidencePublicationState,
	publishEvidenceSnapshotPair,
	setEvidencePublicationMode,
} from "../core/store/evidence-publication.js";
import { resolvePublishedEvidence } from "../core/evidence/resolver.js";

function graph(): GraphFile {
	return {
		meta: {
			domain: "ue5_code", subsystem: "project", format_version: 2,
			generated_at: "2030-01-01T00:00:00.000Z", generator: "ue5-code-adapter/extract-classes@0.3.0",
			provenance: {
				schema_version: 1, status: "verified", source_kind: "working_tree",
				source_roots: ["C:/Project/Source"],
				fingerprint: { algorithm: "sha256-path-content-v1", value: "f".repeat(64), file_count: 1 },
			},
			coverage: { status: "complete", discovered_files: 1, consumed_files: 1, skipped_files: 0, failed_files: 0, diagnostics: [] },
		},
		elements: {
			nodes: [
				{ data: { id: "UProject", label: "Project", type: "uclass", domain: "ue5_code", layer: "project", source_path: "Source/Project.h" } },
				{ data: { id: "UEngine", label: "Engine", type: "uclass", domain: "ue5_code", layer: "engine", source_path: "Runtime/Engine.h" } },
			],
			edges: [
				{ data: { id: "uses:project:engine", source: "UProject", target: "UEngine", relation: "uses_member", domain: "ue5_code" } },
			],
		},
	};
}

function migrate(inputGraph = graph()) {
	return migrateV2GraphToEvidenceV3({
		graph: inputGraph,
		source: { file: "ue5_code_project__gbtx-0000000000000000.cyto.json", sha256: "a".repeat(64), generation_id: `generation-${"b".repeat(64)}` },
		engineCache: {
			engine_root: "C:/UE/Engine/Source",
			engine_classes: { UEngine: { header: "C:/UE/Engine/Source/Runtime/Engine.h", hash: "engine-hash" } },
		},
		engineAssociation: "5.8",
	});
}

test("v2 migration deterministically separates owners and persists heuristic provenance", () => {
	const first = migrate();
	const second = migrate();
	assert.deepEqual(first, second);
	assert.deepEqual(validateEvidenceSnapshotPairV3(first), []);
	assert.deepEqual(first.project.facts.nodes.map((item) => item.data.id), ["UProject"]);
	assert.deepEqual(first.engine.facts.nodes.map((item) => item.data.id), ["UEngine"]);
	assert.deepEqual(first.project.external_references.symbols, [{ stable_id: "UEngine", target: "engine" }]);
	assert.deepEqual(first.project.external_references.relations[0].data.evidence, {
		classification: "heuristic", confidence: 0.65, capability: "same-name-cpp-member-usage",
		source: { path: "Source/Project.h", span: null }, diagnostic: "same-name-member-usage-heuristic",
	});
	const joined = joinEvidenceSnapshotPairV3(first);
	assert.deepEqual(joined.elements.nodes.map((item) => item.data.id), ["UProject", "UEngine"]);
});

test("engine identity invalidates on cached header content changes without exposing the root path", () => {
	const base = { engine_root: "C:/UE/Engine/Source", engine_classes: { UEngine: { header: "C:/UE/Engine/Source/Runtime/Engine.h", hash: "one" } } };
	const first = engineIdentityFromCache(base, "5.8");
	const second = engineIdentityFromCache({ ...base, engine_classes: { UEngine: { ...base.engine_classes.UEngine, hash: "two" } } }, "5.8");
	assert.equal(first.status, "verified");
	assert.notEqual(first.header_fingerprint?.value, second.header_fingerprint?.value);
	assert.equal(JSON.stringify(first).includes("C:/UE"), false);
});

test("publication pair round-trips, protects conflicts, rolls back to v2, and fails closed on tampering", (t) => {
	const root = mkdtempSync(join(tmpdir(), "graphbrain-evidence-v3-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const dataDir = join(root, "data");
	const directories = publicationDirectories(dataDir);
	mkdirSync(directories.graphs, { recursive: true });
	const content = `${JSON.stringify(graph(), null, 2)}\n`;
	assert.deepEqual([...checkGraphSchema(graph()), ...checkGraphReferences(graph() as unknown as GraphShape)], []);
	const source = publishDataGeneration({ directories, subsystem: "project", expectedRevision: 0, graphContent: content });
	const pair = migrateV2GraphToEvidenceV3({
		graph: graph(),
		source: { ...source.generation.graph, generation_id: source.generation.id },
		engineCache: { engine_root: "C:/UE/Engine/Source", engine_classes: { UEngine: { header: "C:/UE/Engine/Source/Runtime/Engine.h", hash: "one" } } },
		engineAssociation: "5.8",
	});
	const published = publishEvidenceSnapshotPair({ dataDir, pair, expectedRevision: 0, compatibilityV2GenerationId: source.generation.id, now: "2030-01-01T00:00:01.000Z" });
	assert.equal(resolvePublishedEvidence(dataDir).mode, "v3");
	assert.equal(resolvePublishedEvidence(dataDir).graph.meta.format_version, 3);
	assert.throws(
		() => publishEvidenceSnapshotPair({ dataDir, pair, expectedRevision: 0, compatibilityV2GenerationId: source.generation.id }),
		(error: unknown) => error instanceof EvidencePublicationConflictError,
	);
	let state = setEvidencePublicationMode({ dataDir, expectedRevision: published.state.revision, mode: "v2-compatibility" });
	assert.equal(resolvePublishedEvidence(dataDir).mode, "v2-compatibility");
	state = setEvidencePublicationMode({ dataDir, expectedRevision: state.revision, mode: "v3", generationId: published.generation.id });
	assert.equal(resolvePublishedEvidence(dataDir).snapshot_id, published.generation.id);

	const evidenceDirectories = evidencePublicationDirectories(dataDir);
	const active = loadEvidencePublicationState(dataDir).generations[0];
	const projectPath = join(evidenceDirectories.project, active.project.file);
	const original = readFileSync(projectPath, "utf8");
	writeFileSync(projectPath, `${original} `);
	assert.throws(() => resolvePublishedEvidence(dataDir), /EVIDENCE_V3_SNAPSHOT_INVALID/);
});

test("validation rejects cross-owner relations that do not resolve", () => {
	const pair = migrate();
	pair.project.external_references.relations[0].data.target = "UMissing";
	assert.ok(validateEvidenceSnapshotPairV3(pair).some((item) => item.includes("external relation does not resolve")));
});
