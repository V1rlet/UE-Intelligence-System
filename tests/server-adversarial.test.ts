// T3 对抗性安全回归：构造攻击请求逐条验证既有防线。
// 这些用例把审计结论固化为可执行断言：伪造 Host、双重编码、反斜杠穿越、ADS/NUL 文件名、
// 深嵌套 JSON 栈深、__proto__ 键穿透。防线失效（哪怕只是静默放宽）都会在这里变红。
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handleDataFiles } from "../server/misc.js";
import { HttpInputError, HttpPayloadTooLargeError, isTrustedMutation, readJsonBody } from "../server/http.js";
import { parseFavoriteInput } from "../server/reading-context-input.js";

function fakeReq(method: string, headers: Record<string, string | string[] | undefined>): IncomingMessage {
	return { method, headers } as unknown as IncomingMessage;
}

interface CapturedResponse {
	status(): number;
	body(): string;
	raw: ServerResponse;
}

function captureRes(): CapturedResponse {
	let statusCode = 200;
	let payload = "";
	const raw = {
		statusCode: 200,
		setHeader: () => undefined,
		end: (chunk?: unknown) => {
			if (typeof chunk === "string") payload += chunk;
			else if (chunk !== undefined) payload += String(chunk);
		},
		getStatusCode: () => statusCode,
	} as unknown as ServerResponse;
	Object.defineProperty(raw, "statusCode", { get: () => statusCode, set: (value: number) => { statusCode = value; } });
	return {
		raw,
		status: () => statusCode,
		body: () => payload,
	};
}

test("mutation guard rejects forged loopback-looking hosts and IPv6-mapped origins", () => {
	for (const host of ["localhost.evil.com", "127.0.0.1.evil.com", "::ffff:127.0.0.1", "[::ffff:127.0.0.1]", "[::ffff:7f00:1]"]) {
		assert.equal(
			isTrustedMutation(fakeReq("POST", { origin: `http://${host}:3030`, host: `${host}:3030`, "x-graphbrain-local": "1" })),
			false,
			`伪造回环 host 必须拒绝：${host}`,
		);
	}
});

test("/data direct read survives encoded traversal, ADS, NUL and trailing-dot variants", async () => {
	const dataDir = mkdtempSync(join(tmpdir(), "graphbrain-adversarial-"));
	try {
		// 复刻 server/router 的单次解码：处理器看到的 url 已解码一次。
		const routeDecode = (rawUrl: string): string => decodeURIComponent(rawUrl.split("?")[0]);
		const cases = [
			"/data/graphs/%252e%252e%252fsecret.cyto.json",
			"/data/graphs/%252e%252e/secret.cyto.json",
			"/data/graphs/..%5C..%5Csecret.cyto.json",
			"/data/graphs/fake.cyto.json:stream",
			"/data/graphs/fake.cyto.json%00.png",
			"/data/graphs/fake.cyto.json.",
			"/data/graphs/FAKE.CYTO.JSON",
		];
		for (const raw of cases) {
			const captured = captureRes();
			const handled = await handleDataFiles({
				req: fakeReq("GET", {}),
				res: captured.raw,
				url: routeDecode(raw),
				root: dataDir,
				dataDir,
			});
			assert.equal(handled, true, raw);
			assert.match(captured.body(), /DATA_FILE_NOT_FOUND/, raw);
		}
	} finally {
		rmSync(dataDir, { recursive: true, force: true });
	}
});
test("readJsonBody enforces the 1 MiB limit", async () => {
	const req = new EventEmitter() as IncomingMessage;
	const pending = readJsonBody(req);
	req.emit("data", Buffer.alloc(1024 * 1024 + 1, 0x61));
	await assert.rejects(pending, HttpPayloadTooLargeError);
});

test("readJsonBody rejects deeply nested payloads without crashing the process", async () => {
	const depth = 60_000;
	const oversized = `${"[".repeat(depth)}${"]".repeat(depth)}`;
	assert.ok(Buffer.byteLength(oversized) <= 1024 * 1024);
	const req = new EventEmitter() as IncomingMessage;
	const pending = readJsonBody(req);
	req.emit("data", Buffer.from(oversized, "utf8"));
	req.emit("end");
	await assert.rejects(pending, HttpInputError);
});

test("favorite input parsing copies only whitelisted keys (no __proto__/extra-key passthrough)", () => {
	const hostile = JSON.parse('{"kind":"class","source":"project","node_id":"UProject","label":"x","__proto__":{"polluted":true},"constructor":{"prototype":{}}}');
	const favorite = parseFavoriteInput(hostile);
	assert.deepEqual(
		Object.keys(favorite).sort(),
		["kind", "label", "node_id", "source"],
		"只允许白名单字段进入持久化草稿",
	);
});
