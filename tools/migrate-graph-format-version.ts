// Explicit, idempotent ue5_code migrations. Retired domains are never rewritten here.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	downgradeGraphToV1,
	migrateGraphToCurrent,
	UE5_CODE_GRAPH_FORMAT,
	type VersionedGraphRecord,
} from "../core/schema/graph-version.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GRAPHS_DIR = join(ROOT, "data", "graphs");

export function expectedGraphFormat(domain: string): number | null {
	return domain === "ue5_code" ? UE5_CODE_GRAPH_FORMAT : null;
}

interface Change {
	file: string;
	domain: string;
	from: number | null;
	to: number;
}

export function scanGraphFormatVersions(graphsDir = GRAPHS_DIR): Change[] {
	const changes: Change[] = [];
	for (const file of readdirSync(graphsDir).filter((name) => name.endsWith(".cyto.json")).sort()) {
		const path = join(graphsDir, file);
		const graph = JSON.parse(readFileSync(path, "utf-8").replace(/^\uFEFF/, "")) as {
			meta?: { domain?: string; format_version?: number };
		};
		const domain = graph.meta?.domain;
		if (!domain) continue;
		const expected = expectedGraphFormat(domain);
		if (expected === null) continue;
		const raw = graph.meta?.format_version;
		const declared = raw === undefined || raw === null ? null : Number(raw);
		if (declared !== expected) changes.push({ file, domain, from: declared, to: expected });
	}
	return changes;
}

function main(): void {
	const apply = process.argv.includes("--apply");
	const rollback = process.argv.includes("--rollback-v1");
	if (rollback && !apply) {
		console.error("--rollback-v1 必须与 --apply 一起使用，避免误以为 dry-run 已写盘");
		process.exit(2);
	}
	if (rollback) {
		let changed = 0;
		for (const file of readdirSync(GRAPHS_DIR).filter((name) => name.endsWith(".cyto.json")).sort()) {
			const path = join(GRAPHS_DIR, file);
			const graph = JSON.parse(readFileSync(path, "utf-8").replace(/^\uFEFF/, "")) as VersionedGraphRecord;
			if (graph.meta?.domain !== "ue5_code" || graph.meta.format_version === 1) continue;
			const result = downgradeGraphToV1(graph);
			writeFileSync(path, `${JSON.stringify(result.graph, null, 2)}\n`, "utf-8");
			console.log(`${file}: ${result.from} -> 1`);
			changed++;
		}
		console.log(`已回滚 ${changed} 个 UE 代码图；v2 专属来源证据已移除。`);
		return;
	}
	const changes = scanGraphFormatVersions();
	if (changes.length === 0) {
		console.log(`[${apply ? "apply" : "dry-run"}] 所有活动 UE 代码图均已声明 format_version`);
		return;
	}
	for (const change of changes) {
		console.log(`${change.file}: ${change.from ?? "缺失"} -> ${change.to}`);
	}
	if (!apply) {
		console.log(`共 ${changes.length} 个待迁移；添加 --apply 后写盘。`);
		return;
	}
	for (const change of changes) {
		const path = join(GRAPHS_DIR, change.file);
		const graph = JSON.parse(readFileSync(path, "utf-8").replace(/^\uFEFF/, "")) as VersionedGraphRecord;
		const migrated = migrateGraphToCurrent(graph);
		writeFileSync(path, `${JSON.stringify(migrated.graph, null, 2)}\n`, "utf-8");
	}
	console.log(`已迁移 ${changes.length} 个 UE 代码图。`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
