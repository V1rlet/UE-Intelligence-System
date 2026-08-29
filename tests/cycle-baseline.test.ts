// V8 回归：回路基线门禁（A3）。
// fixture 基线（无回路）→ 含新回路的图 → assessAndRecordCycles 返回新增回路 + WARN 文案，
// 且基线文件被原子更新为包含该回路；再次刷新同一图 → 无新增告警（added 为空）。
// 另含：坏格式基线 fail-closed、post-commit-update 接线源码契约。
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { mkdirSync } from "node:fs";
import {
	ARCH_BASELINE_FORMAT,
	architectureBaselinePath,
	assessAndRecordCycles,
	type ArchitectureBaselineDocument,
} from "../core/query/arch-baseline.js";

const REPO_ROOT = resolve(createRequire(import.meta.url).resolve("../package.json"), "..");

function fixtureGraph(cyclic: boolean): unknown {
	return {
		meta: {
			domain: "ue5_code",
			format_version: 2,
			subsystem: "project",
			generated_at: "2030-01-01T00:00:00.000Z",
			generator: "v8-fixture",
			provenance: { schema_version: 1, status: "unknown", source_kind: "working_tree", source_roots: ["C:/Proj/Source"] },
			coverage: { status: "complete", discovered_files: 1, consumed_files: 1, skipped_files: 0, failed_files: 0, diagnostics: [] },
		},
		elements: {
			nodes: ["UA", "UB", "UC"].map((name) => ({
				data: { id: name, label: name, type: "uclass", domain: "ue5_code", layer: "project", module: "Project", source_path: `Source/${name}.h` },
			})),
			edges: (cyclic
				? [["UA", "UB"], ["UB", "UC"], ["UC", "UA"]]
				: [["UA", "UB"]]
			).map(([source, target]) => ({
				data: { id: `${source}--${target}`, source, target, relation: "depends_on", domain: "ue5_code" },
			})),
		},
	};
}

function readBaseline(path: string): ArchitectureBaselineDocument {
	return JSON.parse(readFileSync(path, "utf8")) as ArchitectureBaselineDocument;
}

test("V8：无基线 + 无回路图 → 基线建立为空集，无告警", () => {
	const root = mkdtempSync(join(tmpdir(), "graphbrain-v8-"));
	try {
		const update = assessAndRecordCycles({ root, subsystem: "project", graph: fixtureGraph(false) });
		assert.equal(update.added.length, 0);
		assert.equal(update.warnings.length, 0);
		const baseline = readBaseline(architectureBaselinePath(root));
		assert.equal(baseline.format_version, ARCH_BASELINE_FORMAT);
		assert.deepEqual(baseline.cycles, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("V8：新回路出现 → WARN 文案生成且基线推进为含该回路；重复刷新无新增告警", () => {
	const root = mkdtempSync(join(tmpdir(), "graphbrain-v8-"));
	try {
		// 第一轮：无基线时直接引入回路 → 新增 1 条，基线写入该回路
		const first = assessAndRecordCycles({ root, subsystem: "project", graph: fixtureGraph(true) });
		assert.equal(first.added.length, 1);
		assert.match(first.warnings[0], /新增依赖回路/);
		assert.ok(readBaseline(architectureBaselinePath(root)).cycles.length === 1);

		// 第二轮：同一图再次刷新 → 无新增（不再 WARN），unchanged 保持
		const second = assessAndRecordCycles({ root, subsystem: "project", graph: fixtureGraph(true) });
		assert.equal(second.added.length, 0, "同一回路的第二次刷新不得再告警");
		assert.equal(second.warnings.length, 0);
		assert.equal(second.unchanged.length, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

function writeBaseline(root: string, document: unknown): void {
	const path = architectureBaselinePath(root);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(document), "utf8");
}

test("V8：坏格式基线 fail-closed（稳定错误而非静默重建）", () => {
	const root = mkdtempSync(join(tmpdir(), "graphbrain-v8-"));
	try {
		writeBaseline(root, { format_version: "some-other-format/9", subsystem: "project", cycles: [] });
		assert.throws(
			() => assessAndRecordCycles({ root, subsystem: "project", graph: fixtureGraph(true) }),
			/格式不受承认/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("V8 源码契约：post-commit-update 在刷新成功后运行回路门禁且失败不阻断", () => {
	const source = readFileSync(resolve(REPO_ROOT, "core/hooks/post-commit-update.ts"), "utf8");
	assert.match(source, /runCycleGate\(project\.subsystem\)/, "刷新成功路径必须调用回路门禁");
	assert.match(source, /assessAndRecordCycles/, "门禁必须走单一所有者模块");
	assert.match(source, /回路门禁跳过/, "门禁自身异常必须降级为日志而非 hook 失败");
});
