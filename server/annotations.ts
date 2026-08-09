// Reading-context projections: annotations and favorites share one versioned owner.
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	addAnnotation,
	deleteAnnotation,
	loadAnnotationDocument,
	updateAnnotation,
	type AnnotationType,
} from "../core/annotation/store";
import { resolveNodeSourceHash, scanStale } from "../core/annotation/staleness";
import {
	addFavorite,
	importFavorites,
	loadFavoriteDocument,
	removeFavorite,
	type FavoriteKind,
	type FavoriteSource,
} from "../core/favorites/store";
import { loadReadingContext, ReadingContextConflictError, type ReadingFavorite } from "../core/reading-context/store";
import { type ApiHandler, readJsonBody, sendJson } from "./http";

function setRevision(res: ServerResponse, revision: number): void {
	res.setHeader("ETag", `"${revision}"`);
	res.setHeader("X-Reading-Context-Revision", String(revision));
}

function expectedRevision(req: IncomingMessage): number | null {
	const raw = Array.isArray(req.headers["if-match"]) ? req.headers["if-match"]![0] : req.headers["if-match"];
	if (!raw) return null;
	const match = String(raw).match(/(\d+)/);
	return match ? Number(match[1]) : null;
}

function requireExpectedRevision(req: IncomingMessage, res: ServerResponse): number | null {
	const revision = expectedRevision(req);
	if (revision !== null) return revision;
	sendJson(res, 428, { error: "写入阅读上下文必须携带 If-Match revision。", code: "READING_CONTEXT_PRECONDITION_REQUIRED" });
	return null;
}

function sendConflict(res: ServerResponse, error: ReadingContextConflictError, subsystem?: string): void {
	setRevision(res, error.current.revision);
	const entries = subsystem === undefined ? undefined : error.current.annotations
		.filter((entry) => entry.subsystem === subsystem)
		.map((entry) => ({ node_id: entry.node_id, domain: error.current.domain, annotations: entry.annotations }));
	sendJson(res, 409, {
		error: error.message,
		code: error.code,
		revision: error.current.revision,
		...(entries ? { entries } : { favorites: error.current.favorites }),
	});
}

function parseFavorite(body: Record<string, unknown>): Omit<ReadingFavorite, "added_at"> & { added_at?: string } {
	const kind: FavoriteKind = body.kind === "class" ? "class" : "function";
	const source: FavoriteSource = body.source === "project" || body.source === "engine" ? body.source : "unknown";
	return {
		kind,
		source,
		node_id: String(body.node_id ?? ""),
		...(typeof body.label === "string" ? { label: body.label } : {}),
		...(typeof body.parent_id === "string" ? { parent_id: body.parent_id } : {}),
		...(typeof body.module === "string" ? { module: body.module } : {}),
		...(typeof body.source_path === "string" ? { source_path: body.source_path } : {}),
		...(typeof body.added_at === "string" ? { added_at: body.added_at } : {}),
	};
}

export const handleAnnotations: ApiHandler = async ({ req, res, url }) => {
	const annMatch = url.match(/^\/api\/annotations\/([\w-]+)\/([\w-]+)$/);
	if (!annMatch) return false;
	const [, domain, subsystem] = annMatch;
	if (domain !== "ue5_code") {
		sendJson(res, 410, { error: "Annotations are retained only for extracted UE code facts.", code: "GRAPHBRAIN_AUTHORING_RETIRED" });
		return true;
	}
	try {
		if (req.method === "GET") {
			const current = loadAnnotationDocument(domain, subsystem);
			setRevision(res, current.revision);
			sendJson(res, 200, current.entries);
			return true;
		}
		if (req.method === "POST") {
			const revision = requireExpectedRevision(req, res);
			if (revision === null) return true;
			const body = await readJsonBody(req);
			const nodeId = String(body.node_id ?? "");
			const annotation = (body.annotation ?? {}) as { type?: AnnotationType; content?: string };
			if (!nodeId && body.action !== "scan") throw new Error("缺少 node_id");
			let write;
			switch (body.action) {
				case "add":
					write = addAnnotation(domain, subsystem, nodeId, {
						type: annotation.type ?? "gotcha",
						content: annotation.content ?? "",
						source_hash: resolveNodeSourceHash(domain, subsystem, nodeId) ?? undefined,
					}, revision);
					break;
				case "update": {
					const hash = resolveNodeSourceHash(domain, subsystem, nodeId);
					write = updateAnnotation(domain, subsystem, nodeId, String(body.ann_id ?? ""), {
						...annotation,
						...(hash ? { source_hash: hash, stale: false } : {}),
					}, revision);
					break;
				}
				case "review": {
					const hash = resolveNodeSourceHash(domain, subsystem, nodeId);
					if (!hash) throw new Error("无法定位该节点的源文件，无法复核");
					write = updateAnnotation(domain, subsystem, nodeId, String(body.ann_id ?? ""), { source_hash: hash, stale: false }, revision);
					break;
				}
				case "scan": {
					const before = loadAnnotationDocument(domain, subsystem);
					if (before.revision !== revision) throw new ReadingContextConflictError(revision, loadReadingContext(domain));
					scanStale(domain, subsystem);
					const current = loadAnnotationDocument(domain, subsystem);
					setRevision(res, current.revision);
					sendJson(res, 200, current.entries);
					return true;
				}
				case "delete":
					write = deleteAnnotation(domain, subsystem, nodeId, String(body.ann_id ?? ""), revision);
					break;
				default:
					throw new Error(`未知 action: ${String(body.action)}`);
			}
			setRevision(res, write.revision);
			sendJson(res, 200, write.entries);
			return true;
		}
		res.statusCode = 405;
		res.end();
	} catch (error) {
		if (error instanceof ReadingContextConflictError) sendConflict(res, error, subsystem);
		else sendJson(res, 400, { error: (error as Error).message });
	}
	return true;
};

export const handleFavorites: ApiHandler = async ({ req, res, url }) => {
	const favMatch = url.match(/^\/api\/favorites\/([\w-]+)$/);
	if (!favMatch) return false;
	const [, domain] = favMatch;
	if (domain !== "ue5_code") {
		sendJson(res, 410, { error: "Favorites are retained only for extracted UE code facts.", code: "GRAPHBRAIN_AUTHORING_RETIRED" });
		return true;
	}
	try {
		if (req.method === "GET") {
			const current = loadFavoriteDocument(domain);
			setRevision(res, current.revision);
			sendJson(res, 200, current.favorites);
			return true;
		}
		if (req.method === "POST") {
			const revision = requireExpectedRevision(req, res);
			if (revision === null) return true;
			const body = await readJsonBody(req);
			let write;
			switch (body.action) {
				case "add":
					write = addFavorite(domain, parseFavorite(body), revision);
					break;
				case "remove":
					write = removeFavorite(domain, parseFavorite(body), revision);
					break;
				case "import_legacy": {
					const raw = Array.isArray(body.favorites) ? body.favorites : [];
					write = importFavorites(domain, raw.map((item) => parseFavorite(item as Record<string, unknown>)), revision);
					break;
				}
				default:
					throw new Error(`未知 action: ${String(body.action)}`);
			}
			setRevision(res, write.revision);
			sendJson(res, 200, write.favorites);
			return true;
		}
		res.statusCode = 405;
		res.end();
	} catch (error) {
		if (error instanceof ReadingContextConflictError) sendConflict(res, error);
		else sendJson(res, 400, { error: (error as Error).message });
	}
	return true;
};

export const annotationHandlers: ApiHandler[] = [handleAnnotations, handleFavorites];
