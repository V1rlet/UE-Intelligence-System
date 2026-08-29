// T1 回归：生产 HTML 安全头契约。
// 浏览器门禁全部跑在 vite preview 形态（configurePreviewServer 只挂 API 路由，无这些头），
// serveFile 若被改动静默丢头不会有任何门禁变红——因此把策略抽为单一所有者并在此锁定内容。
import assert from "node:assert/strict";
import test from "node:test";
import { htmlSecurityHeaders } from "../scripts/release-html-headers.js";

test("生产 HTML 安全头契约：CSP 关键指令齐备且脚本无内联豁免（T1 回归）", () => {
	const headers = htmlSecurityHeaders();
	const csp = headers["Content-Security-Policy"];
	assert.equal(typeof csp, "string");
	assert.ok(csp.length > 0);
	for (const directive of ["default-src 'self'", "script-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'none'"]) {
		assert.ok(csp.includes(directive), `CSP 缺少指令 ${directive}`);
	}
	assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/, "script-src 不得放行 unsafe-inline");
	assert.equal(headers["X-Frame-Options"], "DENY", "反嵌入必须同时有 XFO DENY 兜底");
});
