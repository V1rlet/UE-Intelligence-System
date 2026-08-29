// E3 回归：gate:arch CLI——新增回路硬失败、--update-baseline 显式重定基线、消失提示。
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const REPO_ROOT = resolve(createRequire(import.meta.url).resolve("../package.json"), "..");
const GATE = resolve(REPO_ROOT, "scripts", "gate-arch.ts");
const TSX_CLI = join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

function fixtureGraph(cyclic: boolean): string {
	return JSON.stringify({
		meta: {
			domain: "ue5_code",
			format_version: 2,
			subsystem: "project",
			generated_at: "2030-01-01T00:00:00.000Z",
			generator: "e3-fixture",
			provenance: { schema_version: 1, status: "unknown", source_kind: "working_tree", source_roots: ["C:/P/Source"] },
			coverage: { status: "complete", discovered_files: 1, consumed_files: 1, skipped_files: 0, failed_files: 0, diagnostics: [] },
		},
		elements: {
			nodes: ["UA", "UB", "UC"].map((name) => ({
				data: { id: name, label: name, type: "uclass", domain: "ue5_code", layer: "project", module: "Project", source_path: `Source/${name}.h` },
			})),
			edges: (cyclic
				? [["UA", "UB"], ["UB", "UC"], ["UC", "UA"]]
				: [["UA", "UB"]]
			).map(([source, target]) => ({ data: { id: `${source}--${target}`, source, target, relation: "depends_on", domain: "ue5_code" } })),
		},
	});
}

function runGate(root: string, extraArgs: string[] = []): SpawnSyncReturns<Buffer> {
	const graphPath = join(root, "data", "graphs", "fixture.cyto.json");
	return spawnSync(process.execPath, [TSX_CLI, GATE, "--root", root, "--graph", graphPath, ...extraArgs], {
		cwd: REPO_ROOT,
		encoding: "buffer",
		windowsHide: true,
	});
}

test("E3 回归：无基线时 acyclic 通过；新回路失败；显式重定基线后收敛", () => {
	const root = mkdtempSync(join(tmpdir(), "graphbrain-e3-gate-"));
	mkdirSync(join(root, "data", "graphs"), { recursive: true });
	try {
		writeFileSync(join(root, "data", "graphs", "fixture.cyto.json"), fixtureGraph(false), "utf8");
		let run = runGate(root);
		assert.equal(run.status, 0, String(run.stderr));

		writeFileSync(join(root, "data", "graphs", "fixture.cyto.json"), fixtureGraph(true), "utf8");
		run = runGate(root);
		assert.equal(run.status, 1, "基线外新增回路必须使门禁失败");
		assert.match(run.stderr.toString(), /新增依赖回路/);

		run = runGate(root, ["--update-baseline"]);
		assert.equal(run.status, 0, String(run.stderr));
		assert.match(readFileSync(join(root, "data", "architecture-baseline.json"), "utf8"), /graphbrain-arch-baseline\/1/);

		run = runGate(root);
		assert.equal(run.status, 0, String(run.stderr));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
