// Read-only, versioned change-report API. Reports summarize graph snapshots; graphs remain canonical.
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { checkChangeReportConsistency, type ChangeReport } from "../core/query/change-report.js";
import {
	buildChangeReportCatalog,
	type ChangeReportCatalog,
	type ChangeReportCatalogEntry,
} from "../core/query/change-report-catalog.js";
import { checkChangeReportSchema } from "../core/schema/graph-checks.js";
import { currentPublishedGeneration, isPublishedArtifactVisible, loadDataPublicationState, visiblePublishedFiles } from "../core/store/data-publication.js";
import { type ApiHandler, isExistingPathWithin, isPathWithin, methodNotAllowed, sendJson } from "./http";

export function parseChangeReportText(text: string): ChangeReport {
	const report = JSON.parse(text) as ChangeReport;
	if (report.domain !== "ue5_code" || report.format_version !== 1) throw new Error("unsupported change report");
	const errors = [...checkChangeReportSchema(report), ...checkChangeReportConsistency(report)];
	if (errors.length > 0) throw new Error(`invalid change report: ${errors.join("; ")}`);
	return report;
}

export function parseChangeReport(path: string): ChangeReport {
	return parseChangeReportText(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

export function changeReportEntries(directory: string): ChangeReportCatalogEntry[] {
	if (!existsSync(directory)) return [];
	const entries: ChangeReportCatalogEntry[] = [];
	const publicationsDirectory = join(dirname(directory), "publications");
	for (const file of visiblePublishedFiles(directory, publicationsDirectory, "change_report")) {
		try {
			const report = parseChangeReport(join(directory, file));
			entries.push({
				file,
				format_version: report.format_version,
				subsystem: report.subsystem,
				generated_at: report.generated_at,
				baseline: report.baseline,
				current: report.current,
				summary: report.summary,
			});
		} catch {
			// An invalid report is withheld from the viewer; repository validation reports the exact fault.
		}
	}
	return entries.sort((a, b) => b.generated_at.localeCompare(a.generated_at) || a.file.localeCompare(b.file));
}

export function changeReportCatalog(directory: string): ChangeReportCatalog {
	return buildChangeReportCatalog(changeReportEntries(directory));
}

export function changeReportPublicationBinding(dataDir: string, report: Pick<ChangeReport, "current" | "subsystem">) {
	const state = loadDataPublicationState(join(dataDir, "publications"));
	const generation = currentPublishedGeneration(join(dataDir, "publications"), report.subsystem);
	return {
		format_version: "graphbrain-publication-binding/1" as const,
		publication_revision: state.revision,
		active_snapshot_id: generation?.id ?? null,
		current_snapshot_is_active_publication: generation?.graph.file === report.current.file,
	};
}

export const handleChangeReports: ApiHandler = ({ req, res, url, dataDir }) => {
	if (url !== "/api/change-reports" && !url.startsWith("/api/change-reports/")) return false;
	if (req.method !== "GET") {
		methodNotAllowed(res);
		return true;
	}
	const directory = join(dataDir, "changes");
	if (url === "/api/change-reports") {
		const catalog = changeReportCatalog(directory);
		sendJson(res, 200, {
			...catalog,
			reports: catalog.reports.map((report) => ({
				...report,
				publication_binding: changeReportPublicationBinding(dataDir, report),
			})),
		});
		return true;
	}
	const file = url.slice("/api/change-reports/".length);
	if (!file.endsWith(".change.json") || basename(file) !== file) {
		sendJson(res, 404, { error: "变化报告不存在", code: "CHANGE_REPORT_NOT_FOUND" });
		return true;
	}
	const target = resolve(directory, file);
	let targetIsFile = false;
	try {
		targetIsFile = existsSync(target) && statSync(target).isFile();
	} catch {
		// exists 与 stat 之间存在删除窗口；报告文件消失按不存在处理。
		targetIsFile = false;
	}
	if (!isPublishedArtifactVisible(file, join(dataDir, "publications"), "change_report")
		|| !isPathWithin(directory, target) || !targetIsFile || !isExistingPathWithin(directory, target)) {
		sendJson(res, 404, { error: "变化报告不存在", code: "CHANGE_REPORT_NOT_FOUND" });
		return true;
	}
	try {
		const report = parseChangeReport(target);
		sendJson(res, 200, { ...report, publication_binding: changeReportPublicationBinding(dataDir, report) });
	} catch {
		sendJson(res, 422, { error: "变化报告无效；请运行 npm run validate 查看诊断" });
	}
	return true;
};

export const changeHandlers: ApiHandler[] = [handleChangeReports];
