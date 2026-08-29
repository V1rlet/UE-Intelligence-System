import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	confirmDiscardUnsavedChanges,
	guardedWorkspaceSwitch,
	hasUnsavedChanges,
	registerUnsavedChanges,
} from "../viewer/src/unsavedChanges";

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

test("guardedWorkspaceSwitch：无草稿直接应用；有草稿由确认结果决定（F3 回归）", () => {
	let applied = 0;
	const apply = () => { applied += 1; };
	guardedWorkspaceSwitch(apply, () => false);
	assert.equal(applied, 1, "无草稿时不需要确认");

	let dirty = false;
	const unregister = registerUnsavedChanges(() => dirty);
	dirty = true;
	guardedWorkspaceSwitch(apply, () => false);
	assert.equal(applied, 1, "拒绝确认时切换不得应用");
	guardedWorkspaceSwitch(apply, () => true);
	assert.equal(applied, 2, "确认后切换必须应用");
	unregister();
});

test("App 侧绕过 navigateView 的切换路径全部接入守卫（F3 回归）", () => {
	const source = readFileSync(new URL("../viewer/src/App.tsx", import.meta.url), "utf8");
	// 直改 view 的两个残余按钮（错误横幅返回首页、架构 tab）必须经守卫。
	assert.match(source, /guardedWorkspaceSwitch\(\(\) => \{ setRouteIssue\(null\); setView\("home"\); \}\)/);
	assert.match(source, /guardedWorkspaceSwitch\(\(\) => setView\("architecture"\)\)/);
	// source/lens 切换与文件切换（openDocument）必须先过 confirmDiscardUnsavedChanges / guardedWorkspaceSwitch。
	assert.match(source, /const next = changeCodeSource\(codeWorkspace, source\);[\s\S]*?if \(!confirmDiscardUnsavedChanges\(\)\) return;/);
	assert.match(source, /const next = changeCodeLens\(codeWorkspace, lens\);[\s\S]*?if \(!confirmDiscardUnsavedChanges\(\)\) return;/);
	assert.match(source, /guardedWorkspaceSwitch\(\(\) => \{\s*setCurrentFile\(file\);/);
	// popstate 不可阻断，但离开编辑态工作区必须至少提示一次。
	assert.match(source, /hadUnsavedDraft && \(link\.view !== "code" \|\| \(link\.file \?\? currentFile\) !== currentFile\)/);
});
