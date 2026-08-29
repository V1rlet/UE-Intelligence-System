// One read boundary for v3 evidence snapshots and the retained v2 compatibility path.
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { GraphFile } from "../../adapters/adapter-interface.js";
import { checkGraphReferences, checkGraphSchema, type GraphShape } from "../schema/graph-checks.js";
import { joinEvidenceSnapshotPairV3, type EngineIdentityV1, type EvidenceRuntimeGraph, type EvidenceSnapshotPairV3 } from "../schema/evidence-snapshot-v3.js";
import { loadDataPublicationState, sha256, type PublishedGeneration } from "../store/data-publication.js";
import {
	evidencePublicationStatePath,
	loadEvidencePublicationState,
	readActiveEvidenceSnapshotPair,
	type EvidencePublicationState,
	type EvidencePublishedGeneration,
} from "../store/evidence-publication.js";

export type EvidenceResolutionMode = "v3" | "v2-compatibility";

export interface ResolvedPublishedEvidence {
	mode: EvidenceResolutionMode;
	/** v3 模式是 evidence 运行时投影（非持久化图格式，见 EvidenceRuntimeGraph）；
	 *  v2 兼容模式是磁盘上的合法 GraphFile。查询消费方统一走 EvidenceQueryGraph。 */
	graph: GraphFile | EvidenceRuntimeGraph;
	snapshot_id: string;
	publication_revision: number;
	source_v2_generation: PublishedGeneration;
	data_publication_revision: number;
	engine_identity: EngineIdentityV1 | null;
	evidence_generation: EvidencePublishedGeneration | null;
	pair: EvidenceSnapshotPairV3 | null;
}

export class EvidenceResolutionError extends Error {
	constructor(readonly code: string, message = code) {
		super(message);
	}
}

export function findV2EvidenceGeneration(dataDir: string, id: string | null = null): { generation: PublishedGeneration; revision: number } {
	const state = loadDataPublicationState(join(dataDir, "publications"));
	const project = state.publications.find((item) => item.subsystem === "project");
	const generation = id ? project?.generations.find((item) => item.id === id) : project?.generations[0];
	if (!generation) throw new EvidenceResolutionError("EVIDENCE_SNAPSHOT_UNAVAILABLE");
	return { generation, revision: state.revision };
}

export function readV2EvidenceGraph(dataDir: string, generation: PublishedGeneration): GraphFile {
	const file = generation.graph.file;
	if (basename(file) !== file) throw new EvidenceResolutionError("EVIDENCE_SNAPSHOT_INVALID");
	const path = join(dataDir, "graphs", file);
	if (!existsSync(path)) throw new EvidenceResolutionError("EVIDENCE_SNAPSHOT_UNAVAILABLE");
	const content = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
	if (sha256(content) !== generation.graph.sha256) throw new EvidenceResolutionError("EVIDENCE_SNAPSHOT_HASH_MISMATCH");
	let value: unknown;
	try { value = JSON.parse(content); } catch { throw new EvidenceResolutionError("EVIDENCE_SNAPSHOT_INVALID"); }
	if (checkGraphSchema(value).length > 0 || checkGraphReferences(value as GraphShape).length > 0) {
		throw new EvidenceResolutionError("EVIDENCE_SNAPSHOT_INVALID");
	}
	return value as GraphFile;
}

function verifyV3Source(generation: PublishedGeneration, evidence: EvidencePublishedGeneration, pair: EvidenceSnapshotPairV3): void {
	if (generation.id !== evidence.source_v2_generation_id
		|| pair.project.source_v2.generation_id !== generation.id
		|| pair.project.source_v2.file !== generation.graph.file
		|| pair.project.source_v2.sha256 !== generation.graph.sha256) {
		throw new EvidenceResolutionError("EVIDENCE_V3_SOURCE_MISMATCH");
	}
}

export function resolvePublishedEvidence(dataDir: string): ResolvedPublishedEvidence {
	const hasEvidencePublication = existsSync(evidencePublicationStatePath(dataDir));
	let state: EvidencePublicationState;
	try { state = loadEvidencePublicationState(dataDir); }
	catch { throw new EvidenceResolutionError("EVIDENCE_PUBLICATION_INVALID"); }
	if (state.active.mode === "v3") {
		let active;
		try { active = readActiveEvidenceSnapshotPair(dataDir); }
		catch { throw new EvidenceResolutionError("EVIDENCE_V3_SNAPSHOT_INVALID"); }
		if (!active) throw new EvidenceResolutionError("EVIDENCE_V3_SNAPSHOT_UNAVAILABLE");
		const source = findV2EvidenceGeneration(dataDir, active.generation.source_v2_generation_id);
		verifyV3Source(source.generation, active.generation, active.pair);
		return {
			mode: "v3",
			graph: joinEvidenceSnapshotPairV3(active.pair),
			snapshot_id: active.generation.id,
			publication_revision: active.state.revision,
			source_v2_generation: source.generation,
			data_publication_revision: source.revision,
			engine_identity: active.pair.engine.identity,
			evidence_generation: active.generation,
			pair: active.pair,
		};
	}
	const source = findV2EvidenceGeneration(dataDir, hasEvidencePublication ? state.compatibility_v2_generation_id : null);
	return {
		mode: "v2-compatibility",
		graph: readV2EvidenceGraph(dataDir, source.generation),
		snapshot_id: source.generation.id,
		publication_revision: hasEvidencePublication ? state.revision : source.revision,
		source_v2_generation: source.generation,
		data_publication_revision: source.revision,
		engine_identity: null,
		evidence_generation: null,
		pair: null,
	};
}
