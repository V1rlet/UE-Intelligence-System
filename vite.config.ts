// Graph Brain / viewer - Vite 配置：dev server 兼作本地图谱数据服务
//
// DECISION: 用 Vite dev server 中间件暴露 /api/graphs（图谱文件列表）和 /data/*（数据文件），
//           而非另起独立静态服务器
// REASON: P1 阶段只需本地单人使用；一个进程同时供前端与数据，P1U4 的标注保存
//         接口（POST）也可继续挂在同一中间件上，避免多服务编排。
// DATE: 2026-07-02

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(ROOT, "data");

function dataApiPlugin(): Plugin {
	return {
		name: "graph-brain-data-api",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const url = decodeURIComponent((req.url ?? "").split("?")[0]);

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
