import assert from "node:assert/strict";
import test from "node:test";
import { appHistoryCommand } from "../viewer/src/appHistory.js";

test("top-level navigation pushes a new browser history entry", () => {
	assert.deepEqual(appHistoryCommand("/", "", "?view=changes", "push"), {
		method: "pushState",
		target: "?view=changes",
	});
});

test("within-workspace state replaces the current entry and no-op routes do not write", () => {
	assert.deepEqual(appHistoryCommand("/", "?view=changes", "?view=changes&changes_v=1&tab=changed", "replace"), {
		method: "replaceState",
		target: "?view=changes&changes_v=1&tab=changed",
	});
	assert.equal(appHistoryCommand("/", "?view=changes", "?view=changes", "push"), null);
	assert.equal(appHistoryCommand("/", "", "", "replace"), null);
});
