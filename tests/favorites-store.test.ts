// Graph Brain / core/favorites - 收藏写路径测试（add/remove/import + revision 冲突）。
// favorites/store 与 reading-context/store 的 ROOT 在模块加载时由 GB_PROJECT_ROOT 决定，
// 因此本文件使用动态 import（先设置 env 再加载）。

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

let fixtureRoot = "";

test.before(async () => {
	fixtureRoot = mkdtempSync(join(tmpdir(), "gb-favorites-"));
	process.env.GB_PROJECT_ROOT = fixtureRoot;
	const schemaDest = join(fixtureRoot, "core", "schema", "reading-context.schema.json");
	mkdirSync(join(schemaDest, ".."), { recursive: true });
	writeFileSync(schemaDest, readFileSync("core/schema/reading-context.schema.json", "utf8"));
	const { emptyReadingContext, replaceReadingContext } = await import("../core/reading-context/store.js");
	replaceReadingContext(emptyReadingContext());
});

test.after(() => {
	if (fixtureRoot) {
		rmSync(fixtureRoot, { recursive: true, force: true });
		delete process.env.GB_PROJECT_ROOT;
	}
});

test("favorites add, import and remove round-trip with revision protection", async () => {
	const { addFavorite, importFavorites, loadFavoriteDocument, removeFavorite } = await import("../core/favorites/store.js");
	const { ReadingContextConflictError } = await import("../core/reading-context/store.js");

	let doc = loadFavoriteDocument("ue5_code");
	assert.equal(doc.revision, 0);

	doc = addFavorite("ue5_code", { kind: "class", source: "project", node_id: "AThing" }, doc.revision);
	assert.equal(doc.revision, 1);
	assert.deepEqual(doc.favorites.map((favorite) => favorite.node_id), ["AThing"]);

	// 过期 revision 拒绝，且不丢已保存的收藏。
	assert.throws(
		() => addFavorite("ue5_code", { kind: "function", source: "engine", node_id: "AFoo::Bar" }, 0),
		(error: unknown) => error instanceof ReadingContextConflictError,
	);
	doc = loadFavoriteDocument("ue5_code");
	assert.deepEqual(doc.favorites.map((favorite) => favorite.node_id), ["AThing"]);

	// 批量导入 + 去重（同 key 更新而非追加）。
	doc = importFavorites("ue5_code", [
		{ kind: "class", source: "project", node_id: "AThing", label: "updated label" },
		{ kind: "function", source: "engine", node_id: "AFoo::Bar" },
	], doc.revision);
	assert.equal(doc.favorites.length, 2, "同 key 收藏应更新而非重复追加");
	assert.equal(doc.favorites.find((favorite) => favorite.node_id === "AThing")?.label, "updated label");

	// 删除。
	doc = removeFavorite("ue5_code", { kind: "function", source: "engine", node_id: "AFoo::Bar" }, doc.revision);
	assert.deepEqual(doc.favorites.map((favorite) => favorite.node_id), ["AThing"]);

	// 保存/重载验证。
	const reloaded = await import("../core/favorites/store.js");
	assert.deepEqual(reloaded.loadFavorites("ue5_code").map((favorite) => favorite.node_id), ["AThing"]);
});
