import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { assessEvidenceAccess, EVIDENCE_STATUS_FORMAT } from "../core/evidence/status.js";
import { SOURCE_PROVENANCE_SCHEMA_VERSION } from "../core/schema/graph-version.js";
import { buildSourceSnapshot } from "../core/source/source-evidence.js";
import { migrateV2GraphToEvidenceV3 } from "../core/schema/evidence-snapshot-v3.js";
import { managedArtifactName, publicationDirectories, publishDataGeneration, sha256 } from "../core/store/data-publication.js";
import { publishEvidenceSnapshotPair } from "../core/store/evidence-publication.js";
import { handleEvidenceQueries, readEvidenceStatus } from "../server/evidence.js";
import { changeReportPublicationBinding } from "../server/changes.js";

function fixture(sourceRoot?: string) {
	const root = mkdtempSync(join(tmpdir(), "graphbrain-evidence-"));
	const dataDir = join(root, "data");
	const directories = publicationDirectories(dataDir);
	mkdirSync(directories.graphs, { recursive: true });
	mkdirSync(directories.changes, { recursive: true });
	const source = sourceRoot ?? join(root, "Source");
	if (!sourceRoot) {
		mkdirSync(source);
		writeFileSync(join(source, "Current.cpp"), "void Current() {}\n", "utf8");
	}
	const snapshot = existsSync(source) ? buildSourceSnapshot([source]) : {
		roots: [source.replaceAll("\\", "/")],
		files: [], diagnostics: [],
		fingerprint: { algorithm: "sha256-path-content-v1" as const, value: "0".repeat(64), file_count: 0 },
	};
	const graph = `${JSON.stringify({
		meta: {
			domain: "ue5_code",
			subsystem: "project",
			format_version: 2,
			generated_at: "2030-01-01T00:00:00.000Z",
			generator: "ue5-code-adapter/extract-classes@0.3.0",
			provenance: {
				schema_version: SOURCE_PROVENANCE_SCHEMA_VERSION,
				status: "verified",
				source_kind: "working_tree",
				source_roots: snapshot.roots,
				fingerprint: snapshot.fingerprint,
			},
			coverage: {
				status: "complete", discovered_files: 1, consumed_files: 1,
				skipped_files: 0, failed_files: 0, diagnostics: [],
			},
		},
		elements: {
			nodes: [
				{ data: { id: "UCurrent", label: "UCurrent", type: "uclass", domain: "ue5_code", layer: "project", module: "Fixture", source_path: "Fixture/Current.cpp" } },
				{ data: { id: "UConsumer", label: "UConsumer", type: "uclass", domain: "ue5_code", layer: "project", module: "Fixture" } },
			],
			edges: [
				{ data: { id: "uses:UConsumer:UCurrent", source: "UConsumer", target: "UCurrent", relation: "depends_on", domain: "ue5_code" } },
			],
		},
	}, null, 2)}\n`;
	const published = publishDataGeneration({ directories, subsystem: "project", expectedRevision: 0, graphContent: graph });
	return { root, dataDir, source, directories, published, graph };
}

function responseProbe() {
	let body = "";
	const response = {
		statusCode: 0,
		setHeader() {},
		end(value?: string) { body = value ?? ""; },
	} as unknown as ServerResponse;
	return { response, json: () => JSON.parse(body) as Record<string, unknown> };
}

async function evidenceGet(dataDir: string, pathname: string, query: string) {
	const probe = responseProbe();
	const handled = await handleEvidenceQueries({
		req: { method: "GET", url: `${pathname}?${query}`, headers: {} } as IncomingMessage,
		res: probe.response,
		url: pathname,
		root: resolve("."),
		dataDir,
	});
	return { handled, status: probe.response.statusCode, body: probe.json() };
}

test("evidence status v1 reports current and stale snapshots without writing", (t) => {
	const current = fixture();
	t.after(() => rmSync(current.root, { recursive: true, force: true }));
	const publicationPath = join(current.directories.publications, "ue5_code.json");
	const graphPath = join(current.directories.graphs, current.published.generation.graph.file);
	const before = {
		publicationMtime: statSync(publicationPath).mtimeMs,
		graphMtime: statSync(graphPath).mtimeMs,
		files: readdirSync(current.directories.graphs),
	};
	let status = readEvidenceStatus(current.dataDir);
	assert.equal(status.format_version, EVIDENCE_STATUS_FORMAT);
	assert.equal(status.publication_revision, 1);
	assert.equal(status.snapshot_id, current.published.generation.id);
	assert.equal(status.freshness, "current");
	assert.equal(status.coverage.status, "complete");
	assert.equal(status.extractor.id, "ue5-code-adapter/extract-classes");
	assert.ok(status.extractor.capabilities.some((item) => item.id === "blueprint-runtime" && item.support === "unsupported"));
	assert.deepEqual(status.engine, { version: null, root_identity: null, status: "unverified" });
	assert.equal(statSync(publicationPath).mtimeMs, before.publicationMtime);
	assert.equal(statSync(graphPath).mtimeMs, before.graphMtime);
	assert.deepEqual(readdirSync(current.directories.graphs), before.files);

	writeFileSync(join(current.source, "Current.cpp"), "void Changed() {}\n", "utf8");
	status = readEvidenceStatus(current.dataDir);
	assert.equal(status.freshness, "stale");
	assert.equal(status.freshness_reason, "fingerprint-mismatch");
	assert.deepEqual(assessEvidenceAccess(status), {
		require_fresh: true,
		allowed: false,
		code: "EVIDENCE_STALE",
		diagnostic: `Evidence snapshot ${status.snapshot_id} is stale (fingerprint-mismatch).`,
	});
	assert.equal(assessEvidenceAccess(status, false).allowed, true, "human read-only callers may explicitly inspect stale evidence");
});

test("missing source roots and corrupt publication fail closed with stable diagnostics", (t) => {
	const missing = fixture(join(tmpdir(), `graphbrain-missing-source-${process.pid}-${Date.now()}`));
	t.after(() => rmSync(missing.root, { recursive: true, force: true }));
	const missingStatus = readEvidenceStatus(missing.dataDir);
	assert.equal(missingStatus.freshness, "unverified");
	assert.equal(missingStatus.freshness_reason, "missing-source-root");
	assert.equal(assessEvidenceAccess(missingStatus).code, "EVIDENCE_UNVERIFIED");

	writeFileSync(join(missing.directories.publications, "ue5_code.json"), "{broken", "utf8");
	const corrupt = readEvidenceStatus(missing.dataDir);
	assert.equal(corrupt.freshness, "unverified");
	assert.equal(corrupt.freshness_reason, "publication-state-invalid");
	assert.equal(corrupt.publication_revision, null);
	assert.equal(corrupt.snapshot_id, null);
	assert.ok(corrupt.coverage.diagnostics.some((item) => item.code === "publication-state-invalid"));
});

test("published graph identity is content addressed by the existing publication owner", () => {
	const content = "evidence";
	assert.equal(managedArtifactName("project", sha256(content), "graph").startsWith("ue5_code_project__gbtx-"), true);
});

test("change evidence declares whether its current snapshot is still the active publication", (t) => {
	const current = fixture();
	t.after(() => rmSync(current.root, { recursive: true, force: true }));
	const active = changeReportPublicationBinding(current.dataDir, {
		subsystem: "project",
		current: { file: current.published.generation.graph.file, generated_at: null, fingerprint: null },
	});
	assert.equal(active.current_snapshot_is_active_publication, true);
	assert.equal(active.active_snapshot_id, current.published.generation.id);
	assert.equal(active.publication_revision, 1);
	const historical = changeReportPublicationBinding(current.dataDir, {
		subsystem: "project",
		current: { file: "historical.cyto.json", generated_at: null, fingerprint: null },
	});
	assert.equal(historical.current_snapshot_is_active_publication, false);
});

test("evidence query endpoints expose stable ids, provenance, and fail-closed freshness", async (t) => {
	const current = fixture();
	t.after(() => rmSync(current.root, { recursive: true, force: true }));

	const search = await evidenceGet(current.dataDir, "/api/evidence/v1/symbols", "q=current");
	assert.equal(search.handled, true);
	assert.equal(search.status, 200, JSON.stringify(search.body));
	assert.equal(search.body.format_version, "graphbrain-evidence-query/1");
	const symbols = search.body.symbols as Array<Record<string, unknown>>;
	assert.equal(symbols[0].id, "UCurrent");
	assert.deepEqual(symbols[0].evidence, {
		classification: "direct", method: "direct", confidence: 1, capability: "declarations", diagnostic: null,
	});

	const neighborhood = await evidenceGet(current.dataDir, "/api/evidence/v1/neighborhood", "id=UCurrent&depth=1");
	assert.equal(neighborhood.status, 200);
	assert.equal((neighborhood.body.symbols as unknown[]).length, 2);
	assert.equal((neighborhood.body.relations as Array<Record<string, unknown>>)[0].id, "uses:UConsumer:UCurrent");
	assert.deepEqual((neighborhood.body.relations as Array<Record<string, unknown>>)[0].evidence, {
		classification: "derived", method: "unknown", confidence: null, capability: null,
		diagnostic: "graph-v2-relation-provenance-not-persisted",
	});

	writeFileSync(join(current.source, "Current.cpp"), "void Changed() {}\n", "utf8");
	const denied = await evidenceGet(current.dataDir, "/api/evidence/v1/symbol", "id=UCurrent");
	assert.equal(denied.status, 412);
	assert.equal(denied.body.code, "EVIDENCE_STALE");
	const explicitRead = await evidenceGet(current.dataDir, "/api/evidence/v1/symbol", "id=UCurrent&require_fresh=false");
	assert.equal(explicitRead.status, 200);
});

test("v3 publication round-trips through status and query APIs while retaining stable ids", async (t) => {
	const current = fixture();
	t.after(() => rmSync(current.root, { recursive: true, force: true }));
	const pair = migrateV2GraphToEvidenceV3({
		graph: JSON.parse(current.graph) as never,
		source: { ...current.published.generation.graph, generation_id: current.published.generation.id },
		engineCache: { engine_root: "C:/UE/Engine/Source", engine_classes: { UEngine: { header: "C:/UE/Engine/Source/Runtime/Engine.h", hash: "one" } } },
		engineAssociation: "5.8",
	});
	const publication = publishEvidenceSnapshotPair({
		dataDir: current.dataDir,
		pair,
		expectedRevision: 0,
		compatibilityV2GenerationId: current.published.generation.id,
	});
	const status = readEvidenceStatus(current.dataDir);
	assert.equal(status.snapshot_id, publication.generation.id);
	assert.deepEqual(status.engine, {
		version: "5.8",
		root_identity: pair.engine.identity.root_identity?.value ?? null,
		status: "verified",
	});
	const result = await evidenceGet(current.dataDir, "/api/evidence/v1/neighborhood", "id=UCurrent");
	assert.equal(result.status, 200, JSON.stringify(result.body));
	assert.equal((result.body.evidence_status as Record<string, unknown>).snapshot_id, publication.generation.id);
	const relation = (result.body.relations as Array<Record<string, unknown>>)[0];
	assert.equal(relation.id, "uses:UConsumer:UCurrent");
	assert.deepEqual(relation.evidence, {
		classification: "derived", method: "unknown", confidence: null, capability: "unknown",
		diagnostic: "relation-provenance-not-persisted",
	});
});
