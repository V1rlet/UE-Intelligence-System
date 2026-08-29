import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const homeCss = readFileSync(new URL("../viewer/styles/workspace-refactor.css", import.meta.url), "utf8");
const changesCss = readFileSync(new URL("../viewer/styles/changes.css", import.meta.url), "utf8");
const appCss = readFileSync(new URL("../viewer/styles/app.css", import.meta.url), "utf8");
const indexHtml = readFileSync(new URL("../viewer/index.html", import.meta.url), "utf8");

test("overview entries own a readable internal type scale without changing their grid", () => {
	for (const declaration of [
		"--home-entry-title-size: clamp(18px, 1.4vw, 22px)",
		"--home-entry-body-size: 13px",
		"--home-entry-meta-size: 11px",
		"--home-entry-micro-size: 10px",
	]) assert.equal(homeCss.includes(declaration), true, `missing overview type token: ${declaration}`);
	assert.match(homeCss, /\.home-reference-identity strong[^}]+var\(--home-entry-body-size\)/s);
	assert.match(homeCss, /\.home-primary-list \.home-project-evidence small[^}]+var\(--home-entry-meta-size\)/s);
});

test("change evidence entries do not fall back to the former 8px micro type", () => {
	for (const declaration of [
		"--changes-entry-title-size: 13px",
		"--changes-entry-body-size: 12px",
		"--changes-entry-meta-size: 11px",
		"--changes-entry-micro-size: 10px",
	]) assert.equal(changesCss.includes(declaration), true, `missing changes type token: ${declaration}`);
	assert.match(changesCss, /\.change-identity strong[^}]+var\(--changes-entry-title-size\)/s);
	assert.match(changesCss, /\.change-relation-node code[^}]+var\(--changes-entry-micro-size\)/s);
	assert.equal(/font-size:\s*(?:8(?:\.\d+)?|9(?:\.\d+)?)px/.test(changesCss), false, "changes entries still contain sub-10px text");
});

test("mobile shell owns dynamic viewport and safe-area navigation clearance", () => {
	assert.match(appCss, /--mobile-nav-clearance:\s*calc\(76px \+ env\(safe-area-inset-bottom, 0px\)\)/);
	assert.match(appCss, /@supports \(height: 100dvh\)/);
	assert.match(appCss, /padding-bottom:\s*var\(--mobile-nav-clearance\)/);
	assert.match(appCss, /bottom:\s*max\(8px, env\(safe-area-inset-bottom, 0px\)\)/);
	assert.match(indexHtml, /viewport-fit=cover/);
});

test("viewer shell exposes one keyboard skip target for every workspace", () => {
	const app = readFileSync(new URL("../viewer/src/App.tsx", import.meta.url), "utf8");
	assert.match(app, /className="skip-link" href="#main-content"/);
	assert.match(app, /<main id="main-content" tabIndex=\{-1\}/);
	assert.match(appCss, /\.skip-link:focus[^}]*transform:\s*none/);
	assert.match(app, /window\.document\.title = `\$\{helpSection \? "帮助中心" : currentPageLabel\} · GraphBrain`/);
	assert.match(app, /codeLensCapabilities\(\)\.find/);
});

test("overview search clear action remains a touch-sized visible control", () => {
	assert.match(homeCss, /\.home-catalog-search > button\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*32px/s);
});
