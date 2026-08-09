// Graph Brain / tests - 服务端响应契约防回归
// F30 教训：/api/engine-catalog 的 official_cache（{synced, modules}）被健康摘要覆盖，
// UI `modules.toLocaleString()` 抛 TypeError → API 视图整页打不开；冒烟的 landing 页
// DOM 不含该统计牌所以没逮住。这里对组装函数直接锁契约。

import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import test from "node:test";
import {
	engineCatalogPayload,
	handleEngineCatalog,
	handleEngineCatalogClasses,
	handleEngineCatalogSync,
	handleEngineCatalogSyncStatus,
	handleEngineClass,
} from "../server/engine.js";
import { handleDataFiles, handleGraphCatalog, handleMermaid } from "../server/misc.js";

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
		{ handler: handleMermaid, url: "/api/mermaid", method: "POST", allow: "GET" },
		{ handler: handleEngineCatalog, url: "/api/engine-catalog", method: "POST", allow: "GET" },
		{ handler: handleEngineCatalogClasses, url: "/api/engine-catalog/classes", method: "POST", allow: "GET" },
		{ handler: handleEngineCatalogSync, url: "/api/engine-catalog/sync", method: "GET", allow: "POST" },
		{ handler: handleEngineCatalogSyncStatus, url: "/api/engine-catalog/sync/status", method: "POST", allow: "GET" },
		{ handler: handleEngineClass, url: "/api/engine-class/AActor", method: "POST", allow: "GET" },
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
	const url = "/data/mermaid/../graphs/ue5_code_project__gbtx-67ab71ff6944dbbc.cyto.json";
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
