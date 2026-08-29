// Graph Brain / tests - 服务端响应契约防回归
// F30 教训：/api/engine-catalog 的 official_cache（{synced, modules}）被健康摘要覆盖，
// UI `modules.toLocaleString()` 抛 TypeError → API 视图整页打不开；冒烟的 landing 页
// DOM 不含该统计牌所以没逮住。这里对组装函数直接锁契约。

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
	engineCatalogPayload,
	handleEngineCatalog,
	handleEngineCatalogClasses,
	handleEngineCatalogSync,
	handleEngineCatalogSyncStatus,
	handleEngineClass,
} from "../server/engine.js";
import { handleEvidenceStatus, refreshRegisteredEvidence } from "../server/evidence.js";
import { handleAnnotations, handleFavorites } from "../server/annotations.js";
import { redactLocalPaths } from "../server/engine.js";
import { handleDataFiles, handleGraphCatalog } from "../server/misc.js";

test("引擎目录响应保留 official_cache 既有契约，健康摘要挂独立键", () => {
	const catalog = {
		official_cache: { synced: true, modules: 1869, synced_at: "2026-07-11T20:22:24.050Z" },
		modules: [{ scope: "Runtime", name: "Engine" }],
		total_headers: 27065,
	};
	const payload = engineCatalogPayload(catalog);

	// 既有契约原样保留——UI 直接读 official_cache.synced / official_cache.modules
	assert.deepEqual(payload.official_cache, catalog.official_cache);
	assert.equal(typeof payload.official_cache.modules, "number", "modules 必须可 toLocaleString");
	// 其余目录字段不受影响
	assert.equal(payload.total_headers, 27065);
	assert.equal(payload.modules.length, 1);
	// 健康摘要在独立键上，且不复用既有契约的字段名形状
	assert.ok(payload.official_cache_health, "健康摘要应存在于 official_cache_health");
	assert.ok("cached_modules" in payload.official_cache_health);
	assert.ok(!("synced" in payload.official_cache_health && "modules" in payload.official_cache_health && Object.keys(payload.official_cache_health).length === 2),
		"健康摘要不得与 official_cache 契约同形状（防再次误覆盖）");
});

test("只读与固定方法 API 对错误方法稳定返回 405", async () => {
	const cases = [
		{ handler: handleGraphCatalog, url: "/api/graph-catalog", method: "POST", allow: "GET" },
		{ handler: handleEngineCatalog, url: "/api/engine-catalog", method: "POST", allow: "GET" },
		{ handler: handleEngineCatalogClasses, url: "/api/engine-catalog/classes", method: "POST", allow: "GET" },
		{ handler: handleEngineCatalogSync, url: "/api/engine-catalog/sync", method: "GET", allow: "POST" },
		{ handler: handleEngineCatalogSyncStatus, url: "/api/engine-catalog/sync/status", method: "POST", allow: "GET" },
		{ handler: handleEngineClass, url: "/api/engine-class/AActor", method: "POST", allow: "GET" },
		{ handler: handleAnnotations, url: "/api/annotations/ue5_code/project", method: "PUT", allow: "GET, POST" },
		{ handler: handleFavorites, url: "/api/favorites/ue5_code", method: "PUT", allow: "GET, POST" },
	] as const;
	for (const item of cases) {
		const headers = new Map<string, string>();
		const res = {
			statusCode: 0,
			setHeader(name: string, value: string) { headers.set(name, value); },
			end() {},
		} as unknown as ServerResponse;
		const handled = await item.handler({
			req: { method: item.method, headers: {} } as IncomingMessage,
			res,
			url: item.url,
			root: resolve("."),
			dataDir: resolve("data"),
		});
		assert.equal(handled, true, item.url);
		assert.equal(res.statusCode, 405, item.url);
		assert.equal(headers.get("Allow"), item.allow, item.url);
	}
});

test("reading-context writes reject malformed If-Match headers before reading the body", async () => {
	for (const item of [
		{ handler: handleAnnotations, url: "/api/annotations/ue5_code/project" },
		{ handler: handleFavorites, url: "/api/favorites/ue5_code" },
	] as const) {
		let body = "";
		const res = {
			statusCode: 0,
			setHeader() {},
			end(value?: string) { body = value ?? ""; },
		} as unknown as ServerResponse;
		const handled = await item.handler({
			req: { method: "POST", headers: { "if-match": 'revision-7' } } as IncomingMessage,
			res,
			url: item.url,
			root: resolve("."),
			dataDir: resolve("data"),
		});
		assert.equal(handled, true);
		// 畸形值是非法输入（400），与"未带前置条件"（428）分开——客户端错误分类不得合并。
		assert.equal(res.statusCode, 400);
		assert.equal((JSON.parse(body) as { code?: string }).code, "READING_CONTEXT_PRECONDITION_INVALID");

		let absentBody = "";
		const absentRes = {
			statusCode: 0,
			setHeader() {},
			end(value?: string) { absentBody = value ?? ""; },
		} as unknown as ServerResponse;
		await item.handler({
			req: { method: "POST", headers: {} } as IncomingMessage,
			res: absentRes,
			url: item.url,
			root: resolve("."),
			dataDir: resolve("data"),
		});
		assert.equal(absentRes.statusCode, 428);
		assert.equal((JSON.parse(absentBody) as { code?: string }).code, "READING_CONTEXT_PRECONDITION_REQUIRED");
	}
});

test("引擎同步非法 scope/module 返回 400 而非 500", async () => {
	const mkReq = (body: unknown) => {
		const listeners: Record<string, Array<(chunk: unknown) => void>> = {};
		const req = {
			method: "POST",
			headers: {},
			on(ev: string, fn: (chunk: unknown) => void) {
				(listeners[ev] ??= []).push(fn);
				return req;
			},
			emit(ev: string, chunk?: unknown) {
				(listeners[ev] ?? []).forEach((fn) => fn(chunk));
			},
		} as unknown as IncomingMessage;
		// 在 handler 注册 data/end 监听后投递请求体。
		queueMicrotask(() => {
			const emitter = req as unknown as { emit: (e: string, c?: unknown) => void };
			emitter.emit("data", Buffer.from(JSON.stringify(body)));
			emitter.emit("end");
		});
		return req;
	};
	for (const body of [{ scope: "evil", module: "x" }, { scope: "Runtime", module: "../evil" }]) {
		const res = {
			statusCode: 0,
			setHeader() {},
			end() {},
		} as unknown as ServerResponse;
		const handled = await handleEngineCatalogSync({
			req: mkReq(body),
			res,
			url: "/api/engine-catalog/sync",
			root: resolve("."),
			dataDir: resolve("data"),
		});
		assert.equal(handled, true);
		assert.equal(res.statusCode, 400, `非法参数应 400，实际 ${res.statusCode}: ${JSON.stringify(body)}`);
	}
});

test("数据直读拒绝 .. 段（防绕过发布可见性守卫）", async () => {
	const url = "/data/graphs/../graphs/ue5_code_project__gbtx-67ab71ff6944dbbc.cyto.json";
	let body = "";
	const res = {
		statusCode: 0,
		setHeader() {},
		end(value?: string) { body = value ?? ""; },
	} as unknown as ServerResponse;
	const handled = await handleDataFiles({
		req: { method: "GET", headers: {} } as IncomingMessage,
		res,
		url,
		root: resolve("."),
		dataDir: resolve("data"),
	});
	assert.equal(handled, true);
	assert.equal(res.statusCode, 404, `.. 段应被拒绝，实际 ${res.statusCode}`);
	assert.ok(!body.includes("ue5_code_project"), "不得泄漏被隐藏图的文件内容");
});

test("数据直读错误包络统一为 JSON + 稳定 code（F1 回归）", async () => {
	const cases = [
		{ url: "/data/graphs/../graphs/x.json", status: 404, code: "DATA_FILE_NOT_FOUND" },
		{ url: "/data/secret.txt", status: 404, code: "DATA_FILE_NOT_FOUND" },
		{ url: "/data/graphs/nonexistent.cyto.json", status: 404, code: "DATA_FILE_NOT_FOUND" },
		{ url: "/data/graphs/../README.md", status: 404, code: "DATA_FILE_NOT_FOUND" },
	] as const;
	for (const item of cases) {
		let body = "";
		const res = {
			statusCode: 0,
			setHeader() {},
			end(value?: string) { body = value ?? ""; },
		} as unknown as ServerResponse;
		const handled = await handleDataFiles({
			req: { method: "GET", headers: {} } as IncomingMessage,
			res,
			url: item.url,
			root: resolve("."),
			dataDir: resolve("data"),
		});
		assert.equal(handled, true);
		assert.equal(res.statusCode, item.status, item.url);
		const parsed = JSON.parse(body) as { error?: unknown; code?: unknown };
		assert.equal(typeof parsed.error, "string", `${item.url} 错误体必须是 JSON {error, code}`);
		assert.equal(parsed.code, item.code, item.url);
	}
});

test("变化报告不存在返回稳定 code CHANGE_REPORT_NOT_FOUND（F1 回归）", async () => {
	const { handleChangeReports } = await import("../server/changes.js");
	for (const url of ["/api/change-reports/missing.change.json", "/api/change-reports/not-a-report.txt"]) {
		let body = "";
		const res = {
			statusCode: 0,
			setHeader() {},
			end(value?: string) { body = value ?? ""; },
		} as unknown as ServerResponse;
		const handled = await handleChangeReports({
			req: { method: "GET", headers: {} } as IncomingMessage,
			res,
			url,
			root: resolve("."),
			dataDir: resolve("data"),
		});
		assert.equal(handled, true);
		assert.equal(res.statusCode, 404, url);
		const parsed = JSON.parse(body) as { code?: unknown };
		assert.equal(parsed.code, "CHANGE_REPORT_NOT_FOUND", url);
	}
});

test("引擎目录分页拒绝 NaN、越界和缺失范围，而不是产生损坏分页", async () => {
	for (const query of [
		"limit=NaN",
		"header_limit=65&scope=Runtime&module=Engine",
		"header_limit=32",
	]) {
		let body = "";
		const res = {
			statusCode: 0,
			setHeader() {},
			end(value?: string) { body = value ?? ""; },
		} as unknown as ServerResponse;
		const handled = await handleEngineCatalogClasses({
			req: { method: "GET", headers: {}, url: `/api/engine-catalog/classes?${query}` } as IncomingMessage,
			res,
			url: "/api/engine-catalog/classes",
			root: resolve("."),
			dataDir: resolve("data"),
		});
		assert.equal(handled, true);
		assert.equal(res.statusCode, 400, query);
		assert.equal(typeof (JSON.parse(body) as { error?: unknown }).error, "string");
	}
});

test("后台同步任务只在完成后定时过期，且保留数量有上界", () => {
	const source = readFileSync(new URL("../server/engine.ts", import.meta.url), "utf8");
	assert.match(source, /MAX_RETAINED_EPIC_SYNC_JOBS = 64/);
	assert.match(source, /job\.state === "completed" \|\| job\.state === "failed"/);
	assert.match(source, /scheduleEpicSyncJobExpiry\(job\)/);
	assert.match(source, /timer\.unref\(\)/);
	assert.doesNotMatch(source, /Date\.now\(\) - Date\.parse\(oldJob\.started_at\)/);
});

test("同步任务错误文本在进入任务表前剥离本机绝对路径", () => {
	const redacted = redactLocalPaths(
		"EACCES: permission denied, open 'G:\\UnrealProject\\GraphBrain\\data\\api-catalog\\sync-report.json'",
	);
	assert.ok(!redacted.includes("UnrealProject"), `绝对路径泄漏: ${redacted}`);
	assert.match(redacted, /sync-report\.json/);
	assert.equal(
		redactLocalPaths("Epic API 请求失败 429: https://dev.epicgames.com/API/Runtime/Core"),
		"Epic API 请求失败 429: https://dev.epicgames.com/API/Runtime/Core",
		"http(s) URL 不得被误脱敏",
	);
	assert.ok(!redactLocalPaths("ENOENT: /home/user/graphbrain/data/x.json").includes("/home/user"));
});

test("V1 回归：异步 refresh 挂起期间事件循环不冻结——并发 status 响应 < 200ms", async () => {

	// 真实时钟是本用例的被测对象：V1 验证的是"挂起的异步 refresh 不冻结事件循环"
	// 这一真实时序，fake timers 无法表达事件循环的真实调度延迟。
	const root = mkdtempSync(join(tmpdir(), "graphbrain-v1-refresh-"));

	try {
		mkdirSync(join(root, "core", "hooks"), { recursive: true });
		mkdirSync(join(root, "data"), { recursive: true });
		writeFileSync(join(root, "core", "hooks", "hook-projects.json"), JSON.stringify({
			projects: [{
				name: "Fixture",
				root: join(root, "repo"),
				vcs: "git",
				domain: "ue5_code",
				subsystem: "project",
				trigger_extensions: [".h"],
				scan_annotations: false,
				extract: { roots: ["Source"], out: join(root, "data", "graphs") },
			}],
		}), "utf8");

		const slowStep = async () => {
			await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 400));
			return 0;
		};
		const refreshPromise = refreshRegisteredEvidence({ root, runStep: slowStep });
		await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 50)); // 让 refresh 先进入挂起的假步骤

		const headers = new Map<string, string>();
		let body = "";
		const res = {
			statusCode: 0,
			setHeader(name: string, value: string) { headers.set(name, value); },
			end(chunk?: unknown) { if (typeof chunk === "string") body += chunk; },
		} as unknown as ServerResponse;
		const statusStartedAt = performance.now();
		const handled = handleEvidenceStatus({
			req: { method: "GET", headers: {}, url: "/api/evidence/v1/status" } as IncomingMessage,
			res,
			url: "/api/evidence/v1/status",
			root,
			dataDir: join(root, "data"),
		});
		const latencyMs = performance.now() - statusStartedAt;
		assert.equal(handled, true);
		assert.equal(res.statusCode, 200);
		assert.ok(latencyMs < 200, `refresh 挂起期间 status 响应耗时 ${latencyMs.toFixed(1)}ms ≥ 200ms（事件循环疑似被冻结）`);
		assert.match(body, /"format_version"/);

		const result = await refreshPromise;
		assert.equal(result.status, "refreshed");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
