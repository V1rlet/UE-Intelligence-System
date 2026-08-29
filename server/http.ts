// Graph Brain / server - HTTP 原语：响应/请求体/同源校验/路径边界
// F30：API 中间件从 vite.config.ts 拆出为 server/ 模块（评析文档风险 #2），
// vite.config 只留装配；各路由族按文件分组，可独立单测。

import type { IncomingMessage, ServerResponse } from "node:http";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";

/** 单个 API 请求的上下文；handler 返回 true 表示已处理（终止路由链）。 */
export interface ApiContext {
	req: IncomingMessage;
	res: ServerResponse;
	/** 已解码的 pathname（不含查询串） */
	url: string;
	/** 项目根目录 */
	root: string;
	/** data/ 目录绝对路径 */
	dataDir: string;
}

export type ApiHandler = (ctx: ApiContext) => Promise<boolean> | boolean;

export class HttpError extends Error {
	constructor(
		public readonly status: number,
		message: string,
		public readonly code?: string,
	) {
		super(message);
		this.name = "HttpError";
	}
}

export class HttpInputError extends HttpError {
	constructor(message: string, code = "INVALID_REQUEST") {
		super(400, message, code);
		this.name = "HttpInputError";
	}
}

export class HttpPayloadTooLargeError extends HttpError {
	constructor(message = "请求体超过 1 MiB 限制") {
		super(413, message, "PAYLOAD_TOO_LARGE");
		this.name = "HttpPayloadTooLargeError";
	}
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.end(JSON.stringify(payload));
}

/** Send only errors intentionally classified at the HTTP boundary. */
export function sendHttpError(res: ServerResponse, error: unknown): boolean {
	if (!(error instanceof HttpError)) return false;
	sendJson(res, error.status, {
		error: error.message,
		...(error.code ? { code: error.code } : {}),
	});
	return true;
}

/** Operational failures stay server errors and do not leak filesystem details. */
export function sendInternalError(res: ServerResponse, error: unknown, context: string): void {
	console.error(`[GraphBrain] ${context}`, error);
	sendJson(res, 500, { error: "GraphBrain 内部错误", code: "INTERNAL_ERROR" });
}

export function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise((resolvePromise, reject) => {
		// 逐块 toString 会在多字节 UTF-8 字符跨块边界时产生 U+FFFD（中文标注持久损坏），
		// 必须聚合原始 Buffer 后一次性解码。
		const chunks: Buffer[] = [];
		let bytes = 0;
		let rejected = false;
		req.on("data", (chunk) => {
			if (rejected) return;
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
			bytes += buffer.length;
			if (bytes > 1024 * 1024) {
				rejected = true;
				reject(new HttpPayloadTooLargeError());
				// 排空剩余请求体（不销毁 socket），保持连接可用于发送 413 响应。
				req.resume?.();
				return;
			}
			chunks.push(buffer);
		});
		req.on("end", () => {
			if (rejected) return;
			try {
				let parsed: unknown;
				try {
					const raw = Buffer.concat(chunks).toString("utf8");
					parsed = raw ? JSON.parse(raw) : {};
				} catch {
					throw new HttpInputError("JSON 请求体格式错误");
				}
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
					throw new HttpInputError("JSON 请求体必须是对象");
				}
				resolvePromise(parsed as Record<string, unknown>);
			} catch (e) {
				reject(e);
			}
		});
		req.on("error", reject);
	});
}

/** 跨来源修改防护：无 Origin 的 CLI/hook 调用放行，带 Origin 的必须为本机回环来源
 *  且携带本机标记头。
 *  双层防线：① 仅比较 host 会被 DNS rebinding 绕过（攻击域名解析到 127.0.0.1 后
 *  origin.host === Host 恒成立），故 origin 的 host 必须是回环地址且与请求 Host 完全一致；
 *  ② 浏览器来源必须携带 X-GraphBrain-Local 头——跨域（含 rebinding）预检请求因服务端
 *  无 CORS 响应头而被浏览器拦截，该头无法被攻击页面携带；同源页面由 apiFetch 统一注入。 */
export function isTrustedMutation(req: IncomingMessage): boolean {
	if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return true;
	const origin = req.headers.origin;
	if (!origin) return true; // CLI、本机 hook 与自动化调用没有 Origin。
	if (String(req.headers["x-graphbrain-local"] ?? "") !== "1") return false;
	try {
		const parsed = new URL(origin);
		const originHost = parsed.host.toLowerCase();
		const hostname = parsed.hostname.toLowerCase();
		// Node 的 URL.hostname 对 IPv6 字面量保留方括号（"[::1]"），浏览器实现则剥离；
		// 两种形式都接受，避免任一端的回环来源被误拒。
		const loopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
		if (!loopback) return false;
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
		return originHost === String(req.headers.host ?? "").toLowerCase();
	} catch {
		return false;
	}
}

export function isPathWithin(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Existing-file guard that also rejects symlink/junction escapes from the data boundary. */
export function isExistingPathWithin(root: string, target: string): boolean {
	if (!isPathWithin(root, target)) return false;
	try {
		return isPathWithin(realpathSync.native(root), realpathSync.native(target));
	} catch {
		return false;
	}
}

/** 从原始 req.url 取查询参数（pathname 已在路由层解码）。 */
export function searchParamsOf(req: IncomingMessage): URLSearchParams {
	return new URL(req.url ?? "", "http://localhost").searchParams;
}

export function methodNotAllowed(res: ServerResponse, allow = "GET"): void {
	res.statusCode = 405;
	res.setHeader("Allow", allow);
	res.end();
}
