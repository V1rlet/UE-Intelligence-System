import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
	changeCodeLens,
	changeCodeSource,
	codeLensCapabilities,
	codeSourceCapabilities,
	normalizeCodeWorkspace,
} from "../viewer/src/codeWorkspaceModel";

test("code workspace registry makes lens primary and source contextual", () => {
	assert.deepEqual(codeLensCapabilities().map((item) => item.id), ["relations", "api"]);
	assert.deepEqual(codeSourceCapabilities("relations").map((item) => item.id), ["project", "engine"]);
	assert.deepEqual(codeSourceCapabilities("api").map((item) => item.id), ["project", "engine", "all"]);
});

test("lens and source changes retain context only where it has meaning", () => {
	assert.deepEqual(changeCodeSource({ source: "all", lens: "api" }, "engine"), { source: "engine", lens: "api" });
	assert.deepEqual(changeCodeSource({ source: "project", lens: "relations" }, "engine"), { source: "engine", lens: "relations" });
	assert.deepEqual(changeCodeLens({ source: "engine", lens: "api" }, "relations"), { source: "engine", lens: "relations" });
	assert.deepEqual(changeCodeLens({ source: "all", lens: "api" }, "relations"), { source: "project", lens: "relations" });
	assert.deepEqual(normalizeCodeWorkspace("all", "relations"), { source: "project", lens: "relations" });
});

test("API is a code lens, with no duplicate rail, source tabs, or parser endpoint", () => {
	const app = readFileSync("viewer/src/App.tsx", "utf8");
	const apiView = readFileSync("viewer/components/api-view/ApiReferenceView.tsx", "utf8");
	const apiCatalog = readFileSync("viewer/components/api-view/ApiCatalogPane.tsx", "utf8");
	const engineParser = readFileSync("viewer/src/useEngineClassParser.ts", "utf8");
	const graphWorkspace = readFileSync("viewer/components/graph-view/GraphWorkspaceView.tsx", "utf8");
	assert.doesNotMatch(app, /rail-label">API</);
	assert.match(app, /codeLens === "api"/);
	assert.doesNotMatch(apiCatalog, /api-source-tabs/);
	assert.doesNotMatch(apiView, /\/api\/engine-class\//);
	assert.match(apiView, /engineParser\.parseClass/);
	assert.doesNotMatch(engineParser, /setGraph/);
	assert.match(graphWorkspace, /codeSource === "engine" \? engine\.elements : graph\.elements/);
});
