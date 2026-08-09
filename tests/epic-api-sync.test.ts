// Graph Brain / tests - Epic API 同步器：官方 slug 解析（含截断）与空壳缓存判定
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
	epicModuleCachePath,
	isModuleCacheMissingOrShell,
	isModuleUnpublished,
	officialModuleUrl,
	syncEpicApiModules,
} from "../adapters/ue5-code/epic-api-sync.js";

const makeCacheDir = () => mkdtempSync(join(tmpdir(), "graphbrain-epic-sync-"));

const writeRoot = (cacheDir: string, modules: { scope: string; module: string; url: string }[]) => {
	writeFileSync(
		join(cacheDir, "ue5.8-root.json"),
		JSON.stringify({ version: "5.8", source: "test", synced_at: new Date().toISOString(), modules }),
		"utf8",
	);
};

test("officialModuleUrl：精确命中、截断 slug 命中与未收录", () => {
	const cacheDir = makeCacheDir();
	try {
		writeRoot(cacheDir, [
			{ scope: "Runtime", module: "Engine", url: "https://example.test/API/Runtime/Engine" },
			{ scope: "Plugins", module: "AnimationLocomotionLibraryRuntim-", url: "https://example.test/API/Plugins/AnimationLocomotionLibraryRuntim-" },
		]);
		assert.equal(officialModuleUrl("Runtime", "Engine", cacheDir), "https://example.test/API/Runtime/Engine");
		// Epic 对超长模块名截断 slug（尾缀 "-"）；本地完整模块名必须命中截断条目
		assert.equal(
			officialModuleUrl("Plugins", "AnimationLocomotionLibraryRuntime", cacheDir),
			"https://example.test/API/Plugins/AnimationLocomotionLibraryRuntim-",
		);
		// scope 必须一致，跨 scope 不得串联
		assert.equal(officialModuleUrl("Runtime", "AnimationLocomotionLibraryRuntime", cacheDir), null);
		assert.equal(officialModuleUrl("Developer", "NotInRoot", cacheDir), null);
	} finally {
		rmSync(cacheDir, { recursive: true, force: true });
	}
});

test("isModuleCacheMissingOrShell：缺文件与历史空壳都算缺，正常缓存不算", () => {
	const cacheDir = makeCacheDir();
	try {
		assert.equal(isModuleCacheMissingOrShell("Runtime", "Engine", cacheDir), true, "无缓存文件应判缺失");

		const shellPath = epicModuleCachePath("Runtime", "Engine", cacheDir);
		mkdirSync(dirname(shellPath), { recursive: true });
		writeFileSync(shellPath, JSON.stringify({
			version: "5.8", scope: "Runtime", module: "Engine", source: "test",
			synced_at: new Date().toISOString(), metadata: {}, symbols: [],
		}), "utf8");
		assert.equal(isModuleCacheMissingOrShell("Runtime", "Engine", cacheDir), true, "0 符号且 0 元数据的空壳应判缺失");

		const okPath = epicModuleCachePath("Plugins", "AjaMediaOutput", cacheDir);
		mkdirSync(dirname(okPath), { recursive: true });
		writeFileSync(okPath, JSON.stringify({
			version: "5.8", scope: "Plugins", module: "AjaMediaOutput", source: "test",
			synced_at: new Date().toISOString(), metadata: { Name: "AjaMediaOutput" },
			symbols: [{ name: "UAjaMediaOutput", kind: "Classes", remarks: "", url: "https://example.test" }],
		}), "utf8");
		assert.equal(isModuleCacheMissingOrShell("Plugins", "AjaMediaOutput", cacheDir), false);

		// 有元数据但无符号表 = 官方确实收录但该模块没有 API 表格，不算空壳
		const metaOnlyPath = epicModuleCachePath("Developer", "MetaOnly", cacheDir);
		mkdirSync(dirname(metaOnlyPath), { recursive: true });
		writeFileSync(metaOnlyPath, JSON.stringify({
			version: "5.8", scope: "Developer", module: "MetaOnly", source: "test",
			synced_at: new Date().toISOString(), metadata: { Name: "MetaOnly" }, symbols: [],
		}), "utf8");
		assert.equal(isModuleCacheMissingOrShell("Developer", "MetaOnly", cacheDir), false);
	} finally {
		rmSync(cacheDir, { recursive: true, force: true });
	}
});

test("isModuleUnpublished：根目录未收录为未发布，收录（含截断）不算，无根目录缓存不判定", () => {
	const cacheDir = makeCacheDir();
	try {
		// 根目录缓存缺失：无法判定，必须返回 false（否则会把全部模块误判为未发布）
		assert.equal(isModuleUnpublished("Developer", "Android", cacheDir), false);

		writeRoot(cacheDir, [
			{ scope: "Runtime", module: "Engine", url: "https://example.test/API/Runtime/Engine" },
			{ scope: "Plugins", module: "AnimationLocomotionLibraryRuntim-", url: "https://example.test/API/Plugins/AnimationLocomotionLibraryRuntim-" },
		]);
		assert.equal(isModuleUnpublished("Developer", "Android", cacheDir), true, "根目录未收录 = Epic 未发布文档页");
		assert.equal(isModuleUnpublished("Runtime", "Engine", cacheDir), false);
		assert.equal(isModuleUnpublished("Plugins", "AnimationLocomotionLibraryRuntime", cacheDir), false, "截断 slug 命中也算已收录");
	} finally {
		rmSync(cacheDir, { recursive: true, force: true });
	}
});

test("syncEpicApiModules：未发布模块入队前剔除并计入 skipped_unpublished，不发请求不算失败", async () => {
	const cacheDir = makeCacheDir();
	try {
		writeRoot(cacheDir, [
			{ scope: "Runtime", module: "Engine", url: "https://example.test/API/Runtime/Engine" },
		]);
		// 全部目标都未收录：队列应为空，零网络请求，报告只含 skipped_unpublished
		const result = await syncEpicApiModules(
			[
				{ scope: "Developer", module: "Android", url: "https://example.test/API/Developer/Android" },
				{ scope: "Developer", module: "ChaosTestHarness", url: "https://example.test/API/Developer/ChaosTestHarness" },
			],
			2,
			cacheDir,
		);
		assert.equal(result.requested, 0, "未发布模块不应计入请求数");
		assert.equal(result.succeeded, 0);
		assert.equal(result.failed.length, 0, "跳过不是失败——历史上这批曾以 132 个失败反复出现");
		assert.deepEqual(
			result.skipped_unpublished.map((entry) => entry.module).sort(),
			["Android", "ChaosTestHarness"],
		);
		const report = JSON.parse(readFileSync(join(cacheDir, "sync-report.json"), "utf8"));
		assert.equal(report.failed.length, 0);
		assert.equal(report.skipped_unpublished.length, 2);
	} finally {
		rmSync(cacheDir, { recursive: true, force: true });
	}
});
