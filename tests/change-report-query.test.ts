import assert from "node:assert/strict";
import test from "node:test";
import type { ChangeReport } from "../core/query/change-report";
import { changeReportQueryIndex } from "../core/query/change-report-query";

function fixture(): ChangeReport {
	return {
		format_version: 1,
		domain: "ue5_code",
		subsystem: "query-index",
		generated_at: "2026-08-09T00:00:00.000Z",
		generator: "test",
		baseline: { file: "before", generated_at: null, fingerprint: null },
		current: { file: "after", generated_at: null, fingerprint: null },
		summary: { nodes: { added: 4, removed: 0, changed: 0 }, edges: { added: 1, removed: 0, changed: 0 }, direct_nodes: 4, affected_nodes: 0, affected_modules: 2 },
		changes: {
			added_nodes: [
				{ id: "UiFn", label: "UI function", type: "ufunction", module: "UI", source_path: "UI.h", changed_fields: ["api"] },
				{ id: "CoreFolder", label: "Core", type: "folder", module: "Core", source_path: "Core" },
				{ id: "CoreFn", label: "Core function", type: "ufunction", module: "Core", source_path: "Core.h", changed_fields: ["api", "description"] },
				{ id: "CoreType", label: "Core type", type: "uclass", module: "Core", source_path: "CoreType.h", changed_fields: ["description"] },
			],
			removed_nodes: [],
			changed_nodes: [],
			added_edges: [{ id: "edge", source: "CoreType", target: "CoreFn", relation: "composes" }],
			removed_edges: [],
			changed_edges: [],
		},
		impact: { direct_node_ids: ["CoreFolder", "CoreFn", "CoreType", "UiFn"], affected_node_ids: [], modules: [{ module: "Core", direct: 3, affected: 0 }, { module: "UI", direct: 1, affected: 0 }] },
	};
}

test("change report query index derives reusable module, type, field, label, and evidence views", () => {
	const report = fixture();
	const index = changeReportQueryIndex(report);
	assert.equal(changeReportQueryIndex(report), index);
	assert.deepEqual(index.modules, ["Core", "UI"]);
	assert.equal(index.preferredModule, "Core");

	const defaultCode = index.selectNodes({ tab: "added", scope: "code", module: null, nodeType: null });
	assert.equal(index.selectNodes({ tab: "added", scope: "code", module: null, nodeType: null }), defaultCode);
	assert.deepEqual(defaultCode.scopedNodes.map((node) => node.id), ["CoreType", "CoreFn"]);
	assert.deepEqual(defaultCode.nodeTypeCounts, [["uclass", 1], ["ufunction", 1]]);
	assert.deepEqual(defaultCode.changedFieldCounts, [["description", 2], ["api", 1]]);

	const allCode = index.selectNodes({ tab: "added", scope: "code", module: "*", nodeType: "ufunction" });
	assert.deepEqual(allCode.visibleNodes.map((node) => node.id), ["CoreFn", "UiFn"]);
	const structure = index.selectNodes({ tab: "added", scope: "structure", module: "Core", nodeType: null });
	assert.deepEqual(structure.visibleNodes.map((node) => node.id), ["CoreFolder"]);
	assert.equal(index.nodeLabels.get("CoreType"), "Core type");
	assert.deepEqual(index.relationEvidenceByNode.get("CoreFn")?.map((item) => item.edge.id), ["edge"]);
});
