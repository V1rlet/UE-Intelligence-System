// Graph Brain / core/annotation - 标注陈旧扫描与 reading-context 冲突保护测试。
//
// staleness/store/reading-context 模块的 ROOT 在模块加载时由 GB_PROJECT_ROOT 决定，
// 因此本文件使用动态 import（先设置 env 再加载），且不静态导入任何依赖项目根的模块。

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { publicationDirectories, publishDataGeneration } from "../core/store/data-publication.js";

const sha1 = (content: string) => createHash("sha1").update(content).digest("hex");

let fixtureCounter = 0;

function makeFixture(): string {
	const root = mkdtempSync(join(tmpdir(), `gb-stale-${fixtureCounter++}-`));
	process.env.GB_PROJECT_ROOT = root;
	const sourceDir = join(root, "Source");
	mkdirSync(sourceDir, { recursive: true });
	writeFileSync(join(sourceDir, "A.h"), "v1", "utf8");
	// reading-context store 的 schema 路径基于 ROOT；fixture 内放副本供校验。
	const schemaDest = join(root, "core", "schema", "reading-context.schema.json");
	mkdirSync(join(schemaDest, ".."), { recursive: true });
	writeFileSync(schemaDest, readFileSync("core/schema/reading-context.schema.json", "utf8"));
	return root;
}

/** 发布一个含节点 A（有 source_path）与 B（无 source_path）的 project 图。 */
function setupGraph(root: string): void {
	const directories = publicationDirectories(join(root, "data"));
	mkdirSync(directories.graphs, { recursive: true });
	const graph = {
		meta: {
			domain: "ue5_code",
			subsystem: "project",
			format_version: 2,
			generated_at: "2026-08-09T00:00:00.000Z",
			source_root: join(root, "Source"),
		},
		elements: {
			nodes: [
				{ data: { id: "A", source_path: "A.h", type: "uclass" } },
				{ data: { id: "B", type: "uclass" } },
			],
			edges: [],
		},
	};
	publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: 0,
		graphContent: `${JSON.stringify(graph, null, 2)}\n`,
	});
}

/** 初始 reading-context：A 挂匹配 hash，B 挂不匹配 hash。 */
async function seedAnnotations(): Promise<void> {
	const { addAnnotation } = await import("../core/annotation/store.js");
	const { emptyReadingContext, replaceReadingContext } = await import("../core/reading-context/store.js");
	const dir = join(process.env.GB_PROJECT_ROOT!, "data", "reading-context");
	mkdirSync(dir, { recursive: true });
	replaceReadingContext(emptyReadingContext(), dir);
	addAnnotation("ue5_code", "project", "A", { type: "gotcha", content: "a", source_hash: sha1("v1") }, 0);
	addAnnotation("ue5_code", "project", "B", { type: "gotcha", content: "b", source_hash: "deadbeef" }, 1);
}

let fixtureRoot = "";

test.before(async () => {
	fixtureRoot = makeFixture();
	setupGraph(fixtureRoot);
	await seedAnnotations();
});

test.after(() => {
	if (fixtureRoot) {
		rmSync(fixtureRoot, { recursive: true, force: true });
		delete process.env.GB_PROJECT_ROOT;
	}
});

test("scanStale writes back staleness, is idempotent and survives reload", async () => {
	const { scanStale } = await import("../core/annotation/staleness.js");
	const result = scanStale("ue5_code", "project");
	assert.equal(result.checked, 2);
	assert.equal(result.stale, 1, "B（无 source_path / hash 不匹配）应为 stale");
	assert.equal(result.changed, true);

	// 幂等：再次扫描无变化。
	const second = scanStale("ue5_code", "project");
	assert.equal(second.changed, false);

	// 保存/重载：写回结果可从磁盘重新加载验证。
	const { loadAnnotationDocument } = await import("../core/annotation/store.js");
	const doc = loadAnnotationDocument("ue5_code", "project");
	const annA = doc.entries.find((entry) => entry.node_id === "A")!.annotations[0];
	const annB = doc.entries.find((entry) => entry.node_id === "B")!.annotations[0];
	assert.equal(annA.stale, undefined, "hash 匹配的标注不应带 stale");
	assert.equal(annB.stale, true, "hash 不匹配的标注应带 stale");
});

test("a stale-revision save is rejected without overwriting concurrent annotations", async () => {
	const { loadAnnotationDocument, saveAnnotations, addAnnotation } = await import("../core/annotation/store.js");
	const { ReadingContextConflictError } = await import("../core/reading-context/store.js");

	// 用户并发写入标注 C（revision 前进）。
	const before = loadAnnotationDocument("ue5_code", "project");
	addAnnotation("ue5_code", "project", "C", { type: "reference", content: "concurrent note" }, before.revision);

	// 基于旧 revision 的整子系统替换 → 冲突，且不覆盖新标注。
	assert.throws(
		() => saveAnnotations("ue5_code", "project", before.entries, before.revision),
		(error: unknown) => error instanceof ReadingContextConflictError,
	);
	const afterConflict = loadAnnotationDocument("ue5_code", "project");
	assert.ok(afterConflict.entries.some((entry) => entry.node_id === "C" && entry.annotations[0].content === "concurrent note"),
		"冲突拒绝不得丢失并发写入的标注");

	// 重试（模拟 scanStale 重读最新 → 重算 → 新 revision 写）：成功且保留并发标注。
	const latest = loadAnnotationDocument("ue5_code", "project");
	saveAnnotations("ue5_code", "project", latest.entries, latest.revision);
	const afterRetry = loadAnnotationDocument("ue5_code", "project");
	assert.ok(afterRetry.entries.some((entry) => entry.node_id === "C"));
	assert.ok(afterRetry.entries.some((entry) => entry.node_id === "B" && entry.annotations[0].stale === true),
		"重试后 stale 标记仍保留");
});

test("three consecutive stale-revision writes each conflict without corrupting the document", async () => {
	const { loadAnnotationDocument, saveAnnotations, addAnnotation } = await import("../core/annotation/store.js");
	const { ReadingContextConflictError } = await import("../core/reading-context/store.js");

	for (let index = 0; index < 3; index += 1) {
		const snapshot = loadAnnotationDocument("ue5_code", "project");
		addAnnotation("ue5_code", "project", `N${index}`, { type: "reference", content: `n${index}` }, snapshot.revision);
		assert.throws(
			() => saveAnnotations("ue5_code", "project", snapshot.entries, snapshot.revision),
			(error: unknown) => error instanceof ReadingContextConflictError,
			`第 ${index + 1} 次过期写入必须冲突`,
		);
	}
	const final = loadAnnotationDocument("ue5_code", "project");
	for (let index = 0; index < 3; index += 1) {
		assert.ok(final.entries.some((entry) => entry.node_id === `N${index}`), `并发标注 N${index} 必须保留`);
	}
	assert.ok(final.revision >= 4);
});
