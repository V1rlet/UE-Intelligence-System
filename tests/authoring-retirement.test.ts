import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { UE5_CODE_GRAPH_FORMAT } from "../core/schema/graph-version.js";
import { RETIRED_AUTHORING_PREFIXES } from "../server/retired-authoring-tools";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = <T>(path: string): T => JSON.parse(readFileSync(join(ROOT, path), "utf8")) as T;

test("destructive authoring migration has an explicit immutable receipt", () => {
	const receipt = readJson<{
		schema: string;
		user_approved_destructive_deletion: boolean;
		recoverable_from_graphbrain: boolean;
		retired_domains: string[];
		files: Array<{ path: string; bytes: number; sha256: string }>;
	}>("data/archive/authoring-platform-v1/deletion-manifest.json");
	assert.equal(receipt.schema, "graphbrain.authoring-platform-deletion/1");
	assert.equal(receipt.user_approved_destructive_deletion, true);
	assert.equal(receipt.recoverable_from_graphbrain, false);
	assert.deepEqual(receipt.retired_domains, ["design_workspace", "level_design", "narrative", "quest", "ue5_planned"]);
	assert.equal(receipt.files.length, 466);
	assert.ok(receipt.files.every((file) => file.bytes >= 0 && /^[a-f0-9]{64}$/.test(file.sha256)));

	const residualReceipt = readJson<{
		schema: string;
		user_approved_destructive_deletion: boolean;
		recoverable_from_graphbrain: boolean;
		deleted_targets: string[];
		files: Array<{ path: string; bytes: number; sha256: string }>;
	}>("data/archive/authoring-platform-v1/residual-deletion-manifest.json");
	assert.equal(residualReceipt.schema, "graphbrain.authoring-residual-deletion/1");
	assert.equal(residualReceipt.user_approved_destructive_deletion, true);
	assert.equal(residualReceipt.recoverable_from_graphbrain, false);
	assert.deepEqual(residualReceipt.deleted_targets, ["docs/design-system-cards", "prototypes"]);
	assert.equal(residualReceipt.files.length, 10);
	assert.ok(residualReceipt.files.every((file) => file.bytes >= 0 && /^[a-f0-9]{64}$/.test(file.sha256)));
});

test("retired data roots are absent and compatibility APIs are centralized", () => {
	for (const path of [
		"data/cross-domain", "data/design-packages", "data/doc-registry", "data/entity-registry",
		"data/reports", "data/standards", "data/task-packages", "data/workbench-acks.json",
		"docs/design-system-cards", "prototypes",
	]) assert.equal(existsSync(join(ROOT, path)), false, `${path} should be deleted`);
	assert.deepEqual(RETIRED_AUTHORING_PREFIXES, [
		"/api/design-deliveries", "/api/design-export", "/api/design-graph",
		"/api/doc-registry", "/api/entity-registry", "/api/planned-brief",
		"/api/planned-export", "/api/planned-graph", "/api/review-highlights",
		"/api/timeline", "/api/timeline-snapshot", "/api/workbench", "/api/world-anchors",
	]);
});

test("active graphs and annotations have one ue5_code owner", () => {
	for (const file of readdirSync(join(ROOT, "data", "graphs")).filter((name) => name.endsWith(".cyto.json"))) {
		const graph = readJson<{ meta?: { domain?: string; format_version?: number } }>(`data/graphs/${file}`);
		assert.equal(graph.meta?.domain, "ue5_code", file);
		assert.equal(graph.meta?.format_version, UE5_CODE_GRAPH_FORMAT, file);
	}
	const annotationFiles = readdirSync(join(ROOT, "data", "annotations")).filter((name) => name.endsWith("_annotations.json"));
	assert.deepEqual(annotationFiles, [], "legacy annotation arrays must not remain active beside reading-context");
	const context = readJson<{ format_version?: number; domain?: string; revision?: number; annotations?: Array<{ subsystem?: string }> }>("data/reading-context/ue5_code.json");
	assert.equal(context.format_version, 1);
	assert.equal(context.domain, "ue5_code");
	assert.ok((context.revision ?? 0) >= 1);
	assert.deepEqual([...new Set((context.annotations ?? []).map((entry) => entry.subsystem))].sort(), [
		"framework-reference", "gameplay-framework-reference", "lyra-architecture-reference",
	]);
});

test("retired and orphan annotations are preserved outside the active store with versioned manifests", () => {
	const retired = readJson<{ schema: string; files: unknown[] }>("data/archive/authoring-platform-v1/annotations/migration-manifest.json");
	const orphaned = readJson<{ schema: string; files: unknown[] }>("data/archive/authoring-platform-v1/annotations/orphaned-code/migration-manifest.json");
	assert.equal(retired.schema, "graphbrain.retired-annotations-migration/1");
	assert.equal(retired.files.length, 2);
	assert.equal(orphaned.schema, "graphbrain.orphan-code-annotations-migration/1");
	assert.equal(orphaned.files.length, 1);
});

test("legacy active annotations were recoverably migrated into reading-context", () => {
	const manifest = readJson<{ schema?: string; migrated_revision?: number; files?: Array<{ archive_path?: string; original_path?: string }> }>("data/archive/reading-context-v1/migration-manifest.json");
	assert.equal(manifest.schema, "graphbrain.reading-context-migration/1");
	assert.equal(manifest.migrated_revision, 1);
	assert.equal(manifest.files?.length, 3);
	for (const file of manifest.files ?? []) {
		assert.ok(file.archive_path && existsSync(join(ROOT, file.archive_path)), String(file.archive_path));
		assert.ok(file.original_path && !existsSync(join(ROOT, file.original_path)), String(file.original_path));
	}
});
