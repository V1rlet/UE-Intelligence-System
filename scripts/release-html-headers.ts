// Graph Brain / service - 生产 HTML 安全头策略（单一所有者）。
// 浏览器门禁全部跑在 vite preview 形态上，永远发不出这些头；内容由此模块唯一拥有，
// 并被 tests/release-html-headers.test.ts 契约锁定（T1 审计：防止 serveFile 改动静默丢头）。

export function htmlSecurityHeaders(): Record<string, string> {
	return {
		// All HTML belongs to the single viewer shell. Generic embedding is retired,
		// so every document rejects framing and shares the same CSP boundary.
		"Content-Security-Policy":
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
			+ "img-src 'self' data:; font-src 'self'; connect-src 'self'; "
			+ "frame-ancestors 'none'; base-uri 'self'; form-action 'none'",
		"X-Frame-Options": "DENY",
	};
}
