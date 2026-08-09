// Graph Brain / service - self-contained production HTTP entry bundled into every release.
// Domain data remains live under GB_PROJECT_ROOT/data; executable server behavior and
// static viewer assets are immutable parts of the release artifact.

import { createReadStream, realpathSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiRouter } from "../server/router.js";

const RELEASE_ROOT = dirname(fileURLToPath(import.meta.url));
const DIST_ROOT = resolve(RELEASE_ROOT, "dist");
const PROJECT_ROOT = resolve(process.env.GB_PROJECT_ROOT ?? "");
const DATA_ROOT = resolve(PROJECT_ROOT, "data");
const port = Number(process.env.GB_SERVICE_PORT ?? "3030");

if (!process.env.GB_PROJECT_ROOT) throw new Error("GB_PROJECT_ROOT 未设置");
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("GB_SERVICE_PORT 非法");
if (!statSync(join(DIST_ROOT, "index.html")).isFile()) throw new Error("release dist 缺少 index.html");

const MIME: Record<string, string> = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
};

function safeStaticPath(pathname: string): string | null {
	const target = resolve(DIST_ROOT, `.${pathname}`);
	if (target !== DIST_ROOT && !target.startsWith(`${DIST_ROOT}${sep}`)) return null;
	try {
		const actual = realpathSync.native(target);
		const root = realpathSync.native(DIST_ROOT);
		if (actual !== root && !actual.startsWith(`${root}${sep}`)) return null;
		return statSync(actual).isFile() ? actual : null;
	} catch {
		return null;
	}
}

function serveFile(req: IncomingMessage, res: ServerResponse, file: string): void {
	const info = statSync(file);
	res.statusCode = 200;
	res.setHeader("Content-Type", MIME[extname(file).toLowerCase()] ?? "application/octet-stream");
	res.setHeader("Content-Length", String(info.size));
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("Cache-Control", file.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
	// 生产安全头：主查看器禁止被任意站点 iframe（点击劫持）；/embed.html 是 AFFiNE
	// 只读嵌入路由，保持可嵌入。CSP 阻断任何潜在存储型 XSS 的脚本执行（第二层防线）。
	if (extname(file).toLowerCase() === ".html") {
		const isEmbed = file.endsWith(`${sep}embed.html`);
		res.setHeader("Content-Security-Policy",
			`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; `
			+ `img-src 'self' data:; font-src 'self'; connect-src 'self'; `
			+ `${isEmbed ? "" : "frame-ancestors 'none'; "}base-uri 'self'; form-action 'none'`);
		if (!isEmbed) res.setHeader("X-Frame-Options", "DENY");
	}
	if (req.method === "HEAD") res.end();
	else createReadStream(file).pipe(res);
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.statusCode = 405;
		res.setHeader("Allow", "GET, HEAD");
		res.end();
		return;
	}
	let pathname: string;
	try {
		pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
	} catch {
		res.statusCode = 400;
		res.end("Invalid path encoding");
		return;
	}
	const requested = pathname === "/" ? "/index.html" : pathname;
	const file = safeStaticPath(requested);
	if (file) {
		serveFile(req, res, file);
		return;
	}
	const acceptsHtml = String(req.headers.accept ?? "").includes("text/html");
	if (acceptsHtml && !extname(pathname)) {
		serveFile(req, res, join(DIST_ROOT, "index.html"));
		return;
	}
	res.statusCode = 404;
	res.end("Not found");
}

const api = createApiRouter({ root: PROJECT_ROOT, dataDir: DATA_ROOT });
const server = createServer((req, res) => {
	void api(req, res, () => serveStatic(req, res)).catch((error) => {
		console.error("[release-server] request failed", error);
		if (!res.headersSent) res.statusCode = 500;
		if (!res.writableEnded) res.end("Internal server error");
	});
});

server.listen(port, "127.0.0.1", () => {
	console.log(`[release-server] http://127.0.0.1:${port}`);
});

let closing = false;
function close(signal: string): void {
	if (closing) return;
	closing = true;
	console.log(`[release-server] ${signal}`);
	server.close(() => process.exit(0));
}

process.once("SIGINT", () => close("SIGINT"));
process.once("SIGTERM", () => close("SIGTERM"));
