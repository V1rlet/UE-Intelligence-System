import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const homeCss = readFileSync(new URL("../viewer/styles/workspace-refactor.css", import.meta.url), "utf8");
const changesCss = readFileSync(new URL("../viewer/styles/changes.css", import.meta.url), "utf8");

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
