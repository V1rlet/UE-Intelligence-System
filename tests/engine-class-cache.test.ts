import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	loadEngineClassDiskCache,
	storeEngineClassDiskCache,
	type ElementsIncrement,
} from "../adapters/ue5-code/engine-class-service";

test("engine class parse results persist locally and invalidate when a header changes", (context) => {
	const root = mkdtempSync(join(tmpdir(), "graphbrain-engine-cache-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const engineRoot = join(root, "UE_5.8");
	const header = join(engineRoot, "Engine", "Source", "Runtime", "Core", "Public", "CachedType.h");
	const cacheDir = join(root, "cache");
	mkdirSync(join(engineRoot, "Engine", "Source", "Runtime", "Core", "Public"), { recursive: true });
	writeFileSync(header, "class UCachedType {};", { encoding: "utf8", flag: "w" });
	const increment: ElementsIncrement = { nodes: [], edges: [], resolved: ["UCachedType"], cached: false };

	storeEngineClassDiskCache(engineRoot, "UCachedType", undefined, [header], increment, cacheDir);
	const hit = loadEngineClassDiskCache(engineRoot, "UCachedType", undefined, cacheDir);
	assert.deepEqual(hit?.resolved, ["UCachedType"]);
	assert.equal(hit?.cached, true);

	writeFileSync(header, "class UCachedType { int Changed; };", "utf8");
	assert.equal(loadEngineClassDiskCache(engineRoot, "UCachedType", undefined, cacheDir), null);
});
