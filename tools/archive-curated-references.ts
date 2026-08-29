import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePublishedEvidence } from "../core/evidence/resolver.js";
import { loadEngineClassDiskCache, resolveEngineRoot } from "../adapters/ue5-code/engine-class-service.js";
import { resolveCachedEpicApiSymbols } from "../adapters/ue5-code/epic-api-sync.js";
import {
	curatedReferenceArchiveManifestPath,
	CURATED_REFERENCE_ARCHIVE_FORMAT,
	type CuratedReferenceArchiveManifest,
} from "../core/store/curated-reference-archive.js";
import { loadReadingContext, mutateReadingContext, readingContextFilePath } from "../core/reading-context/store.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "data");
const GRAPH_DIR = join(DATA_DIR, "graphs");
const ARCHIVE_DIR = join(DATA_DIR, "archive", "curated-references-v1");
const REVIEW_PATH = join(ARCHIVE_DIR, "annotation-review.md");
const FILES = [
	"ue5_code_architecture-mindmap_2026-07-19.cyto.json",
	"ue5_code_classes_2026-07-02.cyto.json",
	"ue5_code_framework-reference_2026-07-11.cyto.json",
	"ue5_code_gameplay-framework-reference_2026-07-12.cyto.json",
	"ue5_code_lifecycle-dependencies-reference_2026-07-12.cyto.json",
	"ue5_code_lyra-architecture-reference_2026-07-12.cyto.json",
	"ue5_code_network-scope-reference_2026-07-12.cyto.json",
] as const;

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function relative(path: string): string {
	const normalized = resolve(path);
	if (!normalized.startsWith(`${ROOT}\\`) && normalized !== ROOT) throw new Error(`path escapes GraphBrain root: ${path}`);
	return normalized.slice(ROOT.length + 1).replaceAll("\\", "/");
}

function subsystem(path: string): string {
	const value = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as { meta?: { subsystem?: unknown } };
	if (typeof value.meta?.subsystem !== "string") throw new Error(`archived graph has no subsystem: ${basename(path)}`);
	return value.meta.subsystem;
}

function reviewMarkdown(context: ReturnType<typeof loadReadingContext>): string {
	const lines = [
		"# Curated reference annotation review",
		"",
		"> Status: archived, awaiting explicit semantic-owner review. Nothing in this document has been written to CGS specifications.",
		"",
		`Source: \`data/reading-context/ue5_code.json\` revision ${context.revision}.`,
		"",
	];
	for (const entry of context.annotations) {
		for (const annotation of entry.annotations) {
			lines.push(`## ${annotation.id}`, "", `- Legacy subsystem: \`${entry.subsystem}\``, `- Stable target at capture: \`${entry.node_id}\``, `- Type: \`${annotation.type}\``, `- Source hash: \`${annotation.source_hash ?? "not recorded"}\``, "", annotation.content, "");
		}
	}
	lines.push("## Review rule", "", "A human must select a CGS `spec/` or engine-reference owner. Do not infer a destination or upgrade these observations into current source facts.", "");
	return lines.join("\n");
}

function archive(): void {
	const manifestPath = curatedReferenceArchiveManifestPath(DATA_DIR);
	if (existsSync(manifestPath)) throw new Error("curated reference archive already exists; use --restore before rerunning");
	const sources = FILES.map((file) => ({ file, source: join(GRAPH_DIR, file), archive: join(ARCHIVE_DIR, "graphs", file) }));
	for (const item of sources) {
		if (!existsSync(item.source)) throw new Error(`archive source is missing: ${relative(item.source)}`);
		if (existsSync(item.archive)) throw new Error(`archive target already exists: ${relative(item.archive)}`);
		relative(item.source);
		relative(item.archive);
	}
	const context = loadReadingContext("ue5_code");
	const annotationCount = context.annotations.reduce((sum, entry) => sum + entry.annotations.length, 0);
	const engineIds = new Set(resolvePublishedEvidence(DATA_DIR).graph.elements.nodes.filter((node) => node.data.layer === "engine").map((node) => node.data.id));
	const engineRoot = resolveEngineRoot();
	if (!engineRoot) throw new Error("engine root is unavailable; favorites cannot be verified losslessly");
	const snapshotFavorites = context.favorites.filter((favorite) => favorite.source === "engine" && engineIds.has(favorite.node_id));
	const cacheFavorites = context.favorites.filter((favorite) => {
		if (favorite.source !== "engine" || engineIds.has(favorite.node_id)) return false;
		const cached = loadEngineClassDiskCache(engineRoot, favorite.node_id);
		return cached?.resolved.includes(favorite.node_id) ?? false;
	});
	const preliminarilyVerified = new Set([...snapshotFavorites, ...cacheFavorites].map((favorite) => favorite.node_id));
	const officialSymbols = resolveCachedEpicApiSymbols(context.favorites.filter((favorite) => !preliminarilyVerified.has(favorite.node_id)).map((favorite) => favorite.node_id));
	const officialFavorites = context.favorites.filter((favorite) => favorite.source === "engine" && officialSymbols.has(favorite.node_id));
	const verifiedIds = new Set([...snapshotFavorites, ...cacheFavorites, ...officialFavorites].map((favorite) => favorite.node_id));
	const verifiedFavorites = context.favorites.filter((favorite) => verifiedIds.has(favorite.node_id)).length;
	if (verifiedFavorites !== context.favorites.length) {
		const unresolved = context.favorites.filter((favorite) => !verifiedIds.has(favorite.node_id)).map((favorite) => favorite.node_id);
		throw new Error(`${unresolved.length} favorites do not resolve to exact engine stable IDs: ${unresolved.join(", ")}`);
	}
	const entries = sources.map((item) => {
		const owner = subsystem(item.source);
		return {
			file: item.file,
			subsystem: owner,
			original_path: relative(item.source),
			archive_path: relative(item.archive),
			bytes: readFileSync(item.source).byteLength,
			sha256: sha256(item.source),
			annotation_targets: context.annotations.filter((entry) => entry.subsystem === owner).length,
		};
	});
	const archivedContext = join(ARCHIVE_DIR, `reading-context-before-retirement-revision-${context.revision}.json`);
	const afterRevision = context.revision + 1;
	const manifest: CuratedReferenceArchiveManifest = {
		format_version: CURATED_REFERENCE_ARCHIVE_FORMAT,
		archived_at: new Date().toISOString(),
		status: "archived",
		entries,
		consumer_audit: {
			external_consumers: [],
			active_generators_retired: ["build:references", "build:mindmap"],
			deep_link_adapter: "GET /data/graphs/<archived-file> and GET /api/graph-projection return HTTP 410 with CURATED_REFERENCE_ARCHIVED",
		},
		reading_context: {
			before_revision: context.revision,
			after_revision: afterRevision,
			archived_document: relative(archivedContext),
			annotation_entries: context.annotations.length,
			annotations: annotationCount,
			favorites: context.favorites.length,
			favorites_verified_engine_ids: verifiedFavorites,
			favorites_verified_project_snapshot: snapshotFavorites.length,
			favorites_verified_engine_cache: cacheFavorites.length,
			favorites_verified_official_catalog: officialFavorites.length,
			review_document: relative(REVIEW_PATH),
		},
		rollback: "npm run archive:curated-references -- --restore --expected-reading-revision <revision>; refuses after reading-context edits unless --allow-lossy",
	};
	mkdirSync(join(ARCHIVE_DIR, "graphs"), { recursive: true });
	copyFileSync(readingContextFilePath("ue5_code"), archivedContext);
	writeFileSync(REVIEW_PATH, reviewMarkdown(context), "utf8");
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	for (const item of sources) renameSync(item.source, item.archive);
	mutateReadingContext("ue5_code", context.revision, (draft) => { draft.annotations = []; });
	console.log(JSON.stringify(manifest, null, 2));
}

function restore(): void {
	const manifestPath = curatedReferenceArchiveManifestPath(DATA_DIR);
	if (!existsSync(manifestPath)) throw new Error("curated reference archive manifest is missing");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as CuratedReferenceArchiveManifest;
	const context = loadReadingContext("ue5_code");
	const expectedRaw = process.argv[process.argv.indexOf("--expected-reading-revision") + 1];
	const expected = Number(expectedRaw);
	if (!Number.isSafeInteger(expected) || expected !== context.revision) throw new Error("--expected-reading-revision must equal the current reading-context revision");
	if (context.revision !== manifest.reading_context.after_revision && !process.argv.includes("--allow-lossy")) throw new Error("reading-context changed after archive; restore would be lossy without --allow-lossy");
	for (const entry of manifest.entries) {
		const source = join(ROOT, entry.archive_path);
		const destination = join(ROOT, entry.original_path);
		if (sha256(source) !== entry.sha256 || existsSync(destination)) throw new Error(`cannot safely restore ${entry.file}`);
		renameSync(source, destination);
	}
	const archived = join(ROOT, manifest.reading_context.archived_document);
	if (!process.argv.includes("--allow-lossy")) copyFileSync(archived, readingContextFilePath("ue5_code"));
	console.log(`restored ${manifest.entries.length} curated reference graphs`);
}

if (process.argv.includes("--restore")) restore();
else if (process.argv.includes("--apply")) archive();
else console.log(`dry-run: would archive ${FILES.length} curated reference graphs; add --apply to execute`);
