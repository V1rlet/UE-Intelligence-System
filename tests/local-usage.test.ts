import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadLocalUsage, localUsagePath, recordLocalUsage, type LocalUsageKey } from "../core/usage/local-usage.js";
import { viewerWorkspaceUsage } from "../viewer/src/localUsage.js";

test("local usage stores only allowlisted aggregate counters", (t) => {
	const root = mkdtempSync(join(tmpdir(), "graphbrain-local-usage-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	recordLocalUsage(root, "evidence.symbols", { durationMs: 12.4 });
	recordLocalUsage(root, "evidence.refresh", { durationMs: 100, cacheHit: true });
	recordLocalUsage(root, "evidence.refresh", { durationMs: 50, cacheHit: false });
	recordLocalUsage(root, "evidence.refresh", { durationMs: 25, cacheHit: null });
	const summary = loadLocalUsage(root);
	assert.deepEqual(summary.metrics["evidence.symbols"], {
		count: 1, total_duration_ms: 12, cache_hits: 0, cache_misses: 0, cache_unknown: 0,
	});
	assert.deepEqual(summary.metrics["evidence.refresh"], {
		count: 3, total_duration_ms: 175, cache_hits: 1, cache_misses: 1, cache_unknown: 1,
	});
	const content = readFileSync(localUsagePath(root), "utf8");
	assert.equal(content.includes("query"), false);
	assert.throws(() => recordLocalUsage(root, "freeform.query" as LocalUsageKey), /allowlisted/);
});

test("viewer workspaces normalize to bounded aggregate events", () => {
	assert.equal(viewerWorkspaceUsage("home", "relations"), "workspace.overview");
	assert.equal(viewerWorkspaceUsage("architecture", "relations"), "workspace.explore.architecture");
	assert.equal(viewerWorkspaceUsage("code", "relations"), "workspace.explore.relations");
	assert.equal(viewerWorkspaceUsage("code", "api"), "workspace.explore.api");
	assert.equal(viewerWorkspaceUsage("changes", "api"), "workspace.changes");
});
