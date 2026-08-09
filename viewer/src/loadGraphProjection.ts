import {
	GRAPH_PROJECTION_FORMAT_VERSION,
	GRAPH_PROJECTION_KIND,
	type GraphProjectionDocument,
} from "../../core/schema/graph-projection";
import { ApiError, apiFetch } from "./apiFetch";
import { loadGraphFile } from "./loadGraphFile";
import type { GraphFile } from "./useGraphDocument";
import {
	VIEWER_PERFORMANCE_NAMES,
	cancelProjectionTrace,
	recordViewerPerformance,
	startProjectionTrace,
} from "./viewerPerformance";

export type GraphLoadMode = "projection" | "full";

export interface LoadedGraphDocument {
	graph: GraphFile;
	mode: GraphLoadMode;
	compatibility: "current" | "legacy-full";
	projection: GraphProjectionDocument | null;
}

function graphFileFromProjection(document: GraphProjectionDocument): GraphFile {
	if (document.format_version !== GRAPH_PROJECTION_FORMAT_VERSION || document.kind !== GRAPH_PROJECTION_KIND) {
		throw new Error(`不支持的代码图投影格式：v${String(document.format_version)}`);
	}
	if (!document.elements || !Array.isArray(document.elements.nodes) || !Array.isArray(document.elements.edges)) {
		throw new Error("代码图投影响应格式错误");
	}
	return document as unknown as GraphFile;
}

/** Projection transport with one centralized old-server fallback. */
export async function loadGraphDocument(
	file: string,
	mode: GraphLoadMode,
	options?: { signal?: AbortSignal; context?: string },
): Promise<LoadedGraphDocument> {
	if (mode === "full") {
		return {
			graph: await loadGraphFile<GraphFile>(file, options),
			mode: "full",
			compatibility: "current",
			projection: null,
		};
	}
	startProjectionTrace(file);
	try {
		const downloadStart = performance.now();
		const response = await apiFetch(
			`/api/graph-projection?file=${encodeURIComponent(file)}`,
			options?.signal ? { signal: options.signal } : undefined,
			{ notify: false, context: options?.context ?? "加载代码图投影" },
		);
		const raw = await response.text();
		const downloadEnd = performance.now();
		recordViewerPerformance(VIEWER_PERFORMANCE_NAMES.projectionDownload, downloadStart, downloadEnd, {
			file,
			bytes: new TextEncoder().encode(raw).byteLength,
		});
		const parseStart = performance.now();
		let projection: GraphProjectionDocument;
		try {
			projection = JSON.parse(raw) as GraphProjectionDocument;
		} catch {
			throw new ApiError(response.status, "服务返回了无法识别的数据");
		}
		recordViewerPerformance(VIEWER_PERFORMANCE_NAMES.projectionParse, parseStart, performance.now(), {
			file,
			nodes: projection.elements?.nodes?.length ?? 0,
			edges: projection.elements?.edges?.length ?? 0,
		});
		return { graph: graphFileFromProjection(projection), mode: "projection", compatibility: "current", projection };
	} catch (error) {
		if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 405)) {
			cancelProjectionTrace();
			throw error;
		}
		cancelProjectionTrace();
		return {
			graph: await loadGraphFile<GraphFile>(file, options),
			mode: "full",
			compatibility: "legacy-full",
			projection: null,
		};
	}
}
