// Graph Brain / viewer - Vite 配置：dev server 兼作本地图谱数据服务
//
// DECISION: 用 Vite dev server 中间件暴露 /api/*（本地数据服务）和 /data/*（数据文件），
//           而非另起独立静态服务器
// REASON: 本地单人使用；一个进程同时供前端与数据，标注保存等 POST 接口挂同一中间件,
//         避免多服务编排。
// DATE: 2026-07-02
//
// DECISION: API 中间件实现拆分到 server/（http 原语 / catalog / graph projection /
//           engine / annotations / misc / router），本文件只留装配
// REASON: ~600 行路由逻辑寄生在构建配置里无模块边界、无法单测（评析文档风险 #2）；
//         拆出后各路由族可独立导入测试，vite 配置热重载不再牵动业务代码组织。
// DATE: 2026-07-20 (F30)

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { startLoreWatcher, stopLoreWatcher } from "./core/hooks/lore-watcher";
import { createApiRouter } from "./server/router";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(ROOT, "data");

function dataApiPlugin(): Plugin {
	return {
		name: "graph-brain-data-api",
		configureServer(server) {
			// P4U4：Lore 无 hook 挂点 → 常驻查看器服务兼任轮询 watcher（30s 一轮，
			// 新提交触发图谱增量更新 + 标注陈旧扫描；GRAPH_BRAIN_NO_WATCHER=1 可关）。
			// 只在 canonical 端口 3030（NSSM 服务）启动：临时起的第二个 dev server
			// （--port 30xx）不再重复轮询，避免双 watcher 抢 Lore 仓库锁 / 重复触发
			const isCanonical = (server.config.server.port ?? 3030) === 3030;
			const watcherEnabled = isCanonical && !process.env.GRAPH_BRAIN_NO_WATCHER;
			if (watcherEnabled) startLoreWatcher();
			else stopLoreWatcher();
			server.middlewares.use(createApiRouter({ root: ROOT, dataDir: DATA_DIR }));
		},
		configurePreviewServer(server) {
			// Production-preview smoke tests must consume the same read-only API and
			// data resolver as development. Preview never owns a second watcher.
			stopLoreWatcher();
			server.middlewares.use(createApiRouter({ root: ROOT, dataDir: DATA_DIR }));
		},
	};
}

export default defineConfig({
	root: "viewer",
	plugins: [react(), dataApiPlugin()],
	// 常驻 NSSM 服务会随配置依赖变更而重启。首屏依赖显式预构建并尽快提交到稳定缓存；
	// 不在每次重启时强制重打，避免密集改动留下 deps_temp_*、正式 deps 缺失而返回 504。
	optimizeDeps: {
		include: [
			"react",
			"react-dom/client",
			"react/jsx-runtime",
			"react/jsx-dev-runtime",
			"cytoscape",
			"cytoscape-fcose",
			"mermaid",
		],
		holdUntilCrawlEnd: false,
	},
	// 3010=AFFiNE、3021=CytoscapeViewer、3022=本机已有 node 服务占用，取 3030 并固定
	server: { port: 3030, strictPort: true },
	// 多页入口：主查看器 + /embed 只读嵌入页（P4U5）
	build: {
		// Mermaid's unsupported diagram grammars remain separate lazy chunks. The
		// shipped sequence-diagram path and the overview shell are guarded by
		// tools/bundle-boundary-check.mjs, so the generic 500 kB warning is noise.
		chunkSizeWarningLimit: 700,
		rollupOptions: {
			input: {
				main: resolve(ROOT, "viewer/index.html"),
				embed: resolve(ROOT, "viewer/embed.html"),
			},
		},
	},
});
