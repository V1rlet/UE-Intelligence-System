import assert from "node:assert/strict";
import test from "node:test";
import { nextTreeItemIndex, type VisibleTreeItem } from "../viewer/components/common/treeNavigation.js";

const items: VisibleTreeItem[] = [
	{ id: "root" },
	{ id: "engine", parentId: "root" },
	{ id: "runtime", parentId: "engine" },
	{ id: "project", parentId: "root" },
];

test("tree navigation moves through visible items without wrapping", () => {
	assert.equal(nextTreeItemIndex(items, 0, "ArrowDown"), 1);
	assert.equal(nextTreeItemIndex(items, 3, "ArrowDown"), 3);
	assert.equal(nextTreeItemIndex(items, 0, "ArrowUp"), 0);
	assert.equal(nextTreeItemIndex(items, 2, "ArrowUp"), 1);
	assert.equal(nextTreeItemIndex(items, 2, "Home"), 0);
	assert.equal(nextTreeItemIndex(items, 1, "End"), 3);
});

test("horizontal tree navigation follows parent and first-child relationships", () => {
	assert.equal(nextTreeItemIndex(items, 0, "ArrowRight"), 1);
	assert.equal(nextTreeItemIndex(items, 1, "ArrowRight"), 2);
	assert.equal(nextTreeItemIndex(items, 2, "ArrowRight"), 2);
	assert.equal(nextTreeItemIndex(items, 2, "ArrowLeft"), 1);
	assert.equal(nextTreeItemIndex(items, 3, "ArrowLeft"), 0);
	assert.equal(nextTreeItemIndex(items, 0, "ArrowLeft"), 0);
});

test("tree navigation rejects unrelated keys and invalid indexes", () => {
	assert.equal(nextTreeItemIndex(items, 1, "Enter"), null);
	assert.equal(nextTreeItemIndex(items, -1, "ArrowDown"), null);
	assert.equal(nextTreeItemIndex([], 0, "ArrowDown"), null);
});
