import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { buildFileForestProjection, type ProjectionGraph } from "../core/query/graph-projection.js";
import { GRAPH_PROJECTION_FORMAT_VERSION } from "../core/schema/graph-projection.js";
import { isPublishedArtifactVisible } from "../core/store/data-publication.js";
import { type ApiHandler, isExistingPathWithin, isPathWithin, searchParamsOf, sendJson } from "./http.js";

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
	if (!isPathWithin(graphsDir, target) || !existsSync(target) || !isExistingPathWithin(graphsDir, target)) return null;
	const stat = statSync(target);
	if (!stat.isFile()) return null;
	const cached = projectionCache.get(target);
	if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.document;
	const graph = JSON.parse(readFileSync(target, "utf8").replace(/^﻿/, "")) as ProjectionGraph;
	if (String(graph.meta?.domain ?? "") !== "ue5_code") return null;
	const document = buildFileForestProjection(graph, file);
	cacheProjection(target, { mtimeMs: stat.mtimeMs, size: stat.size, document });
	return document;
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
		const document = graphProjectionForFile(join(dataDir, "graphs"), file);
		if (!document) sendJson(res, 404, { error: "代码图投影不存在" });
		else {
			res.setHeader("X-Graph-Projection-Version", String(GRAPH_PROJECTION_FORMAT_VERSION));
			sendJson(res, 200, document);
		}
	} catch (error) {
		sendJson(res, 500, { error: (error as Error).message });
	}
	return true;
};
