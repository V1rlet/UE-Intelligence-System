// Remove repository-level artifacts that still describe the retired authoring product.
// User explicitly approved destructive deletion on 2026-08-08.
// Usage: node tools/purge-authoring-residuals.mjs --apply

import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT_DIR = join(ROOT, "data", "archive", "authoring-platform-v1");
const RECEIPT = join(RECEIPT_DIR, "residual-deletion-manifest.json");
const RECEIPT_TEMP = `${RECEIPT}.tmp`;
const TARGETS = ["docs/design-system-cards", "prototypes"];

function normalized(path) {
	return path.replaceAll("\\", "/");
}

function checkedTarget(relativePath) {
	const target = resolve(ROOT, relativePath);
	const prefix = `${ROOT}\\`;
	if (!target.startsWith(prefix) || target === ROOT) {
		throw new Error(`Refusing to delete outside the GraphBrain repository: ${target}`);
	}
	return target;
}

function filesUnder(path) {
	if (!existsSync(path)) return [];
	if (statSync(path).isFile()) return [path];
	return readdirSync(path, { withFileTypes: true })
		.flatMap((entry) => filesUnder(join(path, entry.name)))
		.sort();
}

function apply() {
	const existingTargets = TARGETS.filter((target) => existsSync(checkedTarget(target)));
	if (existsSync(RECEIPT)) {
		if (existingTargets.length > 0) {
			throw new Error("Residual deletion receipt exists but retired artifacts reappeared; refusing to overwrite audit history.");
		}
		console.log(`Retired repository artifacts already purged; receipt retained at ${RECEIPT}`);
		return;
	}

	const files = existingTargets.flatMap((target) => filesUnder(checkedTarget(target))).map((path) => ({
		path: normalized(relative(ROOT, path)),
		bytes: statSync(path).size,
		sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
	}));
	const receipt = {
		schema: "graphbrain.authoring-residual-deletion/1",
		deleted_at: "2026-08-08",
		recoverable_from_graphbrain: false,
		user_approved_destructive_deletion: true,
		reason: "Remove standalone authoring prototypes and design cards after capability migration.",
		deleted_targets: existingTargets,
		files,
	};
	mkdirSync(RECEIPT_DIR, { recursive: true });
	writeFileSync(RECEIPT_TEMP, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
	renameSync(RECEIPT_TEMP, RECEIPT);

	for (const target of existingTargets) rmSync(checkedTarget(target), { recursive: true, force: false });
	console.log(`Deleted ${files.length} residual authoring files from ${existingTargets.length} targets.`);
	console.log(`Audit receipt: ${RECEIPT}`);
}

if (process.argv[2] !== "--apply") throw new Error("Usage: node tools/purge-authoring-residuals.mjs --apply");
apply();
