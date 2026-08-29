// B4 回归：多项目端到端——两个注册项目在同一 hook-projects.json 下：
// ① 按名称/根路径解析互不串扰；② 各自锁独立、可并发刷新；③ 同项目并发刷新后者 busy。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	evidenceRefreshLockPath,
	loadEvidenceRefreshConfig,
	refreshProjectEvidence,
	resolveEvidenceRefreshProject,
} from "../core/evidence/refresh.js";

test("B4：多注册项目解析隔离、独立锁并发刷新、同锁 busy 语义", async () => {
	const root = mkdtempSync(join(tmpdir(), "graphbrain-b4-"));
	try {
		const repoA = join(root, "Alpha");
		const repoB = join(root, "Beta");
		mkdirSync(repoA, { recursive: true });
		mkdirSync(repoB, { recursive: true });
		const configPath = join(root, "hook-projects.json");
		writeFileSync(configPath, JSON.stringify({
			projects: [
				{ name: "Alpha", root: repoA, vcs: "git", domain: "ue5_code", subsystem: "alpha_project", trigger_extensions: [".h"], scan_annotations: false, extract: { roots: ["Source"], out: join(root, "outA") } },
				{ name: "Beta", root: repoB, vcs: "lore", domain: "ue5_code", subsystem: "beta_project", trigger_extensions: [".h"], scan_annotations: false, extract: { roots: ["Source"], out: join(root, "outB") } },
			],
		}), "utf8");

		const config = loadEvidenceRefreshConfig(configPath);
		const alpha = resolveEvidenceRefreshProject(config, "Alpha");
		const beta = resolveEvidenceRefreshProject(config, repoB);
		assert.equal(alpha.name, "Alpha");
		assert.equal(beta.name, "Beta");

		// 并发刷新（不同锁文件）：都应 refreshed
		const lockA = evidenceRefreshLockPath(repoA);
		const lockB = join(root, "logs", "hook.beta.lock");
		mkdirSync(join(root, "logs"), { recursive: true });
		const slowA = refreshProjectEvidence({
			project: alpha, lockPath: lockA, triggerFiles: null, onEvent: () => undefined,
			runStep: async () => { await new Promise<void>((r) => setTimeout(r, 120)); return 0; },
		});
		const betaResult = await refreshProjectEvidence({ project: beta, lockPath: lockB, runStep: () => 0 });
		assert.equal(betaResult.status, "refreshed", "另一个项目的刷新不得被 Alpha 阻塞");
		const alphaDone = await slowA;
		assert.equal(alphaDone.status, "refreshed");

		// 同项目并发：持锁期间第二个请求 busy
		let release!: () => void;
		const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
		const holder = refreshProjectEvidence({
			project: alpha, lockPath: lockA, triggerFiles: null,
			runStep: async () => { await gate; return 0; },
		});
		await new Promise<void>((r) => setTimeout(r, 50));
		const busy = await refreshProjectEvidence({ project: alpha, lockPath: lockA, runStep: () => 0 });
		assert.equal(busy.status, "busy", "同项目持锁期间的第二次刷新必须 busy");
		release();
		const held = await holder;
		assert.equal(held.status, "refreshed");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
