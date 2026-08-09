import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { resolveGraphBrainProjectRoot } from "../core/source/project-root.js";

test("release runtime resolves live project data only through explicit GB_PROJECT_ROOT", () => {
	const previous = process.env.GB_PROJECT_ROOT;
	try {
		process.env.GB_PROJECT_ROOT = "G:/explicit/graphbrain";
		assert.equal(resolveGraphBrainProjectRoot(import.meta.url, ".."), resolve("G:/explicit/graphbrain"));
	} finally {
		if (previous === undefined) delete process.env.GB_PROJECT_ROOT;
		else process.env.GB_PROJECT_ROOT = previous;
	}
});

test("source execution retains the deterministic import-relative fallback", () => {
	const previous = process.env.GB_PROJECT_ROOT;
	try {
		delete process.env.GB_PROJECT_ROOT;
		assert.equal(resolveGraphBrainProjectRoot(import.meta.url, ".."), resolve("tests", ".."));
	} finally {
		if (previous !== undefined) process.env.GB_PROJECT_ROOT = previous;
	}
});
