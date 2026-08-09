// Validate active ue5_code graphs and canonical reading-context. Archives are intentionally excluded.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
	checkAnnotationReferences,
	checkAnnotationSchema,
	checkChangeReportSchema,
	checkGraphReferences,
	checkGraphSchema,
	checkReadingContextSchema,
	type AnnotationShape,
	type ChangeReportShape,
	type GraphShape,
	type ReadingContextShape,
} from "./graph-checks.js";
import { checkChangeReportConsistency, type ChangeReport } from "../query/change-report.js";
import {
	publicationDirectories,
	validatePublishedArtifacts,
	visiblePublishedFiles,
} from "../store/data-publication.js";

type Kind = "graph" | "annotation" | "reading_context" | "change_report";

function detectKind(path: string, content: unknown): Kind {
	if (basename(path).endsWith(".change.json")) return "change_report";
	if (basename(path).endsWith(".cyto.json")) return "graph";
	if (basename(path) === "ue5_code.json" && !Array.isArray(content)) return "reading_context";
	if (basename(path).endsWith("_annotations.json") || Array.isArray(content)) return "annotation";
	throw new Error(`无法判定活动文件类型: ${path}`);
}

function parse(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function collectDefaultFiles(): string[] {
	const directories = publicationDirectories(resolve("data"));
	const graphs = visiblePublishedFiles(directories.graphs, directories.publications, "graph")
		.map((name) => join(directories.graphs, name));
	const changes = visiblePublishedFiles(directories.changes, directories.publications, "change_report")
		.map((name) => join(directories.changes, name));
	const readingDirectory = resolve("data/reading-context");
	const reading = existsSync(readingDirectory)
		? readdirSync(readingDirectory).filter((name) => name === "ue5_code.json").map((name) => join(readingDirectory, name))
		: [];
	return [...graphs, ...changes, ...reading].sort();
}

const requested = process.argv.slice(2);
const fullRepository = requested.length === 0;
const targets = fullRepository ? collectDefaultFiles() : requested;
if (targets.length === 0) {
	console.error("未找到活动 ue5_code 图或 reading-context 文件");
	process.exit(2);
}

let ok = true;
if (fullRepository) {
	const publicationErrors = validatePublishedArtifacts(publicationDirectories(resolve("data")));
	if (publicationErrors.length > 0) {
		ok = false;
		console.error("✗ data/publications/ue5_code.json [publication_state]");
		for (const error of publicationErrors) console.error(`  - ${error}`);
	} else if (existsSync(resolve("data/publications/ue5_code.json"))) {
		console.log("✓ data/publications/ue5_code.json [publication_state]");
	}
}
const graphsBySubsystem = new Map<string, GraphShape[]>();
const graphsByFile = new Map<string, GraphShape>();
const changeReports: Array<{ path: string; report: ChangeReportShape }> = [];
for (const path of targets) {
	try {
		const content = parse(path);
		const kind = detectKind(path, content);
		const schemaErrors = kind === "graph"
			? checkGraphSchema(content)
			: kind === "reading_context"
				? checkReadingContextSchema(content)
				: kind === "change_report"
					? checkChangeReportSchema(content)
					: checkAnnotationSchema(content);
		const errors = kind === "graph" && schemaErrors.length === 0
			? checkGraphReferences(content as GraphShape)
			: kind === "change_report" && schemaErrors.length === 0
				? checkChangeReportConsistency(content as ChangeReport)
				: schemaErrors;
		if (errors.length) {
			ok = false;
			console.error(`✗ ${path} [${kind}]`);
			for (const error of errors) console.error(`  - ${error}`);
		} else {
			console.log(`✓ ${path} [${kind}]`);
			if (kind === "graph") {
				const graph = content as GraphShape;
				const subsystem = String(graph.meta.subsystem ?? "");
				graphsBySubsystem.set(subsystem, [...(graphsBySubsystem.get(subsystem) ?? []), graph]);
				graphsByFile.set(basename(path), graph);
			}
			if (kind === "change_report") changeReports.push({ path, report: content as ChangeReportShape });
		}
	} catch (error) {
		ok = false;
		console.error(`✗ ${path}\n  ${(error as Error).message}`);
	}
}

if (fullRepository && ok) {
	for (const { path, report } of changeReports) {
		const current = graphsByFile.get(report.current.file);
		const errors: string[] = [];
		if (!current) errors.push(`当前快照不在活动图目录中: ${report.current.file}`);
		else {
			const graphFingerprint = current.meta.provenance?.fingerprint?.value ?? null;
			if (report.current.fingerprint !== graphFingerprint) {
				errors.push(`当前快照指纹不一致: report=${report.current.fingerprint ?? "null"}, graph=${graphFingerprint ?? "null"}`);
			}
			if (String(current.meta.subsystem ?? "") !== report.subsystem) {
				errors.push(`当前快照 subsystem 不一致: report=${report.subsystem}, graph=${String(current.meta.subsystem ?? "")}`);
			}
		}
		if (errors.length) {
			ok = false;
			console.error(`✗ ${path} [change_report_references]`);
			for (const error of errors) console.error(`  - ${error}`);
		} else console.log(`✓ ${path} [change_report_references]`);
	}

	for (const path of targets.filter((item) => basename(item) === "ue5_code.json")) {
		const context = parse(path) as ReadingContextShape;
		for (const subsystem of [...new Set(context.annotations.map((entry) => entry.subsystem))].sort()) {
		const graphs = graphsBySubsystem.get(subsystem) ?? [];
		if (graphs.length === 0) {
			ok = false;
			console.error(`✗ ${path} [annotation_references:${subsystem}]\n  - 没有 ue5_code/${subsystem} 图；应迁入孤立标注归档`);
			continue;
		}
		const merged: GraphShape = { ...graphs[0], elements: { nodes: graphs.flatMap((graph) => graph.elements.nodes), edges: graphs.flatMap((graph) => graph.elements.edges) } };
		const entries: AnnotationShape[] = context.annotations
			.filter((entry) => entry.subsystem === subsystem)
			.map((entry) => ({ node_id: entry.node_id, domain: context.domain, annotations: entry.annotations }));
		const errors = checkAnnotationReferences(entries, merged);
		if (errors.length) {
			ok = false;
			console.error(`✗ ${path} [annotation_references:${subsystem}]`);
			for (const error of errors) console.error(`  - ${error}`);
		} else console.log(`✓ ${path} [annotation_references:${subsystem}]`);
		}
	}
}

process.exit(ok ? 0 : 1);
