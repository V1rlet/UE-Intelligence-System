import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, "viewer", "dist");
const ASSETS = resolve(DIST, "assets");
const assets = readdirSync(ASSETS);

function onlyAsset(pattern, label) {
	const matches = assets.filter((name) => pattern.test(name));
	assert.equal(matches.length, 1, `${label} should have exactly one built asset; found ${matches.length}`);
	return matches[0];
}

const indexHtml = readFileSync(resolve(DIST, "index.html"), "utf8");
const architectureName = onlyAsset(/^ArchitectureWorkspace-.*\.js$/, "Architecture Workspace");
const architectureCssName = onlyAsset(/^ArchitectureWorkspace-.*\.css$/, "Architecture Workspace CSS");
const graphWorkspaceName = onlyAsset(/^GraphWorkspaceView-.*\.js$/, "Graph Workspace");

const retiredAssets = assets.filter((name) =>
	/WorldAtlas|world-atlas|DesignDelivery|design-delivery|QuestProgram|quest-program|level-design|narrative|ue5-planned|task-package|workflow|review-workspace|GraphTimeline|player-metrics|three(?:\.|-)/i.test(name),
);
assert.deepEqual(retiredAssets, [], `retired authoring assets leaked into production: ${retiredAssets.join(", ")}`);

const initialPreloads = [...indexHtml.matchAll(/rel="modulepreload"[^>]+href="\/assets\/([^"]+)"/g)]
	.map((match) => match[1]);
const initialForbidden = [
	/ArchitectureWorkspace-/,
	/GraphWorkspaceView-/,
	/ApiReferenceView-/,
	/ChangesView-/,
	/HelpCenter-/,
	/GraphView-/,
	/cytoscape/i,
	/mermaid/i,
];

for (const asset of [architectureName, architectureCssName, graphWorkspaceName]) {
	assert.equal(indexHtml.includes(asset), false, `initial HTML should not preload deferred workspace asset: ${asset}`);
}
for (const asset of initialPreloads) {
	assert.equal(
		initialForbidden.some((pattern) => pattern.test(asset)),
		false,
		`initial HTML should not preload heavyweight workspace asset: ${asset}`,
	);
}

assert.equal(assets.some((name) => /^GraphView-.*\.js$/.test(name)), true, "GraphView must remain deferred");
assert.equal(assets.some((name) => /cytoscape/i.test(name)), true, "Cytoscape must remain deferred");

function htmlAssets(pattern) {
	return [...indexHtml.matchAll(pattern)].map((match) => match[1]);
}

function bundleSize(names) {
	const unique = [...new Set(names)];
	return unique.reduce((sum, name) => {
		const content = readFileSync(resolve(ASSETS, name));
		return { raw: sum.raw + content.byteLength, gzip: sum.gzip + gzipSync(content).byteLength };
	}, { raw: 0, gzip: 0 });
}

function kib(bytes) {
	return (bytes / 1024).toFixed(1);
}

const entryScripts = htmlAssets(/<script[^>]+type="module"[^>]+src="\/assets\/([^"]+)"/g);
const initialStyles = htmlAssets(/<link[^>]+rel="stylesheet"[^>]+href="\/assets\/([^"]+)"/g);
const initialJs = bundleSize([...entryScripts, ...initialPreloads]);
const initialCss = bundleSize(initialStyles);

// These budgets describe the overview shell, not deferred graph/Mermaid workspaces.
// Keep enough headroom for ordinary maintenance while making regressions fail loudly.
assert.ok(initialJs.raw <= 320 * 1024, `initial JS raw budget exceeded: ${kib(initialJs.raw)} KiB > 320 KiB`);
assert.ok(initialJs.gzip <= 100 * 1024, `initial JS gzip budget exceeded: ${kib(initialJs.gzip)} KiB > 100 KiB`);
assert.ok(initialCss.gzip <= 40 * 1024, `initial CSS gzip budget exceeded: ${kib(initialCss.gzip)} KiB > 40 KiB`);
assert.ok(initialJs.gzip + initialCss.gzip <= 140 * 1024, `initial static gzip budget exceeded: ${kib(initialJs.gzip + initialCss.gzip)} KiB > 140 KiB`);

console.log(
	`[bundle-boundary] passed: ${initialPreloads.length} initial preloads; `
	+ `JS ${kib(initialJs.raw)} KiB raw/${kib(initialJs.gzip)} KiB gzip; `
	+ `CSS ${kib(initialCss.gzip)} KiB gzip; deferred workspaces and retired assets absent`,
);
