// Graph Brain / server - API router: decoding, same-origin protection and route families.
// F30：从 vite.config.ts 内联中间件拆出（评析文档风险 #2）；路由族按文件分组可独立单测，
// vite.config 只负责装配与 watcher 生命周期。

import type { IncomingMessage, ServerResponse } from "node:http";
import { annotationHandlers } from "./annotations";
import { changeHandlers } from "./changes";
import { engineHandlers } from "./engine";
import { evidenceHandlers } from "./evidence";
import { handleGraphProjection } from "./graph-projection";
import { type ApiContext, type ApiHandler, isTrustedMutation, sendHttpError, sendInternalError, sendJson } from "./http";
import { miscHandlers } from "./misc";
import { handleRetiredWorldTools } from "./retired-world-tools";
import { handleRetiredAuthoringTools } from "./retired-authoring-tools";
import { handleRetiredViewerSurfaces } from "./retired-viewer-surfaces";
import { usageHandlers } from "./usage";
import { recordLocalUsage, type LocalUsageKey } from "../core/usage/local-usage";

// 顺序保持与拆分前 vite.config 内联判定一致（正则族先行，字面路径后置无碰撞风险）
const HANDLERS: ApiHandler[] = [
	...annotationHandlers,
	...changeHandlers,
	...engineHandlers,
	...evidenceHandlers,
	...usageHandlers,
	handleGraphProjection,
	handleRetiredAuthoringTools,
	handleRetiredWorldTools,
	handleRetiredViewerSurfaces,
	...miscHandlers,
];

function requestUsageKey(req: IncomingMessage, url: string): LocalUsageKey | null {
	const evidence = new Map<string, LocalUsageKey>([
		["/api/evidence/v1/status", "evidence.status"],
		["/api/evidence/v1/symbols", "evidence.symbols"],
		["/api/evidence/v1/symbol", "evidence.symbol"],
		["/api/evidence/v1/neighborhood", "evidence.neighborhood"],
		["/api/evidence/v1/changes", "evidence.changes"],
	]);
	const evidenceKey = evidence.get(url);
	if (evidenceKey) return evidenceKey;
	if (url === "/api/engine-catalog") return "engine.catalog-browse";
	if (url === "/api/engine-catalog/classes") {
		const params = new URL(req.url ?? url, "http://127.0.0.1").searchParams;
		return params.get("q")?.trim() ? null : "engine.catalog-browse";
	}
	return null;
}

export interface RouterOptions {
	root: string;
	dataDir: string;
}

/** 返回 connect 风格中间件；未命中任何路由时调用 next()（交回 Vite 静态服务）。 */
export function createApiRouter({ root, dataDir }: RouterOptions) {
	return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
		// HEAD 统一按 GET 路由（RFC 9110：支持 GET 的资源应支持 HEAD；curl -I/探活依赖）。
		// Node 的 ServerResponse 在构造时按原始方法丢弃 HEAD 响应体，此处无需特判。
		if (req.method === "HEAD") req.method = "GET";
		let url: string;
		try {
			url = decodeURIComponent((req.url ?? "").split("?")[0]);
		} catch {
			sendJson(res, 400, { error: "请求路径编码非法" });
			return;
		}
		if (!isTrustedMutation(req)) {
			sendJson(res, 403, { error: "拒绝跨来源修改本地 GraphBrain 数据" });
			return;
		}

		const ctx: ApiContext = { req, res, url, root, dataDir };
		// connect 不会 await 异步中间件：handler 逃逸的异常在 Vite dev 下会成为 unhandled
		// rejection（进程退出且客户端无响应），必须在这里收敛为稳定错误响应。
		try {
			for (const handler of HANDLERS) {
				const startedAt = Date.now();
				if (await handler(ctx)) {
					const key = requestUsageKey(req, url);
					if (key) {
						try { recordLocalUsage(root, key, { durationMs: Date.now() - startedAt }); }
						catch (error) { console.warn(`[local-usage] ${key} record failed`, error); }
					}
					return;
				}
			}
		} catch (error) {
			if (!sendHttpError(res, error)) sendInternalError(res, error, "api request failed");
			return;
		}
		// /api/* 前缀由 router 终结：落入 Vite SPA 回退会把"路由不存在/已退役"伪装成
		// 200 HTML，破坏 410 退役契约与 API 客户端的可判定性（静态路径仍交回 next）。
		if (url === "/api" || url.startsWith("/api/")) {
			sendJson(res, 404, { error: "未知 API 路由", code: "API_ROUTE_NOT_FOUND" });
			return;
		}
		next();
	};
}
