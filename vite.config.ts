// Graph Brain / viewer - Vite 配置：dev server 兼作本地图谱数据服务
//
// DECISION: 用 Vite dev server 中间件暴露 /api/graphs（图谱文件列表）和 /data/*（数据文件），
//           而非另起独立静态服务器
// REASON: P1 阶段只需本地单人使用；一个进程同时供前端与数据，P1U4 的标注保存
//         接口（POST）也可继续挂在同一中间件上，避免多服务编排。
// DATE: 2026-07-02

import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import {
	addAnnotation,
	deleteAnnotation,
	loadAnnotations,
	updateAnnotation,
	type AnnotationType,
} from "./core/annotation/store";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(ROOT, "data");

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise((resolvePromise, reject) => {
		let raw = "";
		req.on("data", (chunk) => (raw += chunk));
		req.on("end", () => {
			try {
				resolvePromise(raw ? JSON.parse(raw) : {});
			} catch (e) {
				reject(e);
			}
		});
		req.on("error", reject);
	});
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(payload));
}

function dataApiPlugin(): Plugin {
	return {
		name: "graph-brain-data-api",
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				const url = decodeURIComponent((req.url ?? "").split("?")[0]);

				// 标注读写：GET 取整份文件条目，POST 按 action 增/改/删（均返回最新条目数组）
				const annMatch = url.match(/^\/api\/annotations\/([\w-]+)\/([\w-]+)$/);
				if (annMatch) {
					const [, domain, subsystem] = annMatch;
					try {
						if (req.method === "GET") {
							sendJson(res, 200, loadAnnotations(domain, subsystem));
							return;
						}
						if (req.method === "POST") {
							const body = await readJsonBody(req);
							const nodeId = String(body.node_id ?? "");
							const ann = (body.annotation ?? {}) as { type?: AnnotationType; content?: string };
							if (!nodeId) throw new Error("缺少 node_id");
							let entries;
							switch (body.action) {
								case "add":
									entries = addAnnotation(domain, subsystem, nodeId, {
										type: ann.type ?? "gotcha",
										content: ann.content ?? "",
									});
									break;
								case "update":
									entries = updateAnnotation(domain, subsystem, nodeId, String(body.ann_id ?? ""), ann);
									break;
								case "delete":
									entries = deleteAnnotation(domain, subsystem, nodeId, String(body.ann_id ?? ""));
									break;
								default:
									throw new Error(`未知 action: ${String(body.action)}`);
							}
							sendJson(res, 200, entries);
							return;
						}
						res.statusCode = 405;
						res.end();
					} catch (e) {
						sendJson(res, 400, { error: (e as Error).message });
					}
					return;
				}

				// 图谱文件列表（新→旧排序，前端默认取第一个）
				if (url === "/api/graphs") {
					const graphsDir = join(DATA_DIR, "graphs");
					const files = existsSync(graphsDir)
						? readdirSync(graphsDir).filter((f) => f.endsWith(".cyto.json")).sort().reverse()
						: [];
					res.setHeader("Content-Type", "application/json");
					res.end(JSON.stringify(files));
					return;
				}

				// 数据文件直读（限制在 data/ 目录内，防路径穿越）
				if (url.startsWith("/data/")) {
					const target = resolve(DATA_DIR, url.slice("/data/".length));
					if (!target.startsWith(DATA_DIR)) {
						res.statusCode = 403;
						res.end("forbidden");
						return;
					}
					if (!existsSync(target)) {
						res.statusCode = 404;
						res.end("not found");
						return;
					}
					res.setHeader("Content-Type", "application/json");
					res.end(readFileSync(target));
					return;
				}

				next();
			});
		},
	};
}

export default defineConfig({
	root: "viewer",
	plugins: [react(), dataApiPlugin()],
	// 3010=AFFiNE、3021=CytoscapeViewer、3022=本机已有 node 服务占用，取 3030 并固定
	server: { port: 3030, strictPort: true },
});
