import assert from "node:assert/strict";
import test from "node:test";
import {
	SMOKE_GOLDEN_DIRECTORY,
	SMOKE_RUNS_DIRECTORY,
	resolveSmokeOutputDirectory,
	smokeRunId,
} from "./smoke-artifacts.js";

function withEnvironment(values: Record<string, string | undefined>, action: () => void): void {
	const original = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
	try {
		for (const [key, value] of Object.entries(values)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		action();
	} finally {
		for (const [key, value] of Object.entries(original)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test("normal smoke artifacts are isolated under ignored run directories", () => {
	withEnvironment({ GB_SMOKE_OUTPUT_DIR: undefined, GB_SMOKE_UPDATE_GOLDEN: undefined }, () => {
		const output = resolveSmokeOutputDirectory("visual");
		assert.match(output, new RegExp(`^${SMOKE_RUNS_DIRECTORY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
		assert.notEqual(output, SMOKE_GOLDEN_DIRECTORY);
	});
});

test("golden output requires the explicit update capability", () => {
	withEnvironment({ GB_SMOKE_OUTPUT_DIR: SMOKE_GOLDEN_DIRECTORY, GB_SMOKE_UPDATE_GOLDEN: undefined }, () => {
		assert.throws(() => resolveSmokeOutputDirectory(), /拒绝覆盖 smoke 基准/);
	});
	withEnvironment({ GB_SMOKE_OUTPUT_DIR: SMOKE_GOLDEN_DIRECTORY, GB_SMOKE_UPDATE_GOLDEN: "1" }, () => {
		assert.equal(resolveSmokeOutputDirectory(), SMOKE_GOLDEN_DIRECTORY);
	});
});

test("smoke run identifiers are filesystem-safe and traceable", () => {
	assert.equal(smokeRunId("visual suite", new Date("2026-08-13T01:02:03.456Z"), 42), "2026-08-13T01-02-03-456Z-42-visual-suite");
});
