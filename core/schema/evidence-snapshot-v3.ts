// Versioned v3 project/engine evidence snapshots and the deterministic v2 split boundary.
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import type { GraphEdge, GraphFile, GraphNode } from "../../adapters/adapter-interface.js";
import {
	extractorNodeEvidence,
	extractorRelationEvidence,
	type ExtractedFactEvidence,
} from "../evidence/extractor-registry.js";
import type { ExtractionCoverage, SourceProvenance } from "./graph-version.js";

export const EVIDENCE_SNAPSHOT_FORMAT_VERSION = 3 as const;
export const EVIDENCE_STABLE_ID_SCHEME = "ue5-code-symbol-id/1" as const;
export const PROJECT_EVIDENCE_KIND = "graphbrain-project-evidence" as const;
export const ENGINE_EVIDENCE_KIND = "graphbrain-engine-evidence" as const;
export const ENGINE_IDENTITY_FORMAT = "graphbrain-engine-identity/1" as const;

export interface EvidenceSourceArtifact {
	file: string;
	sha256: string;
	generation_id: string;
}

export interface EngineIdentityV1 {
	format_version: typeof ENGINE_IDENTITY_FORMAT;
	status: "verified" | "unverified";
	engine_association: string | null;
	root_identity: { algorithm: "sha256-normalized-engine-root-v1"; value: string } | null;
	header_fingerprint: { algorithm: "sha256-relative-path-content-hash-v1"; value: string; file_count: number } | null;
}

export interface EngineCacheEvidence {
	engine_root: string | null;
	engine_classes: Record<string, { header: string; hash: string } | null>;
}

type EvidenceNode = GraphNode & { data: GraphNode["data"] & { evidence: ExtractedFactEvidence } };
type EvidenceEdge = GraphEdge & { data: GraphEdge["data"] & { evidence: ExtractedFactEvidence } };

export interface ProjectEvidenceSnapshotV3 {
	format_version: typeof EVIDENCE_SNAPSHOT_FORMAT_VERSION;
	kind: typeof PROJECT_EVIDENCE_KIND;
	domain: "ue5_code";
	subsystem: "project";
	stable_id_scheme: typeof EVIDENCE_STABLE_ID_SCHEME;
	generated_at: string | null;
	generator: string | null;
	source_v2: EvidenceSourceArtifact;
	provenance: SourceProvenance | null;
	coverage: ExtractionCoverage | null;
	engine_dependency: {
		identity: EngineIdentityV1;
		reference_set_hash: string;
	};
	facts: { nodes: EvidenceNode[]; relations: EvidenceEdge[] };
	external_references: {
		symbols: Array<{ stable_id: string; target: "engine" }>;
		relations: EvidenceEdge[];
	};
	diagnostics: Array<{ code: string; stable_id?: string }>;
}

export interface EngineEvidenceSnapshotV3 {
	format_version: typeof EVIDENCE_SNAPSHOT_FORMAT_VERSION;
	kind: typeof ENGINE_EVIDENCE_KIND;
	domain: "ue5_code";
	subsystem: "engine";
	stable_id_scheme: typeof EVIDENCE_STABLE_ID_SCHEME;
	generated_at: string | null;
	generator: string | null;
	source_v2: EvidenceSourceArtifact;
	identity: EngineIdentityV1;
	facts: { nodes: EvidenceNode[]; relations: EvidenceEdge[] };
	diagnostics: Array<{ code: string; path?: string }>;
}

export interface EvidenceSnapshotPairV3 {
	project: ProjectEvidenceSnapshotV3;
	engine: EngineEvidenceSnapshotV3;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function normalizedPath(path: string): string {
	return path.replaceAll("\\", "/");
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

export function engineIdentityFromCache(cache: EngineCacheEvidence | null, engineAssociation: string | null = null): EngineIdentityV1 {
	if (!cache?.engine_root) {
		return {
			format_version: ENGINE_IDENTITY_FORMAT,
			status: "unverified",
			engine_association: engineAssociation,
			root_identity: null,
			header_fingerprint: null,
		};
	}
	const root = normalizedPath(resolve(cache.engine_root));
	const headers = new Map<string, string>();
	for (const value of Object.values(cache.engine_classes)) {
		if (!value) continue;
		const absolute = normalizedPath(resolve(value.header));
		const rel = normalizedPath(relative(root, absolute));
		// 跨盘符（Windows）时 win32.relative 返回绝对路径（D:/x/y.h），不带 "../" 前缀；
		// 必须一并排除，否则机器相关的绝对路径会进入"身份"指纹。
		if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) continue;
		headers.set(rel, value.hash);
	}
	const ordered = [...headers].sort(([left], [right]) => left.localeCompare(right));
	return {
		format_version: ENGINE_IDENTITY_FORMAT,
		status: ordered.length > 0 ? "verified" : "unverified",
		engine_association: engineAssociation,
		// toLowerCase 与运行时 locale 无关：toLocaleLowerCase 在 tr/az locale 下把 I 映射
		// 成无点 ı，同一引擎根会哈希出不同身份，破坏跨机可比性。
		root_identity: { algorithm: "sha256-normalized-engine-root-v1", value: sha256(root.toLowerCase()) },
		header_fingerprint: ordered.length > 0 ? {
			algorithm: "sha256-relative-path-content-hash-v1",
			value: sha256(ordered.map(([path, hash]) => `${path}\0${hash}`).join("\n")),
			file_count: ordered.length,
		} : null,
	};
}

function withNodeEvidence(node: GraphNode, generator: string | null): EvidenceNode {
	const sourcePath = stringValue(node.data.source_path)?.replaceAll("\\", "/") ?? null;
	return {
		...structuredClone(node),
		data: { ...structuredClone(node.data), evidence: extractorNodeEvidence(generator, sourcePath) },
	};
}

function withRelationEvidence(edge: GraphEdge, nodes: ReadonlyMap<string, GraphNode>, generator: string | null): EvidenceEdge {
	const sourcePath = stringValue(nodes.get(edge.data.source)?.data.source_path)?.replaceAll("\\", "/") ?? null;
	return {
		...structuredClone(edge),
		data: { ...structuredClone(edge.data), evidence: extractorRelationEvidence(generator, edge.data.relation, sourcePath) },
	};
}

function factLayer(node: GraphNode): "project" | "engine" | null {
	return node.data.layer === "project" || node.data.layer === "engine" ? node.data.layer : null;
}

export function migrateV2GraphToEvidenceV3(input: {
	graph: GraphFile;
	source: EvidenceSourceArtifact;
	engineCache?: EngineCacheEvidence | null;
	engineAssociation?: string | null;
}): EvidenceSnapshotPairV3 {
	if (input.graph.meta.domain !== "ue5_code" || input.graph.meta.format_version !== 2) {
		throw new Error("v3 evidence migration requires a fully validated ue5_code graph v2 input");
	}
	const generator = stringValue(input.graph.meta.generator);
	const nodes = new Map(input.graph.elements.nodes.map((node) => [node.data.id, node]));
	const projectNodes = input.graph.elements.nodes.filter((node) => factLayer(node) === "project");
	const engineNodes = input.graph.elements.nodes.filter((node) => factLayer(node) === "engine");
	const unownedNodes = input.graph.elements.nodes.filter((node) => factLayer(node) === null);
	const projectIds = new Set(projectNodes.map((node) => node.data.id));
	const engineIds = new Set(engineNodes.map((node) => node.data.id));
	const projectRelations: EvidenceEdge[] = [];
	const engineRelations: EvidenceEdge[] = [];
	const externalRelations: EvidenceEdge[] = [];
	const diagnostics: ProjectEvidenceSnapshotV3["diagnostics"] = unownedNodes.map((node) => ({ code: "v2-node-layer-unowned", stable_id: node.data.id }));

	for (const edge of input.graph.elements.edges) {
		const evidenceEdge = withRelationEvidence(edge, nodes, generator);
		if (projectIds.has(edge.data.source) && projectIds.has(edge.data.target)) projectRelations.push(evidenceEdge);
		else if (engineIds.has(edge.data.source) && engineIds.has(edge.data.target)) engineRelations.push(evidenceEdge);
		else if (projectIds.has(edge.data.source) && engineIds.has(edge.data.target)) externalRelations.push(evidenceEdge);
		else diagnostics.push({ code: "v2-relation-layer-unresolved", stable_id: edge.data.id });
	}

	const identity = engineIdentityFromCache(input.engineCache ?? null, input.engineAssociation ?? null);
	const externalIds = [...new Set(externalRelations.map((edge) => edge.data.target))].sort();
	const provenance = input.graph.meta.provenance as SourceProvenance | undefined;
	const coverage = input.graph.meta.coverage as ExtractionCoverage | undefined;
	const generatedAt = stringValue(input.graph.meta.generated_at);
	const project: ProjectEvidenceSnapshotV3 = {
		format_version: EVIDENCE_SNAPSHOT_FORMAT_VERSION,
		kind: PROJECT_EVIDENCE_KIND,
		domain: "ue5_code",
		subsystem: "project",
		stable_id_scheme: EVIDENCE_STABLE_ID_SCHEME,
		generated_at: generatedAt,
		generator,
		source_v2: structuredClone(input.source),
		provenance: provenance ? structuredClone(provenance) : null,
		coverage: coverage ? structuredClone(coverage) : null,
		engine_dependency: { identity, reference_set_hash: sha256(externalIds.join("\n")) },
		facts: {
			nodes: projectNodes.map((node) => withNodeEvidence(node, generator)),
			relations: projectRelations,
		},
		external_references: {
			symbols: externalIds.map((stableId) => ({ stable_id: stableId, target: "engine" as const })),
			relations: externalRelations,
		},
		diagnostics,
	};
	const engine: EngineEvidenceSnapshotV3 = {
		format_version: EVIDENCE_SNAPSHOT_FORMAT_VERSION,
		kind: ENGINE_EVIDENCE_KIND,
		domain: "ue5_code",
		subsystem: "engine",
		stable_id_scheme: EVIDENCE_STABLE_ID_SCHEME,
		generated_at: generatedAt,
		generator,
		source_v2: structuredClone(input.source),
		identity,
		facts: {
			nodes: engineNodes.map((node) => withNodeEvidence(node, generator)),
			relations: engineRelations,
		},
		diagnostics: identity.status === "verified" ? [] : [{ code: "engine-identity-unverified" }],
	};
	const errors = validateEvidenceSnapshotPairV3({ project, engine });
	if (errors.length > 0) throw new Error(`invalid migrated evidence v3: ${errors.join("; ")}`);
	return { project, engine };
}

function evidenceErrors(value: unknown, label: string): string[] {
	if (!value || typeof value !== "object") return [`${label} evidence is missing`];
	const item = value as Partial<ExtractedFactEvidence>;
	const errors: string[] = [];
	if (!new Set(["direct", "heuristic", "unknown"]).has(String(item.classification))) errors.push(`${label} evidence classification is invalid`);
	if (item.confidence !== null && (typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1)) errors.push(`${label} evidence confidence is invalid`);
	if (typeof item.capability !== "string") errors.push(`${label} evidence capability is invalid`);
	return errors;
}

export function validateEvidenceSnapshotPairV3(pair: EvidenceSnapshotPairV3): string[] {
	const errors: string[] = [];
	if (pair.project.format_version !== 3 || pair.project.kind !== PROJECT_EVIDENCE_KIND) errors.push("project snapshot format is invalid");
	if (pair.engine.format_version !== 3 || pair.engine.kind !== ENGINE_EVIDENCE_KIND) errors.push("engine snapshot format is invalid");
	if (pair.project.source_v2.generation_id !== pair.engine.source_v2.generation_id
		|| pair.project.source_v2.sha256 !== pair.engine.source_v2.sha256) errors.push("project and engine snapshots do not share one v2 source identity");
	if (JSON.stringify(pair.project.engine_dependency.identity) !== JSON.stringify(pair.engine.identity)) errors.push("engine dependency identity does not match engine owner identity");

	const projectIds = new Set<string>();
	const engineIds = new Set<string>();
	for (const node of pair.project.facts.nodes) {
		if (node.data.layer !== "project") errors.push(`project snapshot owns non-project node: ${node.data.id}`);
		if (projectIds.has(node.data.id)) errors.push(`duplicate project stable id: ${node.data.id}`);
		projectIds.add(node.data.id);
		errors.push(...evidenceErrors(node.data.evidence, `node ${node.data.id}`));
	}
	for (const node of pair.engine.facts.nodes) {
		if (node.data.layer !== "engine") errors.push(`engine snapshot owns non-engine node: ${node.data.id}`);
		if (engineIds.has(node.data.id)) errors.push(`duplicate engine stable id: ${node.data.id}`);
		engineIds.add(node.data.id);
		if (projectIds.has(node.data.id)) errors.push(`stable id has two owners: ${node.data.id}`);
		errors.push(...evidenceErrors(node.data.evidence, `node ${node.data.id}`));
	}
	const validateRelations = (relations: EvidenceEdge[], sourceIds: Set<string>, targetIds: Set<string>, label: string) => {
		for (const edge of relations) {
			if (!sourceIds.has(edge.data.source) || !targetIds.has(edge.data.target)) errors.push(`${label} relation does not resolve: ${edge.data.id}`);
			errors.push(...evidenceErrors(edge.data.evidence, `relation ${edge.data.id}`));
		}
	};
	validateRelations(pair.project.facts.relations, projectIds, projectIds, "project");
	validateRelations(pair.engine.facts.relations, engineIds, engineIds, "engine");
	validateRelations(pair.project.external_references.relations, projectIds, engineIds, "external");
	const externalIds = [...new Set(pair.project.external_references.relations.map((edge) => edge.data.target))].sort();
	const declaredIds = pair.project.external_references.symbols.map((item) => item.stable_id).sort();
	if (JSON.stringify(externalIds) !== JSON.stringify(declaredIds)) errors.push("external symbol reference set does not match external relations");
	if (pair.project.engine_dependency.reference_set_hash !== sha256(externalIds.join("\n"))) errors.push("external reference set hash mismatch");
	return errors;
}

/** Join 后的 evidence 运行时投影的名义类型（F5）。meta.format_version 是快照号
 *  （3），不被 graph-version/schema（当前 2）承认——这不是持久化 GraphFile：
 *  普通 GraphFile 缺 brand 且 format_version 不是 3，无法不经
 *  joinEvidenceSnapshotPairV3（唯一构造点）冒充本类型；反向把本类型当持久化图
 *  喂给通用图消费者（schema 校验/迁移/目录）是契约违规，见下方 join 的警告。 */
export const evidenceRuntimeGraphBrand: unique symbol = Symbol("graphbrain-evidence-runtime-graph");
export interface EvidenceRuntimeGraph {
	meta: GraphFile["meta"] & { format_version: typeof EVIDENCE_SNAPSHOT_FORMAT_VERSION };
	elements: { nodes: GraphNode[]; edges: GraphEdge[] };
	readonly [evidenceRuntimeGraphBrand]: true;
}

/** Join the validated pair into the runtime graph consumed by evidence queries.
 *  契约警告：这是 evidence 运行时投影，不是持久化图格式——meta.format_version 用的是
 *  快照格式号（3），未被 graph-version/schema（当前 const 2）承认。它只允许流入
 *  core/evidence/query 的查询路径，绝不可进入通用图消费者（schema 校验/迁移/目录），
 *  否则会在版本边界上以"未知格式"失败。 */
export function joinEvidenceSnapshotPairV3(pair: EvidenceSnapshotPairV3): EvidenceRuntimeGraph {
	const errors = validateEvidenceSnapshotPairV3(pair);
	if (errors.length > 0) throw new Error(`cannot join invalid evidence v3: ${errors.join("; ")}`);
	return {
		meta: {
			domain: "ue5_code",
			format_version: EVIDENCE_SNAPSHOT_FORMAT_VERSION,
			subsystem: "project",
			generated_at: pair.project.generated_at,
			generator: pair.project.generator,
			provenance: pair.project.provenance,
			coverage: pair.project.coverage,
			engine_identity: pair.engine.identity,
			source_v2: pair.project.source_v2,
		},
		elements: {
			nodes: [...structuredClone(pair.project.facts.nodes), ...structuredClone(pair.engine.facts.nodes)],
			edges: [
				...structuredClone(pair.project.facts.relations),
				...structuredClone(pair.engine.facts.relations),
				...structuredClone(pair.project.external_references.relations),
			],
		},
		[evidenceRuntimeGraphBrand]: true,
	};
}
