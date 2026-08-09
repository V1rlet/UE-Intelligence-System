// Graph Brain / server - 基础数据路由族：Mermaid 索引 / 文档目录 / data 直读
// ⛔ /api/graphs 已合并进 /api/graph-catalog（2026-08-07）：graph-catalog 是超集（含 meta/status/revision），
// 调用方改用 graph-catalog（file 字段）。

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { graphCatalogEntries } from "./catalog";
import { isPublishedArtifactVisible } from "../core/store/data-publication.js";
import { type ApiHandler, isExistingPathWithin, isPathWithin, methodNotAllowed, sendJson } from "./http";

/** Mermaid 序列图索引（P3U5）：扫 data/mermaid/*.mmd 头部元数据注释 */
export const handleMermaid: ApiHandler = ({ req, res, url, dataDir }) => {
	if (url !== "/api/mermaid") return false;
	if (req.method !== "GET") {
		methodNotAllowed(res);
		return true;
	}
	try {
		const mmdDir = join(dataDir, "mermaid");
		const entries: { file: string; title: string; nodes: string[] }[] = [];
		if (existsSync(mmdDir)) {
			for (const f of readdirSync(mmdDir).filter((x) => x.endsWith(".mmd")).sort().reverse()) {
				const head = readFileSync(join(mmdDir, f), "utf8").split("\n").slice(0, 10);
				const title = head
					.find((l) => /^\s*%%\s*title\s*:/.test(l))
					?.replace(/^\s*%%\s*title\s*:\s*/, "")
					.trim();
				const nodes =
					head
						.find((l) => /^\s*%%\s*nodes\s*:/.test(l))
						?.replace(/^\s*%%\s*nodes\s*:\s*/, "")
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean) ?? [];
				entries.push({ file: f, title: title || f, nodes });
			}
		}
		sendJson(res, 200, entries);
	} catch (e) {
		sendJson(res, 500, { error: (e as Error).message });
	}
	return true;
};

/** 文档目录：比裸文件名多返回模块身份、状态与规模，供文档中心总览/筛选。 */
export const handleGraphCatalog: ApiHandler = ({ req, res, url, dataDir }) => {
	if (url !== "/api/graph-catalog") return false;
	if (req.method !== "GET") {
		methodNotAllowed(res);
		return true;
	}
	try {
		sendJson(res, 200, graphCatalogEntries(join(dataDir, "graphs")));
	} catch (e) {
		sendJson(res, 500, { error: (e as Error).message });
	}
	return true;
};

/** 数据文件直读（限制在 data/ 目录内，防路径穿越） */
export const handleDataFiles: ApiHandler = ({ req, res, url, dataDir }) => {
	if (!url.startsWith("/data/")) return false;
	if (req.method !== "GET") {
		res.statusCode = 405;
		res.setHeader("Allow", "GET");
		res.end();
		return true;
	}
	const relativePath = url.slice("/data/".length);
	// 拒绝任何 .. 段：`/data/mermaid/../graphs/<被隐藏的历史图>` 会绕过 graphs 分支的
	// 发布可见性守卫直接读取 publication 隐藏的产物。
	if (relativePath.split("/").includes("..")) {
		res.statusCode = 404;
		res.end("not found");
		return true;
	}
	if (!relativePath.startsWith("graphs/") && !relativePath.startsWith("mermaid/")) {
		res.statusCode = 404;
		res.end("not found");
		return true;
	}
	const target = resolve(dataDir, relativePath);
	if (relativePath.startsWith("graphs/")
		&& !isPublishedArtifactVisible(basename(relativePath), join(dataDir, "publications"), "graph")) {
		res.statusCode = 404;
		res.end("not found");
		return true;
	}
	if (!isPathWithin(dataDir, target)) {
		res.statusCode = 403;
		res.end("forbidden");
		return true;
	}
	if (!existsSync(target)) {
		res.statusCode = 404;
		res.end("not found");
		return true;
	}
	if (!isExistingPathWithin(dataDir, target)) {
		res.statusCode = 403;
		res.end("forbidden");
		return true;
	}
	let contents: Buffer;
	try {
		if (!statSync(target).isFile()) throw new Error("not a file");
		contents = readFileSync(target);
	} catch {
		res.statusCode = 404;
		res.end("not found");
		return true;
	}
	if (relativePath.startsWith("graphs/")) {
		try {
			const graph = JSON.parse(contents.toString("utf8").replace(/^﻿/, ""));
			if (String(graph.meta?.domain ?? "") !== "ue5_code") {
				res.statusCode = 404;
				res.end("not found");
				return true;
			}
		} catch {
			res.statusCode = 404;
			res.end("not found");
			return true;
		}
	}
	res.setHeader(
		"Content-Type",
		target.endsWith(".json") ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
	);
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.end(contents);
	return true;
};

export const miscHandlers: ApiHandler[] = [handleMermaid, handleGraphCatalog, handleDataFiles];
