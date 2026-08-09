// Explicit legacy annotations/favorites -> canonical reading-context migration.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	loadReadingContext,
	readingContextFilePath,
	replaceReadingContext,
	type ReadingContextDocument,
} from "../core/reading-context/store.js";
import {
	migrateLegacyReadingContext,
	type LegacyAnnotationDocument,
	type LegacyAnnotationEntry,
	type LegacyFavorite,
} from "../core/reading-context/migrate.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ANNOTATIONS_DIR = join(ROOT, "data", "annotations");
const FAVORITES_DIR = join(ROOT, "data", "api-favorites");
const ARCHIVE_DIR = join(ROOT, "data", "archive", "reading-context-v1");
const MANIFEST_PATH = join(ARCHIVE_DIR, "migration-manifest.json");

function json(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function legacyAnnotationFiles(): string[] {
	if (!existsSync(ANNOTATIONS_DIR)) return [];
	return readdirSync(ANNOTATIONS_DIR).filter((name) => name.startsWith("ue5_code_") && name.endsWith("_annotations.json")).sort();
}

function legacyFavoriteFiles(): string[] {
	if (!existsSync(FAVORITES_DIR)) return [];
	return readdirSync(FAVORITES_DIR).filter((name) => name === "ue5_code_api_favorites.json").sort();
}

export function buildMigratedReadingContext(now = new Date().toISOString()): ReadingContextDocument {
	const annotationDocuments: LegacyAnnotationDocument[] = [];
	for (const file of legacyAnnotationFiles()) {
		const subsystem = file.slice("ue5_code_".length, -"_annotations.json".length);
		const entries = json(join(ANNOTATIONS_DIR, file)) as LegacyAnnotationEntry[];
		annotationDocuments.push({ subsystem, entries });
	}
	const favorites: LegacyFavorite[] = [];
	for (const file of legacyFavoriteFiles()) {
		favorites.push(...json(join(FAVORITES_DIR, file)) as LegacyFavorite[]);
	}
	return migrateLegacyReadingContext(annotationDocuments, favorites, now);
}

function migrate(apply: boolean): void {
	const annotationFiles = legacyAnnotationFiles();
	const favoriteFiles = legacyFavoriteFiles();
	const canonicalPath = readingContextFilePath("ue5_code");
	if (existsSync(canonicalPath)) {
		const current = loadReadingContext("ue5_code");
		if (annotationFiles.length === 0 && favoriteFiles.length === 0) {
			console.log(`[${apply ? "apply" : "dry-run"}] reading-context 已迁移：revision ${current.revision}`);
			return;
		}
		throw new Error("canonical reading-context 已存在但 legacy 文件仍在；为避免双写，需先审计中断迁移状态");
	}
	const document = buildMigratedReadingContext();
	console.log(`annotations: ${document.annotations.length} node entries from ${annotationFiles.length} files`);
	console.log(`favorites: ${document.favorites.length} entries from ${favoriteFiles.length} files`);
	if (!apply) {
		console.log("添加 --apply 后写入 canonical reading-context 并归档 legacy 文件。");
		return;
	}
	replaceReadingContext(document);
	mkdirSync(join(ARCHIVE_DIR, "legacy-annotations"), { recursive: true });
	mkdirSync(join(ARCHIVE_DIR, "legacy-favorites"), { recursive: true });
	const files = [
		...annotationFiles.map((file) => ({ source: join(ANNOTATIONS_DIR, file), archive: join(ARCHIVE_DIR, "legacy-annotations", file) })),
		...favoriteFiles.map((file) => ({ source: join(FAVORITES_DIR, file), archive: join(ARCHIVE_DIR, "legacy-favorites", file) })),
	];
	const manifest = {
		schema: "graphbrain.reading-context-migration/1",
		created_at: document.updated_at,
		migrated_revision: document.revision,
		canonical: "data/reading-context/ue5_code.json",
		files: files.map((file) => ({
			original_path: file.source.slice(ROOT.length + 1).replaceAll("\\", "/"),
			archive_path: file.archive.slice(ROOT.length + 1).replaceAll("\\", "/"),
			bytes: readFileSync(file.source).byteLength,
			sha256: sha256(file.source),
		})),
		rollback: "npm run migrate:reading-context -- --apply --restore-legacy (refuses after later revisions unless --allow-lossy)",
	};
	writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	for (const file of files) renameSync(file.source, file.archive);
	console.log(`已迁移 reading-context revision ${document.revision}；legacy 文件已归档 ${files.length} 个。`);
}

function restoreLegacy(apply: boolean, allowLossy: boolean): void {
	if (!apply) throw new Error("--restore-legacy 必须与 --apply 一起使用");
	if (!existsSync(MANIFEST_PATH)) throw new Error("缺少 reading-context migration manifest");
	const manifest = json(MANIFEST_PATH) as { migrated_revision: number; files: Array<{ original_path: string; archive_path: string }> };
	const current = loadReadingContext("ue5_code");
	if (current.revision !== manifest.migrated_revision && !allowLossy) {
		throw new Error(`reading-context 已从 revision ${manifest.migrated_revision} 变为 ${current.revision}；恢复旧文件会丢失新改动，需显式 --allow-lossy`);
	}
	for (const file of manifest.files) {
		const source = join(ROOT, file.archive_path);
		const destination = join(ROOT, file.original_path);
		mkdirSync(dirname(destination), { recursive: true });
		renameSync(source, destination);
	}
	const canonicalPath = readingContextFilePath("ue5_code");
	const rollbackPath = join(ARCHIVE_DIR, `ue5_code.rolled-back-revision-${current.revision}.json`);
	renameSync(canonicalPath, rollbackPath);
	console.log(`已恢复 ${manifest.files.length} 个 legacy 文件；canonical revision ${current.revision} 已归档为 ${basename(rollbackPath)}。`);
}

function main(): void {
	const apply = process.argv.includes("--apply");
	if (process.argv.includes("--restore-legacy")) restoreLegacy(apply, process.argv.includes("--allow-lossy"));
	else migrate(apply);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
