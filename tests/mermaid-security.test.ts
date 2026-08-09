import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("Mermaid HTML injection keeps strict rendering and abortable source loading", () => {
	const source = readFileSync(resolve("viewer/components/mermaid/MermaidModal.tsx"), "utf8");
	assert.match(source, /securityLevel:\s*"strict"/);
	assert.match(source, /apiFetchText\([^\n]+\{ signal: controller\.signal \}/);
	assert.match(source, /controller\.abort\(\)/);
});
