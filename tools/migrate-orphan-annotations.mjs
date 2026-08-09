// Preserve annotations whose ue5_code subsystem no longer has an active graph.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const graphDir = join(root, "data", "graphs");
const sourceDir = join(root, "data", "annotations");
const archiveDir = join(root, "data", "archive", "authoring-platform-v1", "annotations", "orphaned-code");
const receipt = join(archiveDir, "migration-manifest.json");

if (existsSync(receipt)) {
	console.log(`Orphan annotation migration already applied: ${relative(root, receipt)}`);
	process.exit(0);
}

const subsystems = new Set(readdirSync(graphDir).filter((name) => name.endsWith(".cyto.json")).map((name) => {
	const graph = JSON.parse(readFileSync(join(graphDir, name), "utf8").replace(/^\uFEFF/, ""));
	return String(graph.meta?.domain) === "ue5_code" ? String(graph.meta?.subsystem ?? "") : "";
}).filter(Boolean));

const candidates = readdirSync(sourceDir).filter((name) => /^ue5_code_.*_annotations\.json$/.test(name)).sort().flatMap((file) => {
	const bytes = readFileSync(join(sourceDir, file));
	const entries = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
	const subsystem = file.slice("ue5_code_".length, -"_annotations.json".length);
	return subsystems.has(subsystem) ? [] : [{ file, subsystem, bytes }];
});

mkdirSync(archiveDir, { recursive: true });
writeFileSync(receipt, `${JSON.stringify({
	schema: "graphbrain.orphan-code-annotations-migration/1",
	migrated_at: new Date().toISOString(),
	policy: "Preserved byte-for-byte because no active ue5_code graph owns the subsystem identity.",
	files: candidates.map(({ file, subsystem, bytes }) => ({
		from: `data/annotations/${file}`,
		to: `data/archive/authoring-platform-v1/annotations/orphaned-code/${file}`,
		subsystem,
		bytes: bytes.length,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	})),
}, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
for (const item of candidates) renameSync(join(sourceDir, item.file), join(archiveDir, item.file));
console.log(`Archived ${candidates.length} orphaned ue5_code annotation files.`);
