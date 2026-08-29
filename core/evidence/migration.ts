import { readFileSync } from "node:fs";
import type { GraphFile } from "../../adapters/adapter-interface.js";
import type { ParseCache } from "../../adapters/ue5-code/parse-cache.js";
import { migrateV2GraphToEvidenceV3, type EvidenceSnapshotPairV3 } from "../schema/evidence-snapshot-v3.js";
import type { PublishedGeneration } from "../store/data-publication.js";

/** Reads the declared engine association only. Absence or invalid JSON remains explicitly unverified. */
export function readEngineAssociation(uprojectPath: string | null): string | null {
	if (!uprojectPath) return null;
	let value: unknown;
	try { value = JSON.parse(readFileSync(uprojectPath, "utf8").replace(/^\uFEFF/, "")); }
	catch { return null; }
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const association = (value as Record<string, unknown>).EngineAssociation;
	return typeof association === "string" && association.trim() ? association : null;
}

/** Deterministic v2 -> v3 normalization boundary. It never discovers or guesses product meaning. */
export function migratePublishedGraphToEvidenceV3(input: {
	graph: GraphFile;
	generation: PublishedGeneration;
	cache: ParseCache | null;
	engineAssociation: string | null;
}): EvidenceSnapshotPairV3 {
	return migrateV2GraphToEvidenceV3({
		graph: input.graph,
		source: {
			file: input.generation.graph.file,
			sha256: input.generation.graph.sha256,
			generation_id: input.generation.id,
		},
		engineCache: input.cache,
		engineAssociation: input.engineAssociation,
	});
}
