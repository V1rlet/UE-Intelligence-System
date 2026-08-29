import {
	ANNOTATION_TYPES,
	FAVORITE_KINDS,
	FAVORITE_SOURCES,
	type AnnotationType,
	type ReadingFavorite,
} from "../core/reading-context/store";
import { HttpInputError } from "./http";

type FavoriteInput = Omit<ReadingFavorite, "added_at"> & { added_at?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(body: Record<string, unknown>, key: string): string {
	const value = body[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new HttpInputError(`字段 ${key} 必须是非空字符串`);
	}
	return value;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
	const value = body[key];
	if (value === undefined) return undefined;
	if (typeof value !== "string") throw new HttpInputError(`字段 ${key} 必须是字符串`);
	return value;
}

function requiredEnum<T extends string>(
	body: Record<string, unknown>,
	key: string,
	values: readonly T[],
): T {
	const value = body[key];
	if (typeof value !== "string" || !values.includes(value as T)) {
		throw new HttpInputError(`字段 ${key} 必须是以下值之一: ${values.join(", ")}`);
	}
	return value as T;
}

/** Strict If-Match parser. Accepts only an integer or a single quoted integer ETag. */
export function parseExpectedRevision(raw: string | string[] | undefined): number | null {
	if (Array.isArray(raw) && raw.length !== 1) return null;
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (value === undefined) return null;
	const match = String(value).trim().match(/^(?:"(\d+)"|(\d+))$/);
	if (!match) return null;
	const revision = Number(match[1] ?? match[2]);
	return Number.isSafeInteger(revision) ? revision : null;
}

/** Request-boundary normalization. Invalid legacy entries are reported, never guessed. */
export function parseFavoriteInput(value: unknown): FavoriteInput {
	if (!isRecord(value)) throw new HttpInputError("收藏项必须是对象");
	const favorite: FavoriteInput = {
		kind: requiredEnum(value, "kind", FAVORITE_KINDS),
		source: requiredEnum(value, "source", FAVORITE_SOURCES),
		node_id: requiredString(value, "node_id"),
	};
	for (const key of ["label", "parent_id", "module", "source_path", "added_at"] as const) {
		const field = optionalString(value, key);
		if (field !== undefined) favorite[key] = field;
	}
	return favorite;
}

export interface AnnotationInput {
	type?: AnnotationType;
	content?: string;
	/** D-P3 行级锚请求：只接受行区间；fingerprint 由服务端按当前源文件计算，
	 *  客户端不得自报（防伪造新鲜度）。 */
	anchor?: { start_line: number; end_line: number };
}

export function parseAnnotationInput(value: unknown, requireComplete = false): AnnotationInput {
	if (!isRecord(value)) throw new HttpInputError("字段 annotation 必须是对象");
	const result: AnnotationInput = {};
	if (value.type !== undefined || requireComplete) result.type = requiredEnum(value, "type", ANNOTATION_TYPES);
	if (value.content !== undefined || requireComplete) result.content = requiredString(value, "content");
	if (value.anchor !== undefined) {
		if (!isRecord(value.anchor)) throw new HttpInputError("字段 anchor 必须是对象");
		const start = value.anchor.start_line;
		const end = value.anchor.end_line;
		if (typeof start !== "number" || !Number.isSafeInteger(start) || start < 1) throw new HttpInputError("anchor.start_line 必须是 >= 1 的整数");
		if (typeof end !== "number" || !Number.isSafeInteger(end) || end < 1) throw new HttpInputError("anchor.end_line 必须是 >= 1 的整数");
		if (end < start) throw new HttpInputError("anchor.end_line 不得小于 start_line");
		result.anchor = { start_line: start, end_line: end };
	}
	return result;
}

export function parseRequiredId(body: Record<string, unknown>, key: "node_id" | "ann_id"): string {
	return requiredString(body, key);
}
