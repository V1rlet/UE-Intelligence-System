import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { withFileLock } from "../store/file-lock.js";
import { renameDurableSync, writeFsyncedTemporary } from "../store/durable-write.js";

export const LOCAL_USAGE_FORMAT = "graphbrain-local-usage/1" as const;
export const LOCAL_USAGE_KEYS = [
	"workspace.overview", "workspace.explore.architecture", "workspace.explore.relations", "workspace.explore.api", "workspace.changes",
	"evidence.status", "evidence.symbols", "evidence.symbol", "evidence.neighborhood", "evidence.changes", "evidence.refresh",
	"engine.catalog-browse", "mermaid.open", "embed.open",
] as const;
export type LocalUsageKey = (typeof LOCAL_USAGE_KEYS)[number];

export interface LocalUsageMetric {
	count: number;
	total_duration_ms: number;
	cache_hits: number;
	cache_misses: number;
	cache_unknown: number;
}

export interface LocalUsageSummary {
	format_version: typeof LOCAL_USAGE_FORMAT;
	updated_at: string;
	metrics: Partial<Record<LocalUsageKey, LocalUsageMetric>>;
}

export function localUsagePath(root: string): string {
	return join(root, "logs", "usage-summary.json");
}

export function emptyLocalUsage(): LocalUsageSummary {
	return { format_version: LOCAL_USAGE_FORMAT, updated_at: "1970-01-01T00:00:00.000Z", metrics: {} };
}

export function loadLocalUsage(root: string): LocalUsageSummary {
	const path = localUsagePath(root);
	if (!existsSync(path)) return emptyLocalUsage();
	const value = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as LocalUsageSummary;
	if (value.format_version !== LOCAL_USAGE_FORMAT || !value.metrics || typeof value.metrics !== "object") throw new Error("local usage summary is invalid");
	return value;
}

function atomicWrite(path: string, value: LocalUsageSummary): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
	try {
		writeFsyncedTemporary(temporary, `${JSON.stringify(value, null, 2)}\n`);
		renameDurableSync(temporary, path);
	} finally { rmSync(temporary, { force: true }); }
}

/** Stores only allowlisted aggregate counters. No text, source facts, URLs, or identities enter this boundary. */
export function recordLocalUsage(root: string, key: LocalUsageKey, input: { durationMs?: number; cacheHit?: boolean | null } = {}): LocalUsageSummary {
	if (!LOCAL_USAGE_KEYS.includes(key)) throw new Error("local usage key is not allowlisted");
	const path = localUsagePath(root);
	return withFileLock(`${path}.lock`, () => {
		const current = loadLocalUsage(root);
		const previous = current.metrics[key] ?? { count: 0, total_duration_ms: 0, cache_hits: 0, cache_misses: 0, cache_unknown: 0 };
		const duration = Number.isFinite(input.durationMs) ? Math.max(0, Math.round(input.durationMs!)) : 0;
		const next: LocalUsageSummary = {
			...current,
			updated_at: new Date().toISOString(),
			metrics: {
				...current.metrics,
				[key]: {
					count: previous.count + 1,
					total_duration_ms: previous.total_duration_ms + duration,
					cache_hits: previous.cache_hits + (input.cacheHit === true ? 1 : 0),
					cache_misses: previous.cache_misses + (input.cacheHit === false ? 1 : 0),
					cache_unknown: previous.cache_unknown + (input.cacheHit === null ? 1 : 0),
				},
			},
		};
		atomicWrite(path, next);
		return next;
	}, { busy: "throw", onRecover: (reason) => console.warn(`[local-usage] recovered stale lock (${reason})`) })!;
}
