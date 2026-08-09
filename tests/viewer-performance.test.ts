import assert from "node:assert/strict";
import test from "node:test";
import { VIEWER_PERFORMANCE_BUDGETS, VIEWER_PERFORMANCE_NAMES } from "../viewer/src/viewerPerformance.js";

test("projection performance budgets and marks are explicit stable contracts", () => {
	assert.deepEqual(Object.keys(VIEWER_PERFORMANCE_NAMES).sort(), [
		"projectionDownload", "projectionInteractive", "projectionLayout", "projectionParse", "projectionStart",
	]);
	assert.equal(VIEWER_PERFORMANCE_BUDGETS.projectionBytes, 65_536);
	assert.ok(VIEWER_PERFORMANCE_BUDGETS.projectRelationColdScriptBytes <= 9_000_000);
	assert.equal(VIEWER_PERFORMANCE_BUDGETS.changeScaleFacts, 50_000);
	assert.ok(VIEWER_PERFORMANCE_BUDGETS.productionRoutes.home.staticGzipBytes < VIEWER_PERFORMANCE_BUDGETS.productionRoutes.projectRelations.staticGzipBytes);
	assert.ok(VIEWER_PERFORMANCE_BUDGETS.changeScaleFilterMs < VIEWER_PERFORMANCE_BUDGETS.changeScaleInteractiveMs);
	assert.ok(VIEWER_PERFORMANCE_BUDGETS.projectionParseMs < VIEWER_PERFORMANCE_BUDGETS.projectionLayoutMs);
	assert.ok(VIEWER_PERFORMANCE_BUDGETS.projectionLayoutMs < VIEWER_PERFORMANCE_BUDGETS.projectionInteractiveMs);
});
