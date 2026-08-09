// One-time, idempotent compatibility migration for annotations whose authoring graphs were retired.
// UE code annotations remain active; all other annotation files are preserved in the retirement archive.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(root, "data", "annotations");
const archiveDir = join(root, "data", "archive", "authoring-platform-v1", "annotations");
const receiptPath = join(archiveDir, "migration-manifest.json");

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

if (existsSync(receiptPath)) {
	console.log(`Retired annotation migration already applied: ${relative(root, receiptPath)}`);
	process.exit(0);
}

const candidates = [];
for (const file of readdirSync(sourceDir).filter((name) => name.endsWith("_annotations.json")).sort()) {
	const source = join(sourceDir, file);
	const bytes = readFileSync(source);
	const entries = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
	const domains = [...new Set(entries.map((entry) => String(entry.domain ?? "")))].sort();
	if (domains.length === 1 && domains[0] === "ue5_code") continue;
	if (domains.includes("ue5_code")) {
		throw new Error(`${file} mixes ue5_code and retired domains; refusing to invent a split without review.`);
	}
	candidates.push({ file, source, bytes, domains });
}

mkdirSync(archiveDir, { recursive: true });
const manifest = {
	schema: "graphbrain.retired-annotations-migration/1",
	migrated_at: new Date().toISOString(),
	active_domain: "ue5_code",
	policy: "Retired-domain annotations are preserved byte-for-byte but are not served by GraphBrain.",
	files: candidates.map(({ file, bytes, domains }) => ({
		from: `data/annotations/${file}`,
		to: `data/archive/authoring-platform-v1/annotations/${file}`,
		bytes: bytes.length,
		sha256: sha256(bytes),
		domains,
	})),
};
writeFileSync(receiptPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
for (const candidate of candidates) renameSync(candidate.source, join(archiveDir, candidate.file));
console.log(`Archived ${candidates.length} retired annotation files; active ue5_code annotations were left in place.`);
