// Graph Brain / service - self-contained production HTTP entry bundled into every release.
// Domain data remains live under GB_PROJECT_ROOT/data; executable server behavior and
// static viewer assets are immutable parts of the release artifact.

import { createReadStream, realpathSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiRouter } from "../server/router.js";
import { startLoreWatcher, stopLoreWatcher } from "../core/hooks/lore-watcher.js";
import { htmlSecurityHeaders } from "./release-html-headers.js";

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
	if (extname(file).toLowerCase() === ".html") {
		for (const [header, value] of Object.entries(htmlSecurityHeaders())) res.setHeader(header, value);
	}
	if (req.method === "HEAD") res.end();
	else {
		// pipe 不转发源流错误：文件在 stat 后被删除/占用时，未处理的 'error' 事件会
		// 直接击穿 NSSM 常驻进程；客户端中断时也要销毁源流释放句柄。
		const stream = createReadStream(file);
		stream.on("error", (error) => {
			console.error("[release-server] static stream failed", error);
			res.destroy();
		});
		res.on("close", () => {
			if (!res.writableEnded) stream.destroy();
		});
		stream.pipe(res);
	}
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

server.on("error", (error) => {
	console.error(`[release-server] listen on 127.0.0.1:${port} failed`, error);
	process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
	console.log(`[release-server] http://127.0.0.1:${port}`);
});

// A2（修 F-B）：生产形态同样自动刷新图谱——此前 release-server 不启动 watcher，
// Sabotage 的 Lore 提交在生产上永远不会触发提取。缺省启用；GRAPH_BRAIN_NO_WATCHER=1
// 是部署验收（service-deploy 隔离环境）与排障的显式逃生阀。baseRoot 把 config/
// state/logs/runner 锚回项目工作树（本文件被 esbuild 并入 server.mjs，模块自身的
// import.meta.url 在 release 目录里）。与 dev 形态并存安全：runner 侧 hook.lock busy-skip。
if (process.env.GRAPH_BRAIN_NO_WATCHER === "1") {
	console.log("[release-server] GRAPH_BRAIN_NO_WATCHER=1：lore-watcher 未启动");
} else {
	startLoreWatcher({ baseRoot: PROJECT_ROOT });
}

let closing = false;
function close(signal: string): void {
	if (closing) return;
	closing = true;
	stopLoreWatcher();
	console.log(`[release-server] ${signal}`);
	// close() 只等空闲连接，keep-alive 会让它永远不返回；强制断开并兜底退出，
	// 避免 NSSM 等待超时后硬杀导致日志丢失。
	server.close(() => process.exit(0));
	server.closeAllConnections();
	const forceExit = setTimeout(() => process.exit(0), 5_000);
	forceExit.unref();
}

process.once("SIGINT", () => close("SIGINT"));
process.once("SIGTERM", () => close("SIGTERM"));
