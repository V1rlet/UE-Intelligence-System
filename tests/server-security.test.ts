import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isExistingPathWithin, isPathWithin, isTrustedMutation } from "../server/http.js";

function fakeReq(method: string, headers: Record<string, string | string[] | undefined>): IncomingMessage {
	return { method, headers } as unknown as IncomingMessage;
}

test("mutation guard allows read-only methods", () => {
	for (const method of ["GET", "HEAD", "OPTIONS"]) {
		const req = fakeReq(method, { origin: "https://evil.example", host: "127.0.0.1:3030" });
		assert.equal(isTrustedMutation(req), true);
	}
});

test("mutation guard allows local CLI and hook calls without Origin", () => {
	const req = fakeReq("POST", { host: "127.0.0.1:3030" });
	assert.equal(isTrustedMutation(req), true);
});

test("mutation guard allows same-origin writes with the local marker header", () => {
	const local = { "x-graphbrain-local": "1" };
	const req = fakeReq("POST", { origin: "http://127.0.0.1:3030", host: "127.0.0.1:3030", ...local });
	assert.equal(isTrustedMutation(req), true);
});

test("mutation guard rejects browser-origin writes without the local marker header", () => {
	// 带 Origin 的浏览器写请求必须携带 X-GraphBrain-Local（跨域预检被无 CORS 头拦截，
	// 攻击页面无法携带）；缺失即拒绝。
	assert.equal(
		isTrustedMutation(fakeReq("POST", { origin: "http://127.0.0.1:3030", host: "127.0.0.1:3030" })),
		false,
	);
	assert.equal(
		isTrustedMutation(fakeReq("POST", { origin: "http://localhost:3030", host: "localhost:3030", "x-graphbrain-local": "0" })),
		false,
	);
});

test("mutation guard rejects cross-origin, wrong-port, and invalid origins", () => {
	assert.equal(
		isTrustedMutation(fakeReq("POST", { origin: "https://evil.example", host: "127.0.0.1:3030" })),
		false,
	);
	assert.equal(
		isTrustedMutation(fakeReq("POST", { origin: "http://127.0.0.1:9999", host: "127.0.0.1:3030" })),
		false,
	);
	assert.equal(isTrustedMutation(fakeReq("POST", { origin: "not-a-url", host: "127.0.0.1:3030" })), false);
	assert.equal(isTrustedMutation(fakeReq("POST", { origin: "null", host: "127.0.0.1:3030" })), false);
});

test("mutation guard rejects DNS-rebinding style origins whose host matches but is not loopback", () => {
	// 旧实现仅比较 host：origin 与 Host 相同即放行，DNS rebinding 可绕过。
	// 修复后必须校验 host 是回环地址。
	assert.equal(
		isTrustedMutation(fakeReq("POST", { origin: "http://attacker.example:3030", host: "attacker.example:3030" })),
		false,
	);
	assert.equal(
		isTrustedMutation(fakeReq("POST", { origin: "http://127.0.0.1.evil.example:3030", host: "127.0.0.1.evil.example:3030" })),
		false,
	);
});

test("mutation guard allows loopback origins via localhost and ::1", () => {
	const local = { "x-graphbrain-local": "1" };
	assert.equal(
		isTrustedMutation(fakeReq("POST", { origin: "http://localhost:3030", host: "localhost:3030", ...local })),
		true,
	);
	assert.equal(
		isTrustedMutation(fakeReq("POST", { origin: "http://[::1]:3030", host: "[::1]:3030", ...local })),
		true,
	);
});

test("path guard accepts descendants and rejects escape paths", () => {
	assert.equal(isPathWithin("G:/proj/data", "G:/proj/data/graphs/a.cyto.json"), true);
	assert.equal(isPathWithin("G:/proj/data", "G:/proj/data/../secrets.json"), false);
	assert.equal(isPathWithin("G:/proj/data", "G:/proj/secrets.json"), false);
	assert.equal(isPathWithin("G:/proj/data", "G:/proj/data"), false);
	assert.equal(isPathWithin("G:/proj/data", "C:/windows/evil"), false);
});

test("existing path guard rejects symlink and junction escapes", () => {
	const fixture = mkdtempSync(join(tmpdir(), "graphbrain-path-"));
	try {
		const root = join(fixture, "data");
		const outside = join(fixture, "outside");
		mkdirSync(root);
		mkdirSync(outside);
		writeFileSync(join(outside, "secret.txt"), "secret", "utf8");
		symlinkSync(outside, join(root, "linked"), "junction");
		const escaped = join(root, "linked", "secret.txt");
		assert.equal(isPathWithin(root, escaped), true, "lexical guard alone cannot see junctions");
		assert.equal(isExistingPathWithin(root, escaped), false);
		const safe = join(root, "safe.txt");
		writeFileSync(safe, "safe", "utf8");
		assert.equal(isExistingPathWithin(root, safe), true);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});
