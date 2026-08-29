import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { buildFileForestProjection, type ProjectionGraph } from "../core/query/graph-projection.js";
import { GRAPH_PROJECTION_FORMAT_VERSION } from "../core/schema/graph-projection.js";
import { isPublishedArtifactVisible } from "../core/store/data-publication.js";
import { archivedCuratedReference } from "../core/store/curated-reference-archive.js";
import { type ApiHandler, isExistingPathWithin, isPathWithin, searchParamsOf, sendInternalError, sendJson } from "./http.js";

const projectionCache = new Map<string, { mtimeMs: number; size: number; document: ReturnType<typeof buildFileForestProjection> }>();
/** 内容寻址图每代一个新文件名，缓存只增不删会缓慢泄漏；上限内按插入序逐出最旧。 */
const PROJECTION_CACHE_MAX = 32;

function cacheProjection(path: string, value: { mtimeMs: number; size: number; document: ReturnType<typeof buildFileForestProjection> }): void {
	projectionCache.set(path, value);
	if (projectionCache.size > PROJECTION_CACHE_MAX) {
		const oldest = projectionCache.keys().next().value;
		if (oldest !== undefined) projectionCache.delete(oldest);
	}
}

export function graphProjectionForFile(graphsDir: string, file: string) {
	if (!file.endsWith(".cyto.json") || basename(file) !== file) return null;
	if (!isPublishedArtifactVisible(file, join(dirname(graphsDir), "publications"), "graph")) return null;
	const target = resolve(graphsDir, file);
	if (!isPathWithin(graphsDir, target)) return null;
	let stat;
	try {
		if (!existsSync(target) || !isExistingPathWithin(graphsDir, target)) return null;
		stat = statSync(target);
	} catch {
		// exists/stat 之间存在删除窗口，视为不可用而非服务器错误。
		return null;
	}
	if (!stat.isFile()) return null;
	const cached = projectionCache.get(target);
	if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.document;
	try {
		const graph = JSON.parse(readFileSync(target, "utf8").replace(/^﻿/, "")) as ProjectionGraph;
		if (String(graph.meta?.domain ?? "") !== "ue5_code") return null;
		const document = buildFileForestProjection(graph, file);
		cacheProjection(target, { mtimeMs: stat.mtimeMs, size: stat.size, document });
		return document;
	} catch {
		// stat 与 read 之间存在替换/截断窗口（watcher 重发布）：与兄弟读取方一致，
		// 视为投影不可用（404）而非内部错误（500）。
		return null;
	}
}

export const handleGraphProjection: ApiHandler = ({ req, res, url, dataDir }) => {
	if (url !== "/api/graph-projection") return false;
	if (req.method !== "GET") {
		res.statusCode = 405;
		res.setHeader("Allow", "GET");
		res.end();
		return true;
	}
	const file = searchParamsOf(req).get("file") ?? "";
	try {
		const archived = archivedCuratedReference(dataDir, file);
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
		const document = graphProjectionForFile(join(dataDir, "graphs"), file);
		if (!document) sendJson(res, 404, { error: "代码图投影不存在" });
		else {
			res.setHeader("X-Graph-Projection-Version", String(GRAPH_PROJECTION_FORMAT_VERSION));
			sendJson(res, 200, document);
		}
	} catch (error) {
		sendInternalError(res, error, "graph projection failed");
	}
	return true;
};
