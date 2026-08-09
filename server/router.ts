// Graph Brain / server - API 路由器：解码/同源防护/embed 重写 + 路由族串联
// F30：从 vite.config.ts 内联中间件拆出（评析文档风险 #2）；路由族按文件分组可独立单测，
// vite.config 只负责装配与 watcher 生命周期。

import type { IncomingMessage, ServerResponse } from "node:http";
import { annotationHandlers } from "./annotations";
import { changeHandlers } from "./changes";
import { engineHandlers } from "./engine";
import { handleGraphProjection } from "./graph-projection";
import { type ApiContext, type ApiHandler, isTrustedMutation, sendJson } from "./http";
import { miscHandlers } from "./misc";
import { handleRetiredWorldTools } from "./retired-world-tools";
import { handleRetiredAuthoringTools } from "./retired-authoring-tools";

// 顺序保持与拆分前 vite.config 内联判定一致（正则族先行，字面路径后置无碰撞风险）
const HANDLERS: ApiHandler[] = [
	...annotationHandlers,
	...changeHandlers,
	...engineHandlers,
	handleGraphProjection,
	handleRetiredAuthoringTools,
	handleRetiredWorldTools,
	...miscHandlers,
];

export interface RouterOptions {
	root: string;
	dataDir: string;
}

/** 返回 connect 风格中间件；未命中任何路由时调用 next()（交回 Vite 静态服务）。 */
export function createApiRouter({ root, dataDir }: RouterOptions) {
	return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
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

		// /embed 只读嵌入路由（P4U5）：HTML 请求重写到 embed.html（多页入口），
		// 具体目标（/embed/<domain>/<subsystem> 或 /embed/<file>）由前端解析 location
		if (url === "/embed" || url.startsWith("/embed/")) {
			const accept = String(req.headers.accept ?? "");
			if (req.method === "GET" && accept.includes("text/html")) {
				req.url = "/embed.html";
			}
			next();
			return;
		}

		const ctx: ApiContext = { req, res, url, root, dataDir };
		for (const handler of HANDLERS) {
			if (await handler(ctx)) return;
		}
		next();
	};
}
