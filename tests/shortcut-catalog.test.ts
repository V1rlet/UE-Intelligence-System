import assert from "node:assert/strict";
import test from "node:test";
import { SHORTCUT_KEYS, shortcutHelpGroups } from "../viewer/src/shortcutCatalog.js";

test("shortcuts expose only read-only viewer destinations", () => {
	assert.deepEqual(SHORTCUT_KEYS.global, {
		overview: "0", exploreArchitecture: "1", exploreRelations: "2", changes: "3", exploreApi: "4", search: "/", help: "?",
	});
	const descriptions = shortcutHelpGroups("graph").flatMap((group) => group.items.map((item) => item.description));
	assert.ok(descriptions.some((description) => description.includes("代码架构")));
	assert.ok(descriptions.some((description) => description.includes("代码事实")));
	assert.ok(descriptions.some((description) => description.includes("代码变化")));
	assert.equal(descriptions.some((description) => /规划|设计方案|交付|撤销|重做/.test(description)), false);
});

test("graph help adds one non-duplicated read-only interaction group", () => {
	const ids = shortcutHelpGroups("graph").map((group) => group.id);
	assert.deepEqual(ids, ["global", "graph"]);
	assert.equal(new Set(ids).size, ids.length);
});
