import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { GraphFile } from "../adapters/adapter-interface.js";
import { buildChangeReport, checkChangeReportConsistency } from "../core/query/change-report.js";
import { buildChangeReportCatalog, normalizeChangeReportCatalogResponse } from "../core/query/change-report-catalog.js";
import { resolveCodeModule } from "../core/query/code-module.js";
import { checkChangeReportSchema } from "../core/schema/graph-checks.js";
import { changeReportCatalog, changeReportEntries } from "../server/changes.js";

const fingerprint = (value: string) => ({ status: "verified", fingerprint: { algorithm: "sha256-path-content-v1", value } });
const graph = (nodes: Array<Record<string, unknown>>, edges: Array<Record<string, unknown>>, value: string): GraphFile => ({
	meta: { domain: "ue5_code", subsystem: "project", format_version: 2, generated_at: "2026-08-09T00:00:00.000Z", provenance: fingerprint(value) },
	elements: {
		nodes: nodes.map((data) => ({ data: { domain: "ue5_code", label: String(data.id), type: "uclass", ...data } as GraphFile["elements"]["nodes"][number]["data"] })),
		edges: edges.map((data) => ({ data: { domain: "ue5_code", relation: "calls", ...data } as GraphFile["elements"]["edges"][number]["data"] })),
	},
});

test("change report ignores presentation metrics and computes one-hop impact from canonical edges", () => {
	const oldHash = "a".repeat(64);
	const newHash = "b".repeat(64);
	const baseline = graph([
		{ id: "A", module: "Core", metrics: { x: 1 }, note: "before" },
		{ id: "B", module: "UI" },
		{ id: "Gone", module: "Legacy" },
	], [{ id: "A-B", source: "A", target: "B" }], oldHash);
	const current = graph([
		{ id: "A", module: "Core", metrics: { x: 99 }, note: "after" },
		{ id: "B", module: "UI" },
		{ id: "New", module: "Core" },
	], [
		{ id: "A-B", source: "A", target: "B" },
		{ id: "New-B", source: "New", target: "B" },
	], newHash);

	const report = buildChangeReport(baseline, current, { baselineFile: "old.cyto.json", currentFile: "new.cyto.json", generatedAt: "2026-08-09T01:00:00.000Z" });
	assert.deepEqual(report.changes.changed_nodes.map((node) => [node.id, node.changed_fields]), [["A", ["note"]]]);
	assert.deepEqual(report.changes.added_nodes.map((node) => node.id), ["New"]);
	assert.deepEqual(report.changes.removed_nodes.map((node) => node.id), ["Gone"]);
	assert.deepEqual(report.impact.direct_node_ids, ["A", "Gone", "New"]);
	assert.deepEqual(report.impact.affected_node_ids, ["B"]);
	assert.equal(report.baseline.fingerprint, oldHash);
	assert.equal(report.current.fingerprint, newHash);
	assert.deepEqual(checkChangeReportSchema(report), []);
});

test("change report treats JSON object key order as non-semantic and rejects ambiguous ids", () => {
	const baseline = graph([{ id: "A", api: { flags: { callable: true, pure: false }, category: "Test" } }], [], "a".repeat(64));
	const current = graph([{ id: "A", api: { category: "Test", flags: { pure: false, callable: true } } }], [], "b".repeat(64));
	const report = buildChangeReport(baseline, current, { baselineFile: "old.cyto.json", currentFile: "new.cyto.json" });
	assert.deepEqual(report.changes.changed_nodes, []);
	const duplicate = graph([{ id: "A" }, { id: "A" }], [], "c".repeat(64));
	assert.throws(
		() => buildChangeReport(duplicate, current, { baselineFile: "duplicate.cyto.json", currentFile: "new.cyto.json" }),
		/基线节点 包含重复 id: A/,
	);
});

test("change report catalog publishes only supported versioned reports", () => {
	const directory = mkdtempSync(join(tmpdir(), "graphbrain-changes-"));
	try {
		const baseline = graph([{ id: "A" }], [], "a".repeat(64));
		const current = graph([{ id: "A" }, { id: "B" }], [], "b".repeat(64));
		const report = buildChangeReport(baseline, current, { baselineFile: "old.cyto.json", currentFile: "new.cyto.json", generatedAt: "2026-08-09T01:00:00.000Z" });
		writeFileSync(join(directory, "valid.change.json"), JSON.stringify(report));
		writeFileSync(join(directory, "invalid.change.json"), JSON.stringify({ format_version: 99, domain: "ue5_code" }));
		writeFileSync(join(directory, "malformed-v1.change.json"), JSON.stringify({ format_version: 1, domain: "ue5_code", generated_at: null }));
		const entries = changeReportEntries(directory);
		assert.equal(entries.length, 1);
		assert.equal(entries[0].file, "valid.change.json");
		assert.equal(entries[0].summary.nodes.added, 1);
		const catalog = changeReportCatalog(directory);
		assert.equal(catalog.format_version, 1);
		assert.equal(catalog.default_report, "valid.change.json");
		assert.deepEqual(catalog.reports, entries);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("change report validation rejects internally contradictory summaries and identities", () => {
	const baseline = graph([{ id: "A" }], [], "a".repeat(64));
	const current = graph([{ id: "A" }, { id: "B" }], [], "b".repeat(64));
	const report = buildChangeReport(baseline, current, { baselineFile: "old.cyto.json", currentFile: "new.cyto.json" });
	assert.deepEqual(checkChangeReportConsistency(report), []);
	const contradictory = structuredClone(report);
	contradictory.summary.nodes.added = 99;
	contradictory.impact.direct_node_ids = ["Ghost"];
	assert.deepEqual(checkChangeReportConsistency(contradictory), [
		"summary.nodes 与变化数组不一致（index 0）",
		"impact.direct_node_ids 与节点变化不一致",
	]);
});

test("change report catalog has an explicit deterministic default and one legacy adapter", () => {
	const entry = (file: string, generated_at: string) => ({
		file,
		format_version: 1 as const,
		subsystem: "project",
		generated_at,
		baseline: { file: "old.cyto.json", generated_at: null, fingerprint: null },
		current: { file: "new.cyto.json", generated_at: null, fingerprint: null },
		summary: { nodes: { added: 0, removed: 0, changed: 0 }, edges: { added: 0, removed: 0, changed: 0 }, direct_nodes: 0, affected_nodes: 0, affected_modules: 0 },
	});
	const older = entry("older.change.json", "2026-08-08T00:00:00.000Z");
	const latest = entry("latest.change.json", "2026-08-09T00:00:00.000Z");
	older.summary.nodes.changed = 1;
	const expected = buildChangeReportCatalog([older, latest]);
	assert.equal(expected.default_report, older.file);
	assert.deepEqual(expected.reports.map(({ file }) => file), [latest.file, older.file]);
	assert.deepEqual(normalizeChangeReportCatalogResponse([older, latest]), expected);
	assert.deepEqual(normalizeChangeReportCatalogResponse(expected), expected);
	assert.throws(() => normalizeChangeReportCatalogResponse({ ...expected, default_report: "missing.change.json" }), /默认报告无效/);
	assert.equal(buildChangeReportCatalog([latest]).default_report, latest.file);
});

test("module ownership has one deterministic resolver for explicit and structural facts", () => {
	assert.equal(resolveCodeModule({ module: "Explicit", source_path: "Other/Foo.h" }), "Explicit");
	assert.equal(resolveCodeModule({ source_path: "Sabotage/UI/Foo.h" }), "Sabotage");
	assert.equal(resolveCodeModule({ id: "dir:Source/Sabotage/Core" }), "Sabotage");
	assert.equal(resolveCodeModule({ id: "file:Engine/Source/Runtime/GameplayTasks/Foo" }), "GameplayTasks");
	assert.equal(resolveCodeModule({ id: "dir:Source" }), null);
});
