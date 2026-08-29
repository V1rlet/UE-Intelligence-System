import assert from "node:assert/strict";
import test from "node:test";
import { nextMenuItemIndex } from "../viewer/components/common/menuNavigation.js";

test("menu navigation wraps vertically and supports Home and End", () => {
	assert.equal(nextMenuItemIndex(0, 3, "ArrowUp"), 2);
	assert.equal(nextMenuItemIndex(2, 3, "ArrowDown"), 0);
	assert.equal(nextMenuItemIndex(1, 3, "Home"), 0);
	assert.equal(nextMenuItemIndex(1, 3, "End"), 2);
});

test("menu navigation ignores unrelated keys and invalid collections", () => {
	assert.equal(nextMenuItemIndex(1, 3, "ArrowRight"), null);
	assert.equal(nextMenuItemIndex(-1, 3, "ArrowDown"), null);
	assert.equal(nextMenuItemIndex(0, 0, "ArrowDown"), null);
});
