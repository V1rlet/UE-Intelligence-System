import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GraphFile } from "../adapters/adapter-interface.js";
import { buildChangeReport, checkChangeReportConsistency } from "../core/query/change-report.js";
import { checkChangeReportSchema, checkGraphReferences, checkGraphSchema, type GraphShape } from "../core/schema/graph-checks.js";
import {
	loadDataPublicationState,
	managedArtifactName,
	publicationDirectories,
	publishDataGeneration,
	sha256,
} from "../core/store/data-publication.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function option(name: string): string | null {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function load(path: string): GraphFile {
	return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as GraphFile;
}

const baselineArg = option("--baseline");
const currentArg = option("--current");
if (!baselineArg || !currentArg) {
	console.error("用法: npm run build:change-report -- --baseline <旧图> --current <新图> [--data-dir data]");
	process.exit(2);
}
const baselinePath = resolve(baselineArg);
const currentPath = resolve(currentArg);
const legacyOut = option("--out");
const dataDir = resolve(option("--data-dir") ?? (legacyOut ? dirname(resolve(legacyOut)) : `${ROOT}/data`));
if (legacyOut) console.warn("--out is a compatibility adapter; use --data-dir so graph/report publication shares one boundary");
const directories = publicationDirectories(dataDir);
const current = load(currentPath);
const subsystem = String(current.meta.subsystem ?? "unknown");
const graphErrors = [...checkGraphSchema(current), ...checkGraphReferences(current as unknown as GraphShape)];
if (graphErrors.length > 0) throw new Error(`current graph is invalid: ${graphErrors.join("; ")}`);
const graphContent = `${JSON.stringify(current, null, 2)}\n`;
const graphFile = managedArtifactName(subsystem, sha256(graphContent), "graph");
const report = buildChangeReport(load(baselinePath), current, {
	baselineFile: basename(baselinePath),
	currentFile: graphFile,
});
const reportErrors = [...checkChangeReportSchema(report), ...checkChangeReportConsistency(report)];
if (reportErrors.length > 0) throw new Error(`change report is invalid: ${reportErrors.join("; ")}`);
const state = loadDataPublicationState(directories.publications);
const published = publishDataGeneration({
	directories,
	subsystem,
	expectedRevision: state.revision,
	graphContent,
	changeReportContent: `${JSON.stringify(report, null, 2)}\n`,
});
console.log(`${resolve(directories.changes, published.generation.change_report!.file)}: 节点 +${report.summary.nodes.added} / -${report.summary.nodes.removed} / ~${report.summary.nodes.changed}；影响 ${report.summary.affected_nodes} 节点 / ${report.summary.affected_modules} 模块（publication revision ${published.state.revision}）`);
