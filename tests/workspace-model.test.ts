import assert from "node:assert/strict";
import test from "node:test";
import { boundedFocusZoom, boundedLocateZoom, clampManualZoom, clampOverviewZoom, fitZoomForBounds, renderedVisibleFraction, shouldRecenterTappedNode, VIEWPORT_POLICY } from "../viewer/components/graph-view/viewportPolicy.js";
import { CODE_WORKSPACE_MODEL, isExistingSpec, selectExistingSpec } from "../viewer/src/workspaceModel.js";
import type { GraphCatalogEntry } from "../viewer/src/graphCatalog.js";

function entry(file: string, kind = "graph", subsystem = "project"): GraphCatalogEntry {
	return {
		file, domain: "ue5_code", kind, subsystem, title: file, stage: "classes", status: "", date: "", nodes: 1, edges: 0,
		updated_at: "", generated_at: null, generator: null, source_root: null,
		format_version: 2, provenance_status: "unknown", coverage_status: "unknown",
		coverage_discovered_files: null, coverage_consumed_files: null,
		coverage_skipped_files: null, coverage_failed_files: null,
		freshness: "unverified", freshness_reason: "missing-generated-at",
		source_file_count: null, source_files_newer: null, latest_source_at: null,
	};
}

test("workspace model declares one architecture knowledge role", () => {
	assert.deepEqual(CODE_WORKSPACE_MODEL.map((item) => item.id), ["architecture_knowledge"]);
	assert.deepEqual(CODE_WORKSPACE_MODEL[0].layers.map((layer) => layer.id), ["business", "engine"]);
});

test("class detail selection excludes mindmaps and references", () => {
	const catalog = [entry("reference.cyto.json", "reference", "framework"), entry("mindmap.cyto.json", "mindmap", "architecture-mindmap"), entry("project.cyto.json")];
	assert.equal(isExistingSpec(catalog[0]), false);
	assert.equal(selectExistingSpec(catalog, catalog[0].file)?.file, "project.cyto.json");
});

test("focus policy limits excessive zoom", () => {
	assert.equal(boundedFocusZoom(1, 4), VIEWPORT_POLICY.focusMaxZoom);
	assert.equal(boundedFocusZoom(.4, .5), VIEWPORT_POLICY.focusReadableFloor);
	assert.equal(boundedFocusZoom(3, 4), VIEWPORT_POLICY.focusMaxZoom);
	assert.equal(boundedLocateZoom(.4), VIEWPORT_POLICY.locateReadableZoom);
	assert.equal(boundedLocateZoom(3), VIEWPORT_POLICY.focusMaxZoom);
	assert.equal(clampOverviewZoom(1.55), VIEWPORT_POLICY.overviewMaxZoom);
	assert.equal(clampManualZoom(8), VIEWPORT_POLICY.hardMaxZoom);
	assert.equal(fitZoomForBounds(1000, 800, 400, 200, 100), 2);
});

test("mostly visible tapped nodes keep their rendered position for reliable double tap", () => {
	const mostlyVisible = { x1: -20, y1: 100, x2: 180, y2: 220, w: 200, h: 120 };
	const clipped = { x1: -150, y1: 100, x2: 50, y2: 220, w: 200, h: 120 };
	assert.equal(renderedVisibleFraction(mostlyVisible, 800, 600), .9);
	assert.equal(shouldRecenterTappedNode(mostlyVisible, 800, 600), false);
	assert.equal(shouldRecenterTappedNode(clipped, 800, 600), true);
});

test("all Cytoscape workspaces share the faster bounded wheel zoom policy", () => {
	assert.equal(VIEWPORT_POLICY.wheelSensitivity, 1.3);
	assert.ok(VIEWPORT_POLICY.wheelSensitivity > 1 && VIEWPORT_POLICY.wheelSensitivity < 1.5);
});
