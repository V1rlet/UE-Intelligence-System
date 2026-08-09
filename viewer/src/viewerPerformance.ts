export const VIEWER_PERFORMANCE_NAMES = {
	projectionStart: "graphbrain:projection-start",
	projectionDownload: "graphbrain:projection-download",
	projectionParse: "graphbrain:projection-parse",
	projectionLayout: "graphbrain:projection-layout",
	projectionInteractive: "graphbrain:projection-interactive",
} as const;

export const VIEWER_PERFORMANCE_BUDGETS = {
	/** Fresh-profile Vite resource timing uses decoded source-module bytes, not production gzip. */
	projectRelationColdScriptBytes: 9_000_000,
	/** Requested production assets are gzipped from the exact built files seen by Chrome. */
	productionRoutes: {
		home: { scriptGzipBytes: 120 * 1024, staticGzipBytes: 165 * 1024, longestTaskMs: 300 },
		changes: { scriptGzipBytes: 135 * 1024, staticGzipBytes: 180 * 1024, longestTaskMs: 400 },
		projectRelations: { scriptGzipBytes: 300 * 1024, staticGzipBytes: 350 * 1024, longestTaskMs: 800 },
	},
	changeScaleFacts: 50_000,
	changeScaleInteractiveMs: 5_000,
	changeScaleFilterMs: 1_500,
	changeScaleDomElements: 5_000,
	changeScaleHeapBytes: 256 * 1024 * 1024,
	projectionBytes: 64 * 1024,
	projectionDownloadMs: 1_500,
	projectionParseMs: 100,
	projectionLayoutMs: 1_000,
	projectionInteractiveMs: 2_500,
} as const;

function canMeasure(): boolean {
	return typeof performance !== "undefined" && typeof performance.measure === "function";
}

export function startProjectionTrace(file: string): void {
	if (!canMeasure()) return;
	performance.clearMarks(VIEWER_PERFORMANCE_NAMES.projectionStart);
	performance.clearMeasures(VIEWER_PERFORMANCE_NAMES.projectionDownload);
	performance.clearMeasures(VIEWER_PERFORMANCE_NAMES.projectionParse);
	performance.clearMeasures(VIEWER_PERFORMANCE_NAMES.projectionLayout);
	performance.clearMeasures(VIEWER_PERFORMANCE_NAMES.projectionInteractive);
	performance.mark(VIEWER_PERFORMANCE_NAMES.projectionStart, { detail: { file } });
}

export function cancelProjectionTrace(): void {
	if (!canMeasure()) return;
	performance.clearMarks(VIEWER_PERFORMANCE_NAMES.projectionStart);
}

export function hasActiveProjectionTrace(): boolean {
	return canMeasure() && performance.getEntriesByName(VIEWER_PERFORMANCE_NAMES.projectionStart, "mark").length > 0;
}

export function recordViewerPerformance(name: string, start: number, end: number, detail?: Record<string, unknown>): void {
	if (!canMeasure()) return;
	performance.clearMeasures(name);
	performance.measure(name, { start, end, detail });
}

export function completeProjectionInteractive(detail?: Record<string, unknown>): void {
	if (!canMeasure()) return;
	const start = performance.getEntriesByName(VIEWER_PERFORMANCE_NAMES.projectionStart, "mark").at(-1);
	if (!start) return;
	recordViewerPerformance(VIEWER_PERFORMANCE_NAMES.projectionInteractive, start.startTime, performance.now(), detail);
	performance.clearMarks(VIEWER_PERFORMANCE_NAMES.projectionStart);
}
