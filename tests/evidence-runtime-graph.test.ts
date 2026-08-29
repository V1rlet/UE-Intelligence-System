// F5 回归：EvidenceRuntimeGraph 类型隔离。
// 编译期断言由 `npx tsc --noEmit` 强制（tests 在 tsconfig include 内）：
// 用条件类型做名义隔离断言——brand 一旦被移除（或 GraphFile 结构变化获得兼容性），
// 下面的字面量赋值会立即编译失败（工程标准 TYPE-002 禁用类型压制指令）。
import assert from "node:assert/strict";
import test from "node:test";
import type { GraphFile } from "../adapters/adapter-interface.js";
import {
	joinEvidenceSnapshotPairV3,
	migrateV2GraphToEvidenceV3,
	type EvidenceRuntimeGraph,
} from "../core/schema/evidence-snapshot-v3.js";
import { evidenceNeighborhood, searchEvidenceSymbols, type EvidenceQueryGraph } from "../core/evidence/query.js";

// F5：普通 GraphFile 不得冒充 evidence 运行时投影——缺 brand 且 format_version 不是 3，
// 条件类型必须解析为 false；任何一侧放松都会让 `false` 字面量无法通过类型检查。
type GraphFileImpersonatesRuntimeGraph = GraphFile extends EvidenceRuntimeGraph ? true : false;
const graphFileIsNotRuntimeGraph: GraphFileImpersonatesRuntimeGraph = false;
void graphFileIsNotRuntimeGraph;

function sourceGraph(): GraphFile {
	return {
		meta: {
			domain: "ue5_code", subsystem: "project", format_version: 2,
			generated_at: "2030-01-01T00:00:00.000Z", generator: "ue5-code-adapter/extract-classes@0.3.0",
			provenance: {
				schema_version: 1, status: "verified", source_kind: "working_tree",
				source_roots: ["C:/Project/Source"],
				fingerprint: { algorithm: "sha256-path-content-v1", value: "f".repeat(64), file_count: 1 },
			},
			coverage: { status: "complete", discovered_files: 1, consumed_files: 1, skipped_files: 0, failed_files: 0, diagnostics: [] },
		},
		elements: {
			nodes: [
				{ data: { id: "UProject", label: "Project", type: "uclass", domain: "ue5_code", layer: "project", source_path: "Source/Project.h" } },
			],
			edges: [],
		},
	};
}

test("join 是 EvidenceRuntimeGraph 的唯一构造点：format_version=3 且可直接进查询链路（F5 回归）", () => {
	const pair = migrateV2GraphToEvidenceV3({
		graph: sourceGraph(),
		source: { file: "ue5_code_project__gbtx-0000000000000000.cyto.json", sha256: "a".repeat(64), generation_id: `generation-${"b".repeat(64)}` },
		engineCache: {
			engine_root: "C:/UE/Engine/Source",
			engine_classes: { UEngine: { header: "C:/UE/Engine/Source/Runtime/Engine.h", hash: "engine-hash" } },
		},
		engineAssociation: "5.8",
	});
	const runtimeGraph: EvidenceRuntimeGraph = joinEvidenceSnapshotPairV3(pair);
	assert.equal(runtimeGraph.meta.format_version, 3, "运行时投影携带快照格式号 3，不是持久化图格式 2");
	// 查询链路消费联合类型：v3 投影与 v2 持久化图都能进，不经任何转换。
	const queryable: EvidenceQueryGraph = runtimeGraph;
	assert.ok(searchEvidenceSymbols(queryable, { text: "project" }).symbols.length > 0);
	assert.ok(evidenceNeighborhood(queryable, "UProject"));
	const v2Path: EvidenceQueryGraph = sourceGraph();
	assert.ok(Array.isArray(searchEvidenceSymbols(v2Path).symbols));
});
