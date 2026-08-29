import assert from "node:assert/strict";
import test from "node:test";
import { APP_SHORTCUT_BLOCKER_SELECTOR, hasAppShortcutBlocker, resolveAppShortcut, resolveGraphShortcut } from "../viewer/src/appShortcuts.js";

test("global shortcuts resolve through the visible shortcut catalog", () => {
	assert.equal(resolveAppShortcut({ key: "0" }), "overview");
	assert.equal(resolveAppShortcut({ key: "1" }), "exploreArchitecture");
	assert.equal(resolveAppShortcut({ key: "2" }), "exploreRelations");
	assert.equal(resolveAppShortcut({ key: "3" }), "changes");
	assert.equal(resolveAppShortcut({ key: "4" }), "exploreApi");
	assert.equal(resolveAppShortcut({ key: "/" }), "search");
	assert.equal(resolveAppShortcut({ key: "?" }), "help");
	assert.equal(resolveAppShortcut({ key: "F" }), null);
});

test("browser combinations, editors, handled events and modals retain keyboard ownership", () => {
	assert.equal(resolveAppShortcut({ key: "1", ctrlKey: true }), null);
	assert.equal(resolveAppShortcut({ key: "2", altKey: true }), null);
	assert.equal(resolveAppShortcut({ key: "3", metaKey: true }), null);
	assert.equal(resolveAppShortcut({ key: "4", defaultPrevented: true }), null);
	assert.equal(resolveAppShortcut({ key: "0", typing: true }), null);
	assert.equal(resolveAppShortcut({ key: "?", blocked: true }), null);
	assert.equal(resolveAppShortcut({ key: "?", blocked: false }), "help");
});

test("graph shortcuts share the catalog and reject modified or externally owned keys", () => {
	assert.equal(resolveGraphShortcut({ key: "Enter" }), "open");
	assert.equal(resolveGraphShortcut({ key: "Escape" }), "exit");
	assert.equal(resolveGraphShortcut({ key: "F" }), "fit");
	assert.equal(resolveGraphShortcut({ key: "+" }), "zoomIn");
	assert.equal(resolveGraphShortcut({ key: "-" }), "zoomOut");
	assert.equal(resolveGraphShortcut({ key: "ContextMenu" }), "menu");
	assert.equal(resolveGraphShortcut({ key: "F10", shiftKey: true }), "menu");
	assert.equal(resolveGraphShortcut({ key: "F10" }), null);
	assert.equal(resolveGraphShortcut({ key: "+", ctrlKey: true }), null);
	assert.equal(resolveGraphShortcut({ key: "Escape", defaultPrevented: true }), null);
	assert.equal(resolveGraphShortcut({ key: "2" }), null);
});

test("one selector centralizes modal and transient-surface shortcut ownership", () => {
	let received = "";
	assert.equal(hasAppShortcutBlocker({ querySelector: (selector: string) => {
		received = selector;
		return {} as Element;
	} }), true);
	assert.equal(received, APP_SHORTCUT_BLOCKER_SELECTOR);
	assert.match(received, /aria-modal/);
	assert.match(received, /data-app-shortcuts/);
});
