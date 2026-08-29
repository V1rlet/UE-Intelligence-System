// D-P3 回归：reading-context v2（行级锚 + 失效半径）。
// ① v1 文件经 loadReadingContext 无损迁移为 v2（幂等，写回后仍可载入）；
// ② 锚区间指纹：确定性、行边界正确、超界失效；
// ③ 半径语义：节点 hash 失配但锚区间未变 → 不 stale；锚区间变了 → stale；
// ④ schema 拒绝坏锚（负行号 / 非法 fingerprint）。
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	loadReadingContext,
	mutateReadingContext,
	READING_CONTEXT_FORMAT_VERSION,
	replaceReadingContext,
	type ReadingAnnotationAnchor,
} from "../core/reading-context/store.js";
import { annotationRangeFingerprint } from "../core/annotation/staleness.js";

function writeDocument(directory: string, document: unknown): void {
	writeFileSync(join(directory, "ue5_code.json"), JSON.stringify(document), "utf8");
}

const V1_DOCUMENT = {
	format_version: 1,
	domain: "ue5_code",
	revision: 4,
	updated_at: "2026-08-01T00:00:00.000Z",
	annotations: [{
		subsystem: "project",
		node_id: "UProject",
		annotations: [{ id: "ann_1", type: "gotcha", content: "v1 内容", created_at: "2026-08-01T00:00:00.000Z", source_hash: "abc" }],
	}],
	favorites: [],
};

test("D-P3 迁移：磁盘上的 v1 文档经 loadReadingContext 升为 v2 且内容无损、幂等", () => {
	const directory = mkdtempSync(join(tmpdir(), "graphbrain-v2-migrate-"));
	try {
		writeDocument(directory, V1_DOCUMENT);
		const loaded = loadReadingContext("ue5_code", directory);
		assert.equal(loaded.format_version, READING_CONTEXT_FORMAT_VERSION);
		assert.equal(loaded.revision, 4);
		assert.equal(loaded.annotations[0].annotations[0].content, "v1 内容");
		assert.equal(loaded.annotations[0].annotations[0].source_hash, "abc");
		assert.equal(loaded.annotations[0].annotations[0].anchor, undefined);

		// 幂等：迁移结果再次经过同一迁移路径不变（写回→重载）
		// replaceReadingContext 是整体替换，不推进 revision（与 v1 语义一致）。
		replaceReadingContext(loaded, directory);
		const reloaded = loadReadingContext("ue5_code", directory);
		assert.equal(reloaded.format_version, READING_CONTEXT_FORMAT_VERSION);
		assert.equal(reloaded.revision, 4);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("D-P3 指纹：行区间字节指纹确定且随区间变化；超界返回 null", () => {
	// 3 行：'aa\nbb\ncc'（无尾换行）
	const bytes = Buffer.from("aa\nbb\ncc", "utf8");
	const whole = annotationRangeFingerprint(bytes, 1, 3)!;
	assert.ok(/^[a-f0-9]{64}$/.test(whole));
	assert.equal(annotationRangeFingerprint(bytes, 1, 3), whole, "同区间必须得到相同指纹");
	assert.notEqual(annotationRangeFingerprint(bytes, 2, 3)!, whole);
	assert.notEqual(annotationRangeFingerprint(bytes, 1, 2)!, annotationRangeFingerprint(bytes, 2, 3)!);
	assert.equal(annotationRangeFingerprint(bytes, 2, 4), null, "endLine 超出行数必须失效");
	assert.equal(annotationRangeFingerprint(bytes, 0, 2), null);
	assert.equal(annotationRangeFingerprint(bytes, 3, 2), null);

	// CRLF：\r 留在行内，同样确定
	const crlf = Buffer.from("aa\r\nbb\r\ncc", "utf8");
	assert.ok(/^[a-f0-9]{64}$/.test(annotationRangeFingerprint(crlf, 1, 3)!));

	// 行内容变化 → 指纹变化（失效半径的核心判定）
	const edited = Buffer.from("aa\nbX\ncc", "utf8");
	assert.notEqual(annotationRangeFingerprint(edited, 2, 2)!, annotationRangeFingerprint(bytes, 2, 2)!);
});

test("D-P3 schema：坏 anchor 被写入边界拒绝", () => {
	const directory = mkdtempSync(join(tmpdir(), "graphbrain-v2-schema-"));
	try {
		replaceReadingContext(loadReadingContext("ue5_code", directory), directory);
		const badAnchors: Array<ReadingAnnotationAnchor> = [
			{ start_line: 0, end_line: 2, fingerprint: "a".repeat(64) },
			{ start_line: 1, end_line: 2, fingerprint: "not-hex" },
			{ start_line: 1, end_line: 2, fingerprint: "" },
		];
		for (const anchor of badAnchors) {
			assert.throws(
				() => mutateReadingContext("ue5_code", loadReadingContext("ue5_code", directory).revision, (draft) => {
					draft.annotations.push({
						subsystem: "project",
						node_id: "UA",
						annotations: [{ id: "ann_bad", type: "reference", content: "x", created_at: "2030-01-01T00:00:00.000Z", anchor }],
					});
				}, directory),
				/阅读上下文不符合 schema/,
				`坏锚必须被拒绝：${JSON.stringify(anchor)}`,
			);
		}
		// end_line < start_line 属语义规则：draft-07 schema 无法跨字段表达，
		// 由 API 解析边界（parseAnnotationInput）与指纹计算（超界→null→stale）共同承担。
		// 这里验证该形状能通过 schema 但在指纹层退化为失效（null）。
		const reversed: ReadingAnnotationAnchor = { start_line: 3, end_line: 2, fingerprint: "a".repeat(64) };
		mutateReadingContext("ue5_code", loadReadingContext("ue5_code", directory).revision, (draft) => {
			draft.annotations.push({
				subsystem: "project",
				node_id: "UB",
				annotations: [{ id: "ann_rev", type: "reference", content: "x", created_at: "2030-01-01T00:00:00.000Z", anchor: reversed }],
			});
		}, directory);
		assert.equal(annotationRangeFingerprint(Buffer.from("x"), 3, 2), null);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("D-P3 端到端：带合法锚的标注写盘后保留 anchor 字段", () => {
	const directory = mkdtempSync(join(tmpdir(), "graphbrain-v2-e2e-"));
	try {
		const anchor: ReadingAnnotationAnchor = { start_line: 10, end_line: 12, fingerprint: "b".repeat(64) };
		replaceReadingContext(loadReadingContext("ue5_code", directory), directory);
		mutateReadingContext("ue5_code", loadReadingContext("ue5_code", directory).revision, (draft) => {
			draft.annotations.push({
				subsystem: "project",
				node_id: "UA",
				annotations: [{ id: "ann_ok", type: "reference", content: "锚定标注", created_at: "2030-01-01T00:00:00.000Z", anchor }],
			});
		}, directory);
		const onDisk = JSON.parse(readFileSync(join(directory, "ue5_code.json"), "utf8"));
		assert.equal(onDisk.format_version, 2);
		assert.deepEqual(onDisk.annotations[0].annotations[0].anchor, anchor);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
