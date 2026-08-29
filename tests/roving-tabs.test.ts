import assert from "node:assert/strict";
import test from "node:test";
import { nextRovingTabIndex, rovingTabStop } from "../viewer/components/common/rovingTabs.js";

test("horizontal tab navigation wraps and supports Home and End", () => {
	assert.equal(nextRovingTabIndex(0, 3, "ArrowLeft"), 2);
	assert.equal(nextRovingTabIndex(2, 3, "ArrowRight"), 0);
	assert.equal(nextRovingTabIndex(1, 3, "Home"), 0);
	assert.equal(nextRovingTabIndex(1, 3, "End"), 2);
	assert.equal(nextRovingTabIndex(1, 3, "ArrowDown"), null);
});

test("only the selected tab participates in sequential keyboard focus", () => {
	assert.equal(rovingTabStop(true), 0);
	assert.equal(rovingTabStop(false), -1);
	assert.equal(nextRovingTabIndex(-1, 3, "ArrowRight"), null);
	assert.equal(nextRovingTabIndex(0, 0, "ArrowRight"), null);
});
