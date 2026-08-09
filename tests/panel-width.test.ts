// Graph Brain / tests - 面板分隔器键盘调整语义
import assert from "node:assert/strict";
import test from "node:test";
import { resizedPanelWidth } from "../viewer/src/usePanelWidth";

test("左侧面板向右增宽、向左减宽，并受边界约束", () => {
	assert.equal(resizedPanelWidth(300, "ArrowRight", 240, 480, "left"), 316);
	assert.equal(resizedPanelWidth(300, "ArrowLeft", 240, 480, "left"), 284);
	assert.equal(resizedPanelWidth(245, "ArrowLeft", 240, 480, "left"), 240);
});

test("右侧面板方向相反，Home 与 End 直达边界", () => {
	assert.equal(resizedPanelWidth(380, "ArrowLeft", 300, 680, "right"), 396);
	assert.equal(resizedPanelWidth(380, "ArrowRight", 300, 680, "right"), 364);
	assert.equal(resizedPanelWidth(380, "Home", 300, 680, "right"), 300);
	assert.equal(resizedPanelWidth(380, "End", 300, 680, "right"), 680);
	assert.equal(resizedPanelWidth(380, "Enter", 300, 680, "right"), null);
});

test("按住 Shift 时以 160px 粗调，并继续受边界约束", () => {
	assert.equal(resizedPanelWidth(300, "ArrowRight", 240, 480, "left", true), 460);
	assert.equal(resizedPanelWidth(380, "ArrowLeft", 300, 480, "right", true), 480);
});
