import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../viewer/src/App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../viewer/styles/workspace-refactor.css", import.meta.url), "utf8");

test("workspace panel widths have one owner and the topbar consumes those canonical variables", () => {
	assert.match(app, /"--detail-w"/);
	assert.match(app, /"--spec-w"/);
	assert.match(app, /has-detail-panel/);
	assert.match(styles, /\.topbar-graph\.has-detail-panel:not\(\.has-spec-nav\)[\s\S]*?var\(--detail-w\)/);
	assert.match(styles, /\.topbar-graph\.has-spec-nav[\s\S]*?var\(--spec-w\)/);
	assert.doesNotMatch(`${app}\n${styles}`, /--code-topbar-panel-w/);
});
