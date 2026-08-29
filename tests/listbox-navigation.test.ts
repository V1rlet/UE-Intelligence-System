import assert from "node:assert/strict";
import test from "node:test";
import { nextListboxOptionIndex } from "../viewer/components/common/listboxNavigation.js";

test("listbox navigation moves within visible bounds and supports Home and End", () => {
	assert.equal(nextListboxOptionIndex(0, 3, "ArrowUp"), 0);
	assert.equal(nextListboxOptionIndex(0, 3, "ArrowDown"), 1);
	assert.equal(nextListboxOptionIndex(2, 3, "ArrowDown"), 2);
	assert.equal(nextListboxOptionIndex(1, 3, "Home"), 0);
	assert.equal(nextListboxOptionIndex(1, 3, "End"), 2);
});

test("listbox navigation ignores unrelated keys and invalid collections", () => {
	assert.equal(nextListboxOptionIndex(1, 3, "ArrowRight"), null);
	assert.equal(nextListboxOptionIndex(-1, 3, "ArrowDown"), null);
	assert.equal(nextListboxOptionIndex(0, 0, "ArrowDown"), null);
});
