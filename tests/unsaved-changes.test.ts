import assert from "node:assert/strict";
import test from "node:test";
import { confirmDiscardUnsavedChanges, hasUnsavedChanges, registerUnsavedChanges } from "../viewer/src/unsavedChanges";

test("未保存状态由编辑器注册，并在注销后消失", () => {
	let dirty = false;
	const unregister = registerUnsavedChanges(() => dirty);
	assert.equal(hasUnsavedChanges(), false);
	dirty = true;
	assert.equal(hasUnsavedChanges(), true);
	assert.equal(confirmDiscardUnsavedChanges(() => false), false);
	assert.equal(confirmDiscardUnsavedChanges(() => true), true);
	unregister();
	assert.equal(hasUnsavedChanges(), false);
});
