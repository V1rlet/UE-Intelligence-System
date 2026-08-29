// Reading-context projections: annotations and favorites share one versioned owner.
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	addAnnotation,
	deleteAnnotation,
	loadAnnotationDocument,
	updateAnnotation,
} from "../core/annotation/store";
import { resolveAnchorFingerprint, resolveNodeSourceHash, scanStale } from "../core/annotation/staleness";
import {
	addFavorite,
	importFavorites,
	loadFavoriteDocument,
	removeFavorite,
} from "../core/favorites/store";
import { loadReadingContext, ReadingContextConflictError } from "../core/reading-context/store";
import { FileLockBusyError } from "../core/store/file-lock";
import {
	type ApiHandler,
	HttpError,
	HttpInputError,
	methodNotAllowed,
	readJsonBody,
	sendHttpError,
	sendInternalError,
	sendJson,
} from "./http";
import { parseAnnotationInput, parseExpectedRevision, parseFavoriteInput, parseRequiredId } from "./reading-context-input";

function setRevision(res: ServerResponse, revision: number): void {
	res.setHeader("ETag", `"${revision}"`);
	res.setHeader("X-Reading-Context-Revision", String(revision));
}

function expectedRevision(req: IncomingMessage): number | null {
	return parseExpectedRevision(req.headers["if-match"]);
}

function requireExpectedRevision(req: IncomingMessage, res: ServerResponse): number | null {
	const revision = expectedRevision(req);
	if (revision !== null) return revision;
	// 缺失与畸形是两种客户端错误：缺失=未带前置条件（428），畸形=带的值不合法（400）。
	const raw = req.headers["if-match"];
	const present = raw !== undefined && (!Array.isArray(raw) || raw.length > 0);
	if (present) {
		sendJson(res, 400, { error: "If-Match 必须是单个整数 revision（带或不带引号）。", code: "READING_CONTEXT_PRECONDITION_INVALID" });
		return null;
	}
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

function sendBusy(res: ServerResponse): void {
	res.setHeader("Retry-After", "1");
	sendJson(res, 503, { error: "阅读上下文正在由其他请求更新，请稍后重试。", code: "READING_CONTEXT_BUSY" });
}


/** D-P3：把客户端请求的行区间变成服务端计算的锚（fingerprint 不信任客户端）。
 *  未请求锚 → undefined；源文件/区间不可用 → 422。 */
function resolveAnchor(
	domain: string,
	subsystem: string,
	nodeId: string,
	annotation: { anchor?: { start_line: number; end_line: number } },
): { start_line: number; end_line: number; fingerprint: string } | undefined {
	if (!annotation.anchor) return undefined;
	const fingerprint = resolveAnchorFingerprint(domain, subsystem, nodeId, annotation.anchor.start_line, annotation.anchor.end_line);
	if (!fingerprint) {
		throw new HttpError(422, "无法定位该节点的源文件或行区间超出范围，无法建立行级锚", "ANNOTATION_ANCHOR_UNRESOLVABLE");
	}
	return { start_line: annotation.anchor.start_line, end_line: annotation.anchor.end_line, fingerprint };
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
			let write;
			switch (body.action) {
				case "add": {
					const nodeId = parseRequiredId(body, "node_id");
					const annotation = parseAnnotationInput(body.annotation, true);
					const anchor = resolveAnchor(domain, subsystem, nodeId, annotation);
					write = addAnnotation(domain, subsystem, nodeId, {
						type: annotation.type!,
						content: annotation.content!,
						source_hash: resolveNodeSourceHash(domain, subsystem, nodeId) ?? undefined,
						anchor,
					}, revision);
					break;
				}
				case "update": {
					const nodeId = parseRequiredId(body, "node_id");
					const annId = parseRequiredId(body, "ann_id");
					const annotation = parseAnnotationInput(body.annotation);
					const hash = resolveNodeSourceHash(domain, subsystem, nodeId);
					const anchor = resolveAnchor(domain, subsystem, nodeId, annotation);
					write = updateAnnotation(domain, subsystem, nodeId, annId, {
						type: annotation.type,
						content: annotation.content,
						...(hash ? { source_hash: hash, stale: false } : {}),
						...(anchor ? { anchor, stale: false } : {}),
					}, revision);
					break;
				}
				case "review": {
					const nodeId = parseRequiredId(body, "node_id");
					const annId = parseRequiredId(body, "ann_id");
					const hash = resolveNodeSourceHash(domain, subsystem, nodeId);
					if (!hash) throw new HttpError(422, "无法定位该节点的源文件，无法复核", "ANNOTATION_SOURCE_UNAVAILABLE");
					write = updateAnnotation(domain, subsystem, nodeId, annId, { source_hash: hash, stale: false }, revision);
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
				case "delete": {
					const nodeId = parseRequiredId(body, "node_id");
					const annId = parseRequiredId(body, "ann_id");
					write = deleteAnnotation(domain, subsystem, nodeId, annId, revision);
					break;
				}
				default:
					throw new HttpInputError(`未知 action: ${String(body.action)}`);
			}
			setRevision(res, write.revision);
			sendJson(res, 200, write.entries);
			return true;
		}
		methodNotAllowed(res, "GET, POST");
	} catch (error) {
		if (error instanceof ReadingContextConflictError) sendConflict(res, error, subsystem);
		else if (error instanceof FileLockBusyError) sendBusy(res);
		else if (!sendHttpError(res, error)) sendInternalError(res, error, "annotation request failed");
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
					write = addFavorite(domain, parseFavoriteInput(body), revision);
					break;
				case "remove":
					write = removeFavorite(domain, parseFavoriteInput(body), revision);
					break;
				case "import_legacy": {
					if (!Array.isArray(body.favorites)) throw new HttpInputError("字段 favorites 必须是数组");
					write = importFavorites(domain, body.favorites.map(parseFavoriteInput), revision);
					break;
				}
				default:
					throw new HttpInputError(`未知 action: ${String(body.action)}`);
			}
			setRevision(res, write.revision);
			sendJson(res, 200, write.favorites);
			return true;
		}
		methodNotAllowed(res, "GET, POST");
	} catch (error) {
		if (error instanceof ReadingContextConflictError) sendConflict(res, error);
		else if (error instanceof FileLockBusyError) sendBusy(res);
		else if (!sendHttpError(res, error)) sendInternalError(res, error, "favorite request failed");
	}
	return true;
};

export const annotationHandlers: ApiHandler[] = [handleAnnotations, handleFavorites];
