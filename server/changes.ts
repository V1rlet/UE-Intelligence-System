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
import { isPublishedArtifactVisible, visiblePublishedFiles } from "../core/store/data-publication.js";
import { type ApiHandler, isExistingPathWithin, isPathWithin, methodNotAllowed, sendJson } from "./http";

function parseChangeReport(path: string): ChangeReport {
	const report = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as ChangeReport;
	if (report.domain !== "ue5_code" || report.format_version !== 1) throw new Error("unsupported change report");
	const errors = [...checkChangeReportSchema(report), ...checkChangeReportConsistency(report)];
	if (errors.length > 0) throw new Error(`invalid change report: ${errors.join("; ")}`);
	return report;
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

export const handleChangeReports: ApiHandler = ({ req, res, url, dataDir }) => {
	if (url !== "/api/change-reports" && !url.startsWith("/api/change-reports/")) return false;
	if (req.method !== "GET") {
		methodNotAllowed(res);
		return true;
	}
	const directory = join(dataDir, "changes");
	if (url === "/api/change-reports") {
		sendJson(res, 200, changeReportCatalog(directory));
		return true;
	}
	const file = url.slice("/api/change-reports/".length);
	if (!file.endsWith(".change.json") || basename(file) !== file) {
		sendJson(res, 404, { error: "变化报告不存在" });
		return true;
	}
	const target = resolve(directory, file);
	if (!isPublishedArtifactVisible(file, join(dataDir, "publications"), "change_report")
		|| !isPathWithin(directory, target) || !existsSync(target) || !statSync(target).isFile() || !isExistingPathWithin(directory, target)) {
		sendJson(res, 404, { error: "变化报告不存在" });
		return true;
	}
	try {
		sendJson(res, 200, parseChangeReport(target));
	} catch {
		sendJson(res, 422, { error: "变化报告无效；请运行 npm run validate 查看诊断" });
	}
	return true;
};

export const changeHandlers: ApiHandler[] = [handleChangeReports];
