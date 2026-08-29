import assert from "node:assert/strict";
import test from "node:test";
import { evidenceExtractionAge, resolveEvidenceStatus } from "../viewer/src/evidenceStatus.js";
import type { GraphCatalogEntry } from "../viewer/src/graphCatalog.js";

function entry(overrides: Partial<GraphCatalogEntry> = {}): GraphCatalogEntry {
	return {
		file: "project.cyto.json",
		domain: "ue5_code",
		subsystem: "project",
		title: "Project",
		kind: "graph",
		stage: "classes",
		status: "",
		date: "",
		nodes: 10,
		edges: 8,
		updated_at: "",
		generated_at: "2026-08-12T12:00:00.000Z",
		generator: "test",
		source_root: "Source",
		format_version: 2,
		provenance_status: "verified",
		coverage_status: "complete",
		coverage_discovered_files: 4,
		coverage_consumed_files: 4,
		coverage_skipped_files: 0,
		coverage_failed_files: 0,
		freshness: "current",
		freshness_reason: "fingerprint-match",
		source_file_count: 4,
		source_files_newer: 0,
		latest_source_at: null,
		...overrides,
	};
}

test("verified evidence resolves to the current presentation", () => {
	assert.deepEqual(resolveEvidenceStatus(entry()), {
		tone: "current",
		label: "来源已验证",
		compactLabel: "已验证",
		reason: "当前源码内容指纹与图谱提取快照一致",
		icon: "check",
	});
});

test("verified partial coverage stays distinct from fully current evidence", () => {
	const status = resolveEvidenceStatus(entry({ coverage_status: "partial", coverage_skipped_files: 3 }));
	assert.equal(status.tone, "partial");
	assert.equal(status.compactLabel, "部分覆盖");
	assert.match(status.reason, /3 个文件/);
});

test("stale and legacy entries remain explicit instead of receiving a guessed default", () => {
	const stale = resolveEvidenceStatus(entry({ freshness: "stale", freshness_reason: "source-newer", source_files_newer: 7 }));
	assert.equal(stale.tone, "stale");
	assert.match(stale.reason, /7 个源码文件/);

	const legacy = resolveEvidenceStatus(entry({ freshness: "unverified", freshness_reason: "v1-no-fingerprint", format_version: null }));
	assert.equal(legacy.tone, "unverified");
	assert.match(legacy.reason, /v1/);
});

test("extraction age is deterministic and handles missing or future timestamps", () => {
	const now = Date.parse("2026-08-13T12:00:00.000Z");
	assert.equal(evidenceExtractionAge(entry(), now), "1 天前");
	assert.equal(evidenceExtractionAge(entry({ generated_at: null }), now), "未记录");
	assert.equal(evidenceExtractionAge(entry({ generated_at: "2026-08-14T12:00:00.000Z" }), now), "刚刚");
});
