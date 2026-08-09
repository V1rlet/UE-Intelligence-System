// Browser-safe validation functions for the only active persisted model: ue5_code + annotations.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { checkUeClassName } from "./ue-naming.js";
import type { ExtractionCoverage, SourceProvenance } from "./graph-version.js";
import { resolveGraphBrainProjectRoot } from "../source/project-root.js";

const schemaDir = join(resolveGraphBrainProjectRoot(import.meta.url, "..", ".."), "core", "schema");
const loadSchema = (name: string): object => JSON.parse(readFileSync(join(schemaDir, name), "utf8"));
let validators: { graph: ValidateFunction; annotation: ValidateFunction; readingContext: ValidateFunction; changeReport: ValidateFunction } | null = null;

function getValidators() {
	if (!validators) {
		const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
		(addFormats.default ?? (addFormats as unknown as (instance: Ajv) => void))(ajv);
		ajv.addSchema(loadSchema("node.schema.json"));
		ajv.addSchema(loadSchema("edge.schema.json"));
		validators = {
			graph: ajv.compile(loadSchema("graph.schema.json")),
			annotation: ajv.compile(loadSchema("annotation.schema.json")),
			readingContext: ajv.compile(loadSchema("reading-context.schema.json")),
			changeReport: ajv.compile(loadSchema("change-report.schema.json")),
		};
	}
	return validators;
}

export interface GraphShape {
	meta: {
		domain: "ue5_code";
		subsystem?: string;
		format_version: number;
		provenance?: SourceProvenance;
		coverage?: ExtractionCoverage;
		[key: string]: unknown;
	};
	elements: {
		nodes: { data: { id: string; parent?: string; type?: string; domain?: string; [key: string]: unknown } }[];
		edges: { data: { id: string; source: string; target: string; relation?: string; domain?: string; [key: string]: unknown } }[];
	};
}

export interface AnnotationShape {
	node_id: string;
	domain: "ue5_code";
	annotations: unknown[];
}

export interface ReadingContextShape {
	format_version: 1;
	domain: "ue5_code";
	revision: number;
	annotations: Array<{ subsystem: string; node_id: string; annotations: unknown[] }>;
	favorites: unknown[];
}

export interface ChangeReportShape {
	format_version: 1;
	domain: "ue5_code";
	subsystem: string;
	baseline: { file: string; fingerprint: string | null };
	current: { file: string; fingerprint: string | null };
}

function schemaErrors(validate: ValidateFunction, content: unknown): string[] {
	if (validate(content)) return [];
	return (validate.errors ?? []).map((error) => `${error.instancePath || "(root)"} ${error.message ?? ""}`);
}

export function checkGraphSchema(content: unknown): string[] {
	return schemaErrors(getValidators().graph, content);
}

export function checkAnnotationSchema(content: unknown): string[] {
	return schemaErrors(getValidators().annotation, content);
}

export function checkReadingContextSchema(content: unknown): string[] {
	return schemaErrors(getValidators().readingContext, content);
}

export function checkChangeReportSchema(content: unknown): string[] {
	return schemaErrors(getValidators().changeReport, content);
}

/** IDs and relations have one owner inside a graph; all references must resolve deterministically. */
export function checkGraphReferences(graph: GraphShape): string[] {
	const errors: string[] = [];
	const nodeIds = new Set<string>();
	const parentById = new Map<string, string>();
	for (const node of graph.elements.nodes) {
		if (nodeIds.has(node.data.id)) errors.push(`重复的节点 id: ${node.data.id}`);
		nodeIds.add(node.data.id);
		if (node.data.parent) parentById.set(node.data.id, node.data.parent);
		if (node.data.type) {
			const namingError = checkUeClassName(node.data.id, node.data.type);
			if (namingError) errors.push(namingError);
		}
	}
	for (const [id, parent] of parentById) if (!nodeIds.has(parent)) errors.push(`节点 ${id} 的 parent 不存在: ${parent}`);

	const edgeIds = new Set<string>();
	for (const edge of graph.elements.edges) {
		if (edgeIds.has(edge.data.id)) errors.push(`重复的边 id: ${edge.data.id}`);
		edgeIds.add(edge.data.id);
		if (nodeIds.has(edge.data.id)) errors.push(`节点与边 id 冲突: ${edge.data.id}`);
		if (!nodeIds.has(edge.data.source)) errors.push(`边 ${edge.data.id} 的 source 不存在: ${edge.data.source}`);
		if (!nodeIds.has(edge.data.target)) errors.push(`边 ${edge.data.id} 的 target 不存在: ${edge.data.target}`);
	}

	const complete = new Set<string>();
	for (const start of parentById.keys()) {
		if (complete.has(start)) continue;
		const trail: string[] = [];
		const at = new Map<string, number>();
		let current: string | undefined = start;
		while (current && parentById.has(current) && !complete.has(current)) {
			const cycle = at.get(current);
			if (cycle !== undefined) {
				errors.push(`parent 形成循环: ${[...trail.slice(cycle), current].join(" -> ")}`);
				break;
			}
			at.set(current, trail.length);
			trail.push(current);
			current = parentById.get(current);
		}
		for (const id of trail) complete.add(id);
	}
	return errors;
}

export function checkAnnotationReferences(entries: AnnotationShape[], graph: GraphShape): string[] {
	const ids = new Set(graph.elements.nodes.map((node) => node.data.id));
	return entries.filter((entry) => !ids.has(entry.node_id)).map((entry) => `标注节点不存在: ${entry.node_id}`);
}
