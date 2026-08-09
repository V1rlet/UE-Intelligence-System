// Irreversibly remove GraphBrain's retired authoring data while preserving an audit receipt.
// User explicitly approved destructive deletion on 2026-08-08.
// Usage: node tools/purge-authoring-platform.mjs --apply

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
const DATA = join(ROOT, "data");
const RECEIPT_DIR = join(DATA, "archive", "authoring-platform-v1");
const RECEIPT = join(RECEIPT_DIR, "deletion-manifest.json");
const RECEIPT_TEMP = `${RECEIPT}.tmp`;
const SCHEMA = "graphbrain.authoring-platform-deletion/1";

// Code annotations and API favorites are intentionally retained.
const DATA_PATHS = [
	"cross-domain",
	"design-packages",
	"doc-registry",
	"entity-registry",
	"reports",
	"standards",
	"task-packages",
	"impact-report.json",
	"workbench-acks.json",
];

const RETIRED_GRAPH_DOMAINS = new Set([
	"design_workspace",
	"level_design",
	"narrative",
	"quest",
	"ue5_planned",
]);

function normalized(path) {
	return path.replaceAll("\\", "/");
}

function hash(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function filesUnder(path) {
	if (!existsSync(path)) return [];
	if (statSync(path).isFile()) return [path];
	return readdirSync(path, { withFileTypes: true })
		.flatMap((entry) => filesUnder(join(path, entry.name)))
		.sort();
}

function retiredGraphs() {
	const graphs = join(DATA, "graphs");
	if (!existsSync(graphs)) return [];
	return readdirSync(graphs)
		.filter((file) => file.endsWith(".cyto.json"))
		.filter((file) => {
			try {
				const graph = JSON.parse(readFileSync(join(graphs, file), "utf8").replace(/^\uFEFF/, ""));
				return RETIRED_GRAPH_DOMAINS.has(String(graph.meta?.domain ?? ""));
			} catch {
				return false;
			}
		})
		.map((file) => join("graphs", file))
		.sort();
}

function checkedDataPath(relativePath) {
	const target = resolve(DATA, relativePath);
	const prefix = `${resolve(DATA)}\\`;
	if (!target.startsWith(prefix) || target === resolve(DATA)) {
		throw new Error(`拒绝数据目录外的删除目标：${target}`);
	}
	return target;
}

function apply() {
	const targetPaths = [...DATA_PATHS, ...retiredGraphs()]
		.map((path) => normalized(path))
		.filter((path, index, all) => all.indexOf(path) === index)
		.sort();
	const existingTargets = targetPaths.filter((path) => existsSync(checkedDataPath(path)));
	if (existsSync(RECEIPT)) {
		if (existingTargets.length > 0) {
			throw new Error(`删除清单已经存在，但又发现 ${existingTargets.length} 个活动目标；拒绝覆盖既有审计记录。`);
		}
		console.log(`Authoring data already purged; receipt retained at ${RECEIPT}`);
		return;
	}

	const files = existingTargets.flatMap((target) => filesUnder(checkedDataPath(target))).map((path) => ({
		path: normalized(relative(DATA, path)),
		bytes: statSync(path).size,
		sha256: hash(path),
	}));
	const receipt = {
		schema: SCHEMA,
		deleted_at: "2026-08-08",
		recoverable_from_graphbrain: false,
		user_approved_destructive_deletion: true,
		retained_capabilities: ["ue5_code graphs", "code annotations", "API favorites", "engine API cache"],
		replacement_owner: "ClaudeGameStudios technical-director, lead-programmer, and specialist programmer workflows",
		retired_domains: [...RETIRED_GRAPH_DOMAINS].sort(),
		deleted_targets: existingTargets,
		files,
	};
	mkdirSync(RECEIPT_DIR, { recursive: true });
	writeFileSync(RECEIPT_TEMP, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
	renameSync(RECEIPT_TEMP, RECEIPT);

	for (const target of existingTargets) rmSync(checkedDataPath(target), { recursive: true, force: false });
	console.log(`Deleted ${files.length} files from ${existingTargets.length} retired targets.`);
	console.log(`Audit receipt: ${RECEIPT}`);
}

if (process.argv[2] !== "--apply") throw new Error("Usage: node tools/purge-authoring-platform.mjs --apply");
apply();
