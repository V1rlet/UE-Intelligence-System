// Graph Brain / server - base data routes: graph catalog and published graph reads.
// ⛔ /api/graphs 已合并进 /api/graph-catalog（2026-08-07）：graph-catalog 是超集（含 meta/status/revision），
// 调用方改用 graph-catalog（file 字段）。

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { graphCatalogEntries } from "./catalog";
import { isPublishedArtifactVisible } from "../core/store/data-publication.js";
import { archivedCuratedReference } from "../core/store/curated-reference-archive.js";
import { type ApiHandler, isExistingPathWithin, isPathWithin, methodNotAllowed, sendInternalError, sendJson } from "./http";

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
		sendInternalError(res, e, "graph catalog failed");
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
	// Reject traversal before the publication visibility boundary is evaluated.
	// Windows 把 %5C 解码出的反斜杠也当分隔符，仅按 "/" 切分会放过 graphs/..\archive。
	if (relativePath.split(/[\\/]/).some((segment) => segment === ".." || segment === "")) {
		sendJson(res, 404, { error: "not found", code: "DATA_FILE_NOT_FOUND" });
		return true;
	}
	if (!relativePath.startsWith("graphs/")) {
		sendJson(res, 404, { error: "not found", code: "DATA_FILE_NOT_FOUND" });
		return true;
	}
	if (relativePath.startsWith("graphs/")) {
		const archived = archivedCuratedReference(dataDir, basename(relativePath));
		if (archived) {
			sendJson(res, 410, {
				code: "CURATED_REFERENCE_ARCHIVED",
				error: "curated reference graph is archived and is no longer a current code fact",
				file: archived.file,
				subsystem: archived.subsystem,
				sha256: archived.sha256,
			});
			return true;
		}
	}
	const target = resolve(dataDir, relativePath);
	if (relativePath.startsWith("graphs/")
		&& !isPublishedArtifactVisible(basename(relativePath), join(dataDir, "publications"), "graph")) {
		sendJson(res, 404, { error: "not found", code: "DATA_FILE_NOT_FOUND" });
		return true;
	}
	if (!isPathWithin(dataDir, target)) {
		sendJson(res, 403, { error: "forbidden", code: "DATA_FILE_FORBIDDEN" });
		return true;
	}
	if (!existsSync(target)) {
		sendJson(res, 404, { error: "not found", code: "DATA_FILE_NOT_FOUND" });
		return true;
	}
	if (!isExistingPathWithin(dataDir, target)) {
		sendJson(res, 403, { error: "forbidden", code: "DATA_FILE_FORBIDDEN" });
		return true;
	}
	let contents: Buffer;
	try {
		if (!statSync(target).isFile()) throw new Error("not a file");
		contents = readFileSync(target);
	} catch {
		sendJson(res, 404, { error: "not found", code: "DATA_FILE_NOT_FOUND" });
		return true;
	}
	if (relativePath.startsWith("graphs/")) {
		try {
			const graph = JSON.parse(contents.toString("utf8").replace(/^﻿/, ""));
			if (String(graph.meta?.domain ?? "") !== "ue5_code") {
				sendJson(res, 404, { error: "not found", code: "DATA_FILE_NOT_FOUND" });
				return true;
			}
		} catch {
			sendJson(res, 404, { error: "not found", code: "DATA_FILE_NOT_FOUND" });
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

export const miscHandlers: ApiHandler[] = [handleGraphCatalog, handleDataFiles];
