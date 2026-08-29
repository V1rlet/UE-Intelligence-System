import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultCachePath, loadParseCache } from "../adapters/ue5-code/parse-cache.js";
import { migratePublishedGraphToEvidenceV3, readEngineAssociation } from "../core/evidence/migration.js";
import { findV2EvidenceGeneration, readV2EvidenceGraph, resolvePublishedEvidence } from "../core/evidence/resolver.js";
import {
	loadEvidencePublicationState,
	publishEvidenceSnapshotPair,
	setEvidencePublicationMode,
} from "../core/store/evidence-publication.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "data");
const argv = process.argv.slice(2);
const command = argv[0] ?? "status";

function option(name: string): string | null {
	const index = argv.indexOf(name);
	return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

function expectedRevision(): number {
	const state = loadEvidencePublicationState(DATA_DIR);
	const raw = option("--expected-revision");
	if (raw === null) return state.revision;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 0) throw new Error("--expected-revision must be a non-negative integer");
	return value;
}

if (command === "status") {
	const publication = loadEvidencePublicationState(DATA_DIR);
	let resolution: ReturnType<typeof resolvePublishedEvidence> | null = null;
	let error: string | null = null;
	try { resolution = resolvePublishedEvidence(DATA_DIR); } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
	console.log(JSON.stringify({ publication, resolution: resolution ? {
		mode: resolution.mode,
		snapshot_id: resolution.snapshot_id,
		source_v2_generation_id: resolution.source_v2_generation.id,
		engine_identity: resolution.engine_identity,
	} : null, error }, null, 2));
} else if (command === "migrate") {
	const source = findV2EvidenceGeneration(DATA_DIR, option("--generation"));
	const graph = readV2EvidenceGraph(DATA_DIR, source.generation);
	const cache = loadParseCache(resolve(option("--cache") ?? defaultCachePath("project")));
	const pair = migratePublishedGraphToEvidenceV3({
		graph,
		generation: source.generation,
		cache,
		engineAssociation: readEngineAssociation(option("--uproject")),
	});
	const result = publishEvidenceSnapshotPair({
		dataDir: DATA_DIR,
		pair,
		expectedRevision: expectedRevision(),
		compatibilityV2GenerationId: source.generation.id,
	});
	console.log(JSON.stringify({ state: result.state, generation: result.generation }, null, 2));
} else if (command === "rollback-v2") {
	const state = setEvidencePublicationMode({ dataDir: DATA_DIR, expectedRevision: expectedRevision(), mode: "v2-compatibility" });
	console.log(JSON.stringify(state, null, 2));
} else if (command === "activate-v3") {
	const state = setEvidencePublicationMode({
		dataDir: DATA_DIR,
		expectedRevision: expectedRevision(),
		mode: "v3",
		generationId: option("--generation") ?? undefined,
	});
	console.log(JSON.stringify(state, null, 2));
} else {
	console.error("usage: npm run evidence:snapshot -- <status|migrate|rollback-v2|activate-v3> [--expected-revision N] [--generation ID] [--cache PATH] [--uproject PATH]");
	process.exitCode = 2;
}
