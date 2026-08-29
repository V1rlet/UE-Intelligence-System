import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("catalog refresh rejects superseded completions and cancels on unmount", () => {
	const source = readFileSync(new URL("../viewer/src/useGraphDocument.ts", import.meta.url), "utf8");
	assert.match(source, /new LatestRequestGate\(\)/);
	assert.match(source, /signal: controller\.signal/);
	assert.match(source, /isCurrent\(controller\)/);
	assert.match(source, /finish\(controller\)/);
	assert.match(source, /return \(\) => catalogRequest\.current\.cancel\(\)/);
	assert.match(source, /setCatalogRefreshing\(true\)/);
	assert.match(source, /if \(catalogRequest\.current\.finish\(controller\)\) \{[\s\S]*setCatalogRefreshing\(false\)/);
	const home = readFileSync(new URL("../viewer/components/home/HomeView.tsx", import.meta.url), "utf8");
	assert.match(home, /disabled=\{refreshing\}/);
	assert.match(home, /aria-busy=\{refreshing\}/);
});

test("change-report catalog and report bodies reject stale completions independently", () => {
	const source = readFileSync(new URL("../viewer/components/changes/ChangesView.tsx", import.meta.url), "utf8");
	assert.match(source, /catalogRequest = useRef\(new LatestRequestGate\(\)\)/);
	assert.match(source, /reportRequest = useRef\(new LatestRequestGate\(\)\)/);
	assert.match(source, /catalogRequest\.current\.isCurrent\(controller\)/);
	assert.match(source, /reportRequest\.current\.isCurrent\(controller\)/);
	assert.match(source, /setRetrySequence\(\(value\) => value \+ 1\)/);
	assert.match(source, /重新加载/);
});

test("engine parser cleanup cannot retire a newer request with the same key", () => {
	const source = readFileSync(new URL("../viewer/src/useEngineClassParser.ts", import.meta.url), "utf8");
	assert.match(source, /sourceGeneration\.current \+= 1;[\s\S]*request\.controller\.abort\(\);[\s\S]*parseRequests\.current\.clear\(\);/);
	assert.match(source, /parseRequests\.current\.get\(key\) === request/);
	assert.match(source, /\{ signal: controller\.signal \}/);
});

test("engine class selection rejects late completion from an older user choice", () => {
	const source = readFileSync(new URL("../viewer/components/api-view/ApiReferenceView.tsx", import.meta.url), "utf8");
	assert.match(source, /classSelectionSequence = useRef\(0\)/);
	assert.match(source, /const selection = \+\+classSelectionSequence\.current/);
	assert.match(source, /selection !== classSelectionSequence\.current/);
});

test("confirm-dialog timers and resolvers are scoped to one request identity", () => {
	const source = readFileSync(new URL("../viewer/components/common/ConfirmDialog.tsx", import.meta.url), "utf8");
	assert.match(source, /window\.clearTimeout\(closeTimer\.current\)/);
	assert.match(source, /if \(closeStarted\.current\) return/);
	assert.match(source, /pending\.id !== id/);
	assert.match(source, /<ConfirmDialog key=\{request\.id\}/);
	assert.match(source, /const titleId = useId\(\)/);
	assert.match(source, /aria-labelledby=\{titleId\}/);
});

test("favorite writes require canonical kind and source instead of guessing defaults", () => {
	const source = readFileSync(new URL("../viewer/components/api-view/useFavorites.ts", import.meta.url), "utf8");
	assert.match(source, /type Favorite = ReadingFavorite/);
	assert.match(source, /toggleFavorite: \(id: string, details: FavoriteInput\)/);
	assert.doesNotMatch(source, /details\.kind \?\? "function"|details\.source \?\?/);
});

test("clearing the selected graph atomically retires all observable old-file state", () => {
	const source = readFileSync(new URL("../viewer/src/useGraphFile.ts", import.meta.url), "utf8");
	const emptyBranch = source.match(/if \(!currentFile\) \{([\s\S]*?)\n\t\t\}/)?.[1] ?? "";
	for (const reset of [
		"setGraph(null)",
		"setLoadedGraphFile(null)",
		"setLoadedGraphMode(null)",
		'setCompatibility("current")',
		"setGraphLoading(false)",
		"setGraphLoadError(null)",
	]) assert.ok(emptyBranch.includes(reset), `missing empty-file reset: ${reset}`);
});

test("reading-context callers explicitly accept and reconcile 409 responses", () => {
	for (const path of [
		"../viewer/components/api-view/useFavorites.ts",
		"../viewer/components/annotation-panel/AnnotationPanel.tsx",
	]) {
		const source = readFileSync(new URL(path, import.meta.url), "utf8");
		assert.match(source, /acceptStatuses: READING_CONTEXT_ACCEPT_STATUSES/, path);
		assert.match(source, /status === READING_CONTEXT_CONFLICT_STATUS/, path);
		assert.match(source, /readingContextRevisionOf/, path);
	}
});

test("reading-context writes ignore responses from retired domains and node scopes", () => {
	const favorites = readFileSync(new URL("../viewer/components/api-view/useFavorites.ts", import.meta.url), "utf8");
	assert.match(favorites, /operationSequence/);
	assert.match(favorites, /activeDomain\.current === requestDomain/);
	assert.match(favorites, /if \(!isCurrentWrite\(\)\) return/);
	const annotations = readFileSync(new URL("../viewer/components/annotation-panel/AnnotationPanel.tsx", import.meta.url), "utf8");
	assert.match(annotations, /writeSequenceRef/);
	assert.match(annotations, /writeScopeRef\.current === requestScope/);
	assert.match(annotations, /if \(!isCurrentWrite\(\)\) return false/);
});
