// V2 回归：lore-watcher 异步链路真实验证。
// 用编译的 lore CLI 替身（tests/fixtures/lore-shim.ts）配 fixture config/state 跑
// `lore-watcher.ts --once` 三轮：
// ① 首轮建基线不触发 runner；② 头签名变化触发替身 runner 且基线推进；
// ③ runner 失败（exit 1）时基线不推进，修复后下轮重试成功。
// GRAPH_BRAIN_HOOK_RUNNER 是方案批准的唯一小接口新增（默认仍为 post-commit-update.ts）。
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";
import { buildLoreFixture, registerLoreProject } from "./fixtures/lore-shim.js";

const REPO_ROOT = resolve(createRequire(import.meta.url).resolve("../package.json"), "..");
const TSX_CLI = join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

function spawnWatcherOnce(config: string, state: string, extraEnv: Record<string, string>): SpawnSyncReturns<Buffer> {
	return spawnSync(process.execPath, [TSX_CLI, "core/hooks/lore-watcher.ts", "--once", "--config", config, "--state", state], {
		cwd: REPO_ROOT,
		encoding: "buffer",
		windowsHide: true,
		env: { ...process.env, ...extraEnv },
	});
}

function stateOf(statePath: string): unknown {
	return JSON.parse(readFileSync(statePath, "utf8"));
}

test("V2 回归：watcher 三轮——建基线、触发 runner 推进基线、runner 失败保留基线", () => {
	const fixture = buildLoreFixture("graphbrain-v2-watcher-");
	try {
		registerLoreProject(fixture);
		fixture.setHead("SIG_A");
		fixture.writeRevision("SIG_B", "SIG_A", ["Source/NewFile.h"]);
		fixture.writeRevision("SIG_C", "SIG_B", ["Source/Existing.cpp"]);
		const env = { GRAPH_BRAIN_HOOK_RUNNER: fixture.runnerPath, RUNNER_MARKER: fixture.markerPath };

		// —— 轮 ①：首轮建基线，不触发 runner ——
		spawnWatcherOnce(fixture.configPath, fixture.statePath, env);
		assert.deepEqual(stateOf(fixture.statePath), { Fixture: "SIG_A" }, "首轮必须只写基线");
		assert.ok(!existsSync(fixture.markerPath), "首轮不得调用 runner");

		// —— 轮 ②：头签名变化 → 触发 runner，基线推进 ——
		fixture.setHead("SIG_B");
		const second = spawnWatcherOnce(fixture.configPath, fixture.statePath, { ...env, RUNNER_EXIT_CODE: "0" });
		assert.equal(second.status, 0, String(second.stderr));
		assert.deepEqual(stateOf(fixture.statePath), { Fixture: "SIG_B" }, "runner 成功后基线必须推进到新头");
		const calls = readFileSync(fixture.markerPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { argv: string[] });
		assert.equal(calls.length, 1);
		assert.equal(calls[0].argv[0], "--project");
		assert.equal(calls[0].argv[1], fixture.repoDir);
		assert.ok(calls[0].argv.includes("--files-from"), "完整清单必须以 --files-from 传递");
		assert.ok(calls[0].argv.includes("--config"));

		// —— 轮 ③：runner 失败（exit 1）→ 基线保留，重试成功后推进 ——
		fixture.setHead("SIG_C");
		const failed = spawnWatcherOnce(fixture.configPath, fixture.statePath, { ...env, RUNNER_EXIT_CODE: "1" });
		assert.equal(failed.status, 0, "--once 本身不因 runner 失败而失败（三态日志记录）");
		assert.deepEqual(stateOf(fixture.statePath), { Fixture: "SIG_B" }, "runner 失败时基线不得推进");
		assert.equal(readFileSync(fixture.markerPath, "utf8").trim().split("\n").length, 2, "失败轮也必须真实调用了 runner");

		const retried = spawnWatcherOnce(fixture.configPath, fixture.statePath, { ...env, RUNNER_EXIT_CODE: "0" });
		assert.equal(retried.status, 0, String(retried.stderr));
		assert.deepEqual(stateOf(fixture.statePath), { Fixture: "SIG_C" }, "下一轮重试成功后基线推进");
	} finally {
		fixture.dispose();
	}
});
