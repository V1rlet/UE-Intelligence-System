import assert from "node:assert/strict";
import test from "node:test";
import { clearLegacyBrowserFavorites, collectLegacyBrowserFavorites } from "../viewer/src/readingContextMigration";
import { loadPref, savePref, UI_PREFS_VERSION } from "../viewer/src/uiPrefs";

class MemoryStorage {
	private data = new Map<string, string>();
	getItem(key: string) { return this.data.get(key) ?? null; }
	setItem(key: string, value: string) { this.data.set(key, value); }
	removeItem(key: string) { this.data.delete(key); }
}

test("UI preferences migrate once from the unversioned key", () => {
	const storage = new MemoryStorage();
	Object.assign(globalThis, { localStorage: storage });
	storage.setItem("gb.legendCollapsed", "true");
	assert.equal(loadPref("legendCollapsed", false), true);
	assert.equal(storage.getItem("gb.legendCollapsed"), null);
	assert.equal(storage.getItem(`gb.ui.v${UI_PREFS_VERSION}.legendCollapsed`), "true");
});

test("legacy browser favorites migrate once without inventing quick-entry favorites", () => {
	const storage = new MemoryStorage();
	Object.assign(globalThis, { localStorage: storage });
	storage.setItem("gb-api-class-favorites", JSON.stringify([{ name: "AActor", source: "engine", module: "Engine" }]));
	storage.setItem("gb-api-function-favorite-refs", JSON.stringify([{ id: "AActor::Tick", label: "Tick", parent: "AActor", layer: "engine" }]));
	assert.deepEqual(collectLegacyBrowserFavorites(), [
		{ kind: "class", source: "engine", node_id: "AActor", module: "Engine" },
		{ kind: "function", source: "engine", node_id: "AActor::Tick", label: "Tick", parent_id: "AActor" },
	]);
	clearLegacyBrowserFavorites();
	assert.deepEqual(collectLegacyBrowserFavorites(), []);
});

test("current UI preferences round-trip without consulting legacy keys", () => {
	const storage = new MemoryStorage();
	Object.assign(globalThis, { localStorage: storage });
	storage.setItem("gb.hops", "1");
	savePref("hops", 3);
	assert.equal(loadPref("hops", 0), 3);
	assert.equal(storage.getItem("gb.hops"), "1");
});
