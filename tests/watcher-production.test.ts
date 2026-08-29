// V6 回归：生产 watcher 接线（A2，修 F-B）。
// ① 行为：进程内 startLoreWatcher（lore 替身 + fixture config/state）——头签名变化触发
//    慢提取（800ms）期间，事件循环上的并发定时器不被冻结（最大漂移 < 200ms），基线推进；
// ② 源码契约：release-server 的接线必须受 GRAPH_BRAIN_NO_WATCHER 约束且关闭时拆除
//    （部署验收环境靠这个变量隔离 watcher）。
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { buildLoreFixture, registerLoreProject } from "./fixtures/lore-shim.js";
import { startLoreWatcher, stopLoreWatcher } from "../core/hooks/lore-watcher.js";

const REPO_ROOT = resolve(createRequire(import.meta.url).resolve("../package.json"), "..");

function stateOf(statePath: string): unknown {
	return JSON.parse(readFileSync(statePath, "utf8"));
}

const delay = (ms: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms));

test("V6 行为回归：慢提取期间事件循环不冻结，基线随 runner 成功推进", async () => {
	const fixture = buildLoreFixture("graphbrain-v6-watcher-");
	try {
		registerLoreProject(fixture);
		fixture.setHead("SIG_A");
		fixture.writeRevision("SIG_B", "SIG_A", ["Source/Slow.h"]);
		// 替身 runner 经 runTsxAsync 继承本进程环境：直接设置并确保恢复。
		const savedEnv = { ...process.env };
		process.env.GRAPH_BRAIN_HOOK_RUNNER = fixture.runnerPath;
		process.env.RUNNER_MARKER = fixture.markerPath;
		process.env.RUNNER_EXIT_CODE = "0";
		process.env.RUNNER_DELAY_MS = "800";

		startLoreWatcher({ baseRoot: fixture.dir, configPath: fixture.configPath, statePath: fixture.statePath, intervalS: 1 });
		try {
			// 首跳（3s 延迟）建立基线
			const baselineDeadline = Date.now() + 8_000;
			while (Date.now() < baselineDeadline && !existsSync(fixture.statePath)) await delay(100);
			assert.deepEqual(stateOf(fixture.statePath), { Fixture: "SIG_A" }, "首轮 tick 必须只建基线");

			// 提交新修订：runner 将慢跑 800ms；采样并发定时器漂移证明事件循环不被提取阻塞。
			let maxDriftMs = 0;
			let sampling = true;
			const sampler = (async () => {
				let last = Date.now();
				while (sampling) {
					await delay(25);
					const now = Date.now();
					maxDriftMs = Math.max(maxDriftMs, now - last - 25);
					last = now;
				}
			})();

			fixture.setHead("SIG_B");
			const deadline = Date.now() + 10_000;
			while (Date.now() < deadline) {
				if (existsSync(fixture.statePath) && JSON.stringify(stateOf(fixture.statePath)).includes("SIG_B")) break;
				await delay(100);
			}
			sampling = false;
			await sampler;

			assert.ok(JSON.stringify(stateOf(fixture.statePath)).includes("SIG_B"), "慢 runner 完成后基线必须推进");
			assert.ok(maxDriftMs < 200, `慢提取期间定时器最大漂移 ${maxDriftMs}ms ≥ 200ms（事件循环疑似被阻塞）`);
			assert.ok(existsSync(fixture.markerPath), "慢 runner 必须被真实调用");
		} finally {
			stopLoreWatcher();
			process.env.GRAPH_BRAIN_HOOK_RUNNER = savedEnv.GRAPH_BRAIN_HOOK_RUNNER;
			process.env.RUNNER_MARKER = savedEnv.RUNNER_MARKER;
			process.env.RUNNER_EXIT_CODE = savedEnv.RUNNER_EXIT_CODE;
			process.env.RUNNER_DELAY_MS = savedEnv.RUNNER_DELAY_MS;
		}

		// stop 后不再有新 tick：改签名并等待超过一个轮询周期，状态必须保持
		fixture.setHead("SIG_C");
		await delay(1_500);
		assert.ok(!JSON.stringify(stateOf(fixture.statePath)).includes("SIG_C"), "stopLoreWatcher 后不得再推进基线");
	} finally {
		fixture.dispose();
	}
});

test("V6 源码契约：release-server 内嵌 watcher 受 GRAPH_BRAIN_NO_WATCHER 约束并在关闭时拆除", () => {
	const source = readFileSync(resolve(REPO_ROOT, "scripts/release-server.ts"), "utf8");
	assert.match(source, /GRAPH_BRAIN_NO_WATCHER === "1"/, "逃生阀必须是显式等于 1 的判断");
	assert.match(source, /startLoreWatcher\(\{ baseRoot: PROJECT_ROOT \}\)/, "生产形态必须以项目工作树为路径锚点启动 watcher");
	assert.match(source, /stopLoreWatcher\(\)/, "服务关闭路径必须拆除 watcher 定时器");
});
