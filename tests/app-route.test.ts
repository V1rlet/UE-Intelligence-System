import assert from "node:assert/strict";
import test from "node:test";
import type { ChangeReport } from "../core/query/change-report";
import {
	buildAppSearch,
	changeNodesInRouteScope,
	normalizeChangeRouteForCatalog,
	normalizeChangeRouteForReport,
	resolveAppDeepLink,
	type ChangeEvidenceRoute,
} from "../viewer/src/appRoute";

function changeReportFixture(): ChangeReport {
	return {
		format_version: 1,
		domain: "ue5_code",
		subsystem: "fixture",
		generated_at: "2026-08-09T00:00:00.000Z",
		generator: "test",
		baseline: { file: "before.json", generated_at: null, fingerprint: null },
		current: { file: "after.json", generated_at: null, fingerprint: null },
		summary: {
			nodes: { added: 3, removed: 0, changed: 0 },
			edges: { added: 0, removed: 0, changed: 0 },
			direct_nodes: 3,
			affected_nodes: 0,
			affected_modules: 2,
		},
		changes: {
			added_nodes: [
				{ id: "CoreType", label: "CoreType", type: "uclass", module: "Core", source_path: "CoreType.h" },
				{ id: "UiFunction", label: "UiFunction", type: "ufunction", module: "UI", source_path: "UiFunction.h" },
				{ id: "CoreFolder", label: "Core", type: "folder", module: "Core", source_path: "Core" },
			],
			removed_nodes: [],
			changed_nodes: [],
			added_edges: [],
			removed_edges: [],
			changed_edges: [],
		},
		impact: {
			direct_node_ids: ["CoreFolder", "CoreType", "UiFunction"],
			affected_node_ids: [],
			modules: [{ module: "Core", direct: 2, affected: 0 }, { module: "UI", direct: 1, affected: 0 }],
		},
	};
}

test("retired authoring routes converge on home without carrying deleted file targets", () => {
	for (const view of ["design-delivery", "delivery", "planning", "review", "docs"]) {
		const route = resolveAppDeepLink(`?view=${view}&file=level_design_demo.cyto.json&spec=old`);
		assert.equal(route.view, "home");
		assert.deepEqual(route.issue, { kind: "retired-view", value: view });
		assert.equal(route.file, null);
		assert.equal(route.spec, null);
	}
});

test("legacy design overlays retire at the same normalization boundary", () => {
	for (const search of [
		"?view=graph&design_delivery=open&file=level_design_demo.cyto.json",
		"?view=graph&mindmap=open&mindmap_kind=design",
	]) {
		const route = resolveAppDeepLink(search);
		assert.equal(route.view, "home");
		assert.deepEqual(route.issue, { kind: "retired-view", value: "design-authoring" });
	}
});

test("World Atlas and unknown views produce deterministic diagnostics", () => {
	const atlas = resolveAppDeepLink("?view=atlas&project=demo-facility");
	assert.equal(atlas.view, "home");
	assert.deepEqual(atlas.issue, { kind: "retired-view", value: "atlas" });
	const unknown = resolveAppDeepLink("?view=unknown");
	assert.equal(unknown.view, "home");
	assert.deepEqual(unknown.issue, { kind: "unknown-view", value: "unknown" });
});

test("current and legacy code architecture links retain their scope", () => {
	const current = resolveAppDeepLink("?view=architecture&scope=engine%2Fexecution");
	assert.equal(current.view, "architecture");
	assert.equal(current.architectureScope, "engine/execution");
	const legacy = resolveAppDeepLink("?view=graph&mindmap=open&mindmap_scope=business");
	assert.equal(legacy.view, "architecture");
	assert.equal(legacy.architectureScope, "business");
});

test("Overview / Explore / Changes are the canonical information architecture", () => {
	assert.equal(resolveAppDeepLink("?view=overview").view, "home");
	const architecture = resolveAppDeepLink("?view=explore&mode=architecture&scope=engine%2Fexecution");
	assert.equal(architecture.view, "architecture");
	assert.equal(architecture.architectureScope, "engine/execution");
	const relations = resolveAppDeepLink("?view=explore&mode=relations&source=engine");
	assert.deepEqual([relations.view, relations.codeSource, relations.codeLens], ["code", "engine", "relations"]);
	const api = resolveAppDeepLink("?view=explore&mode=api");
	assert.deepEqual([api.view, api.codeSource, api.codeLens], ["code", "all", "api"]);
	assert.equal(resolveAppDeepLink("?view=changes").view, "changes");
});

test("route writer converges legacy internal views onto canonical public URLs", () => {
	const common = { file: "project.cyto.json", codeSource: "project" as const, architectureScope: "root", spec: null };
	assert.equal(buildAppSearch({ ...common, view: "home", codeLens: "relations" }), "");
	assert.equal(buildAppSearch({ ...common, view: "architecture", codeLens: "relations" }), "?view=explore&mode=architecture");
	assert.equal(buildAppSearch({ ...common, view: "code", codeLens: "relations", spec: "A" }), "?view=explore&mode=relations&file=project.cyto.json&source=project&spec=A");
	assert.equal(buildAppSearch({ ...common, view: "changes", codeLens: "relations" }), "?view=changes");
});

test("legacy graph and API links converge on the canonical code workspace", () => {
	const project = resolveAppDeepLink("?view=graph&file=project.cyto.json");
	assert.equal(project.view, "code");
	assert.equal(project.codeSource, "project");
	assert.equal(project.codeLens, "relations");

	const engine = resolveAppDeepLink("?view=graph&file=project.cyto.json&spec_layer=engine");
	assert.equal(engine.view, "code");
	assert.equal(engine.codeSource, "engine");
	assert.equal(engine.codeLens, "relations");

	const api = resolveAppDeepLink("?view=api&file=project.cyto.json");
	assert.equal(api.view, "code");
	assert.equal(api.codeSource, "all");
	assert.equal(api.codeLens, "api");
	assert.equal(api.issue, null);
});

test("unsupported source and lens pairs normalize through one capability boundary", () => {
	const allRelations = resolveAppDeepLink("?view=code&source=all&lens=relations");
	assert.deepEqual([allRelations.codeSource, allRelations.codeLens], ["project", "relations"]);
	const projectSource = resolveAppDeepLink("?view=code&source=project&lens=source");
	assert.deepEqual([projectSource.codeSource, projectSource.codeLens], ["project", "relations"]);
	const engineRelations = resolveAppDeepLink("?view=code&source=engine&lens=relations");
	assert.deepEqual([engineRelations.codeSource, engineRelations.codeLens], ["engine", "relations"]);
	const legacyEngineSource = resolveAppDeepLink("?view=code&source=engine&lens=source");
	assert.deepEqual([legacyEngineSource.codeSource, legacyEngineSource.codeLens], ["engine", "relations"]);
});

test("versioned forest deep links retain only a stable branch id", () => {
	const branch = "dir:Source/Sabotage/UI";
	const route = resolveAppDeepLink(`?view=explore&mode=relations&source=project&forest_v=1&branch=${encodeURIComponent(branch)}`);
	assert.equal(route.forestBranch, branch);
	assert.equal(resolveAppDeepLink("?view=explore&mode=relations&source=project&forest_v=99&branch=dir%3ASource").forestBranch, null);
	assert.equal(buildAppSearch({
		view: "code",
		file: "project.cyto.json",
		codeSource: "project",
		codeLens: "relations",
		architectureScope: "root",
		spec: null,
		forestBranch: branch,
	}), `?view=explore&mode=relations&file=project.cyto.json&source=project&forest_v=1&branch=${encodeURIComponent(branch)}`);
});

test("versioned change evidence links retain stable report and node identities", () => {
	const search = "?view=changes&changes_v=1&report=project.change.json&tab=changed&fact=nodes&change_scope=all&module=Sabotage&type=uactor&node=ASabotageCharacter";
	const route = resolveAppDeepLink(search);
	assert.deepEqual(route.changes, {
		report: "project.change.json",
		tab: "changed",
		fact: "nodes",
		scope: "all",
		module: "Sabotage",
		nodeType: "uactor",
		node: "ASabotageCharacter",
	});
	assert.deepEqual(resolveAppDeepLink("?view=changes&changes_v=99&tab=removed&node=Old").changes, {
		report: null, tab: "added", fact: "nodes", scope: "code", module: null, nodeType: null, node: null,
	});
	assert.equal(buildAppSearch({
		view: "changes",
		file: null,
		codeSource: "project",
		codeLens: "relations",
		architectureScope: "root",
		spec: null,
		changes: route.changes,
	}), search);
});

test("change links reject unsupported, unversioned, and invalid state with explicit diagnostics", () => {
	const unsupported = resolveAppDeepLink("?view=changes&changes_v=99&tab=removed&node=Old");
	assert.equal(unsupported.changeDiagnostics[0]?.code, "unsupported-version");
	const unversioned = resolveAppDeepLink("?view=changes&tab=removed&node=Old");
	assert.equal(unversioned.changeDiagnostics[0]?.code, "unversioned-state");
	const invalid = resolveAppDeepLink("?view=changes&changes_v=1&tab=unknown&fact=other&change_scope=wide");
	assert.equal(invalid.changeDiagnostics[0]?.code, "invalid-parameter");
	assert.deepEqual(invalid.changes, {
		report: null, tab: "added", fact: "nodes", scope: "code", module: null, nodeType: null, node: null,
	});
});

test("change route normalization converges missing report, module, type, and node at one boundary", () => {
	const requested = resolveAppDeepLink("?view=changes&changes_v=1&report=missing.json&tab=changed&fact=edges&change_scope=all&module=Ghost&type=uactor&node=Old").changes;
	const catalog = normalizeChangeRouteForCatalog(requested, {
		default_report: "latest.json",
		reports: [{ file: "latest.json" }, { file: "older.json" }],
	});
	assert.equal(catalog.diagnostics[0]?.code, "missing-report");
	assert.deepEqual(catalog.route, {
		report: "latest.json", tab: "added", fact: "nodes", scope: "code", module: null, nodeType: null, node: null,
	});

	const report = changeReportFixture();
	const base: ChangeEvidenceRoute = { report: "latest.json", tab: "added", fact: "nodes", scope: "code", module: "Core", nodeType: "uclass", node: "CoreType" };
	const valid = normalizeChangeRouteForReport(base, report);
	assert.equal(valid.route, base);
	assert.deepEqual(valid.diagnostics, []);

	const missingModule = normalizeChangeRouteForReport({ ...base, module: "Ghost" }, report);
	assert.equal(missingModule.diagnostics[0]?.code, "missing-module");
	assert.deepEqual({ module: missingModule.route.module, type: missingModule.route.nodeType, node: missingModule.route.node }, { module: "*", type: null, node: null });

	const missingType = normalizeChangeRouteForReport({ ...base, nodeType: "uactor", node: null }, report);
	assert.equal(missingType.diagnostics[0]?.code, "missing-type");
	assert.equal(missingType.route.nodeType, null);

	const missingNode = normalizeChangeRouteForReport({ ...base, node: "Missing" }, report);
	assert.equal(missingNode.diagnostics[0]?.code, "missing-node");
	assert.equal(missingNode.route.node, null);
});

test("implicit module selection uses the same report resolver as the visible change list", () => {
	const report = changeReportFixture();
	const route: ChangeEvidenceRoute = { report: "latest.json", tab: "added", fact: "nodes", scope: "code", module: null, nodeType: null, node: null };
	assert.deepEqual(changeNodesInRouteScope(report, route).map((node) => node.id), ["CoreType"]);
	assert.deepEqual(changeNodesInRouteScope(report, { ...route, module: "*" }).map((node) => node.id), ["CoreType", "UiFunction"]);
});
