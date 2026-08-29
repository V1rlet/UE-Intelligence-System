import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	loadEvidenceRefreshConfig,
	refreshProjectEvidence,
	resolveEvidenceRefreshProject,
	type EvidenceRefreshProject,
} from "../core/evidence/refresh.js";

const project: EvidenceRefreshProject = {
	name: "Fixture",
	root: "C:/Fixture",
	vcs: "lore",
	domain: "ue5_code",
	subsystem: "project",
	trigger_extensions: [".h", ".cpp", ".Build.cs"],
	extract: { roots: ["C:/Fixture/Source"], out: "data/graphs", uproject: "C:/Fixture/Fixture.uproject" },
	scan_annotations: true,
};

test("refresh declaration is the shared source for project selection", (t) => {
	const root = mkdtempSync(join(tmpdir(), "graphbrain-refresh-config-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const path = join(root, "hook-projects.json");
	writeFileSync(path, JSON.stringify({ projects: [project] }), "utf8");
	const config = loadEvidenceRefreshConfig(path);
	assert.equal(resolveEvidenceRefreshProject(config).name, "Fixture");
	assert.equal(resolveEvidenceRefreshProject(config).extract.uproject, "C:/Fixture/Fixture.uproject");
	assert.equal(resolveEvidenceRefreshProject(config, "fixture").subsystem, "project");
	assert.throws(() => resolveEvidenceRefreshProject(config, "unknown"), /unknown evidence refresh project/);
});

test("explicit refresh runs extract then annotations and Build.cs is a trigger", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "graphbrain-refresh-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const calls: string[] = [];
	let extractArgs: string[] = [];
	const result = await refreshProjectEvidence({
		project,
		lockPath: join(root, "refresh.lock"),
		triggerFiles: ["Source/Fixture/Fixture.Build.cs"],
		runStep: (script, args) => {
			calls.push(script);
			if (script.endsWith("extract-classes.ts")) extractArgs = args;
			return 0;
		},
	});
	assert.equal(result.status, "refreshed");
	assert.deepEqual(calls, ["adapters/ue5-code/extract-classes.ts", "core/annotation/scan-stale.ts"]);
	assert.deepEqual(extractArgs.slice(-2), ["--uproject", "C:/Fixture/Fixture.uproject"]);
});

test("refresh skips irrelevant changes, fails without scanning, and rejects a live concurrent owner", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "graphbrain-refresh-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const lockPath = join(root, "refresh.lock");
	let calls = 0;
	const skipped = await refreshProjectEvidence({
		project, lockPath, triggerFiles: ["README.md"], runStep: () => { calls++; return 0; },
	});
	assert.equal(skipped.status, "skipped");
	assert.equal(calls, 0);

	const failed = await refreshProjectEvidence({
		project, lockPath, runStep: () => { calls++; return 7; },
	});
	assert.deepEqual(failed, { status: "failed", project: "Fixture", stage: "extract", exit_code: 7, matched_files: null });
	assert.equal(calls, 1, "annotation scan must not run after extraction failure");

	mkdirSync(root, { recursive: true });
	writeFileSync(lockPath, `${process.pid} ${new Date().toISOString()}\n`, "utf8");
	const busy = await refreshProjectEvidence({ project, lockPath, runStep: () => 0 });
	assert.equal(busy.status, "busy");
});

test("refresh keeps the cross-process lock held across awaited async steps", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "graphbrain-refresh-async-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const lockPath = join(root, "refresh.lock");
	const busyDuringStep: boolean[] = [];
	const result = await refreshProjectEvidence({
		project,
		lockPath,
		runStep: async () => {
			// runStep 挂起期间锁必须仍被持有：并发 refresh 只能看到 busy。
			busyDuringStep.push((await refreshProjectEvidence({ project, lockPath, runStep: () => 0 })).status === "busy");
			return 0;
		},
	});
	assert.equal(result.status, "refreshed");
	assert.equal(busyDuringStep.length, 2);
	assert.ok(busyDuringStep.every(Boolean), "async action 进行中锁不得被释放");
});
