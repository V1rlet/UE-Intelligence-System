import { hasChangeSummaryFacts, type ChangeReport } from "./change-report.js";

export const CHANGE_REPORT_CATALOG_FORMAT_VERSION = 1 as const;

export interface ChangeReportCatalogEntry {
	file: string;
	format_version: ChangeReport["format_version"];
	subsystem: string;
	generated_at: string;
	baseline: ChangeReport["baseline"];
	current: ChangeReport["current"];
	summary: ChangeReport["summary"];
}

export interface ChangeReportCatalog {
	format_version: typeof CHANGE_REPORT_CATALOG_FORMAT_VERSION;
	default_report: string | null;
	reports: ChangeReportCatalogEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSnapshot(value: unknown): value is ChangeReport["baseline"] {
	return isRecord(value)
		&& typeof value.file === "string"
		&& (value.generated_at === null || typeof value.generated_at === "string")
		&& (value.fingerprint === null || typeof value.fingerprint === "string");
}

function isCounts(value: unknown): value is ChangeReport["summary"]["nodes"] {
	return isRecord(value)
		&& Number.isInteger(value.added) && Number(value.added) >= 0
		&& Number.isInteger(value.removed) && Number(value.removed) >= 0
		&& Number.isInteger(value.changed) && Number(value.changed) >= 0;
}

function isSummary(value: unknown): value is ChangeReport["summary"] {
	return isRecord(value)
		&& isCounts(value.nodes)
		&& isCounts(value.edges)
		&& Number.isInteger(value.direct_nodes) && Number(value.direct_nodes) >= 0
		&& Number.isInteger(value.affected_nodes) && Number(value.affected_nodes) >= 0
		&& Number.isInteger(value.affected_modules) && Number(value.affected_modules) >= 0;
}

function isEntry(value: unknown): value is ChangeReportCatalogEntry {
	if (!isRecord(value)) return false;
	return typeof value.file === "string" && value.file.endsWith(".change.json")
		&& value.format_version === 1
		&& typeof value.subsystem === "string"
		&& typeof value.generated_at === "string"
		&& isSnapshot(value.baseline)
		&& isSnapshot(value.current)
		&& isSummary(value.summary);
}

function orderedEntries(entries: readonly ChangeReportCatalogEntry[]): ChangeReportCatalogEntry[] {
	return [...entries].sort((a, b) => b.generated_at.localeCompare(a.generated_at) || a.file.localeCompare(b.file));
}

/** Empty refreshes remain auditable but do not displace the latest meaningful change evidence. */
export function buildChangeReportCatalog(entries: readonly ChangeReportCatalogEntry[]): ChangeReportCatalog {
	const reports = orderedEntries(entries);
	const meaningful = reports.find((entry) => hasChangeSummaryFacts(entry.summary));
	return {
		format_version: CHANGE_REPORT_CATALOG_FORMAT_VERSION,
		default_report: meaningful?.file ?? reports[0]?.file ?? null,
		reports,
	};
}

/**
 * One compatibility boundary for pre-v1 servers that returned the report array directly.
 * Remove the array branch after every supported server publishes catalog format v1.
 */
export function normalizeChangeReportCatalogResponse(value: unknown): ChangeReportCatalog {
	if (Array.isArray(value)) {
		if (!value.every(isEntry)) throw new Error("旧版变化目录包含无效条目");
		return buildChangeReportCatalog(value);
	}
	if (!isRecord(value) || value.format_version !== CHANGE_REPORT_CATALOG_FORMAT_VERSION || !Array.isArray(value.reports) || !value.reports.every(isEntry)) {
		throw new Error("变化目录格式不受支持");
	}
	const reports = orderedEntries(value.reports);
	const files = new Set(reports.map((entry) => entry.file));
	if (value.default_report !== null && (typeof value.default_report !== "string" || !files.has(value.default_report))) {
		throw new Error("变化目录的默认报告无效");
	}
	if (reports.length > 0 && value.default_report === null) throw new Error("变化目录缺少默认报告");
	if (reports.length === 0 && value.default_report !== null) throw new Error("空变化目录不能指定默认报告");
	return {
		format_version: CHANGE_REPORT_CATALOG_FORMAT_VERSION,
		default_report: value.default_report,
		reports,
	};
}
