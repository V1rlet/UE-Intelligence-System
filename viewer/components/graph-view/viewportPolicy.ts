export const VIEWPORT_POLICY = {
	zoomStep: 1.22,
	wheelSensitivity: 1.3,
	hardMinZoom: 0.05,
	hardMaxZoom: 4,
	overviewMaxZoom: 1.12,
	focusMaxZoom: 1.35,
	focusReadableFloor: 0.82,
	focusStepMultiplier: 1.35,
	stableTapVisibleFraction: 0.66,
	locateReadableZoom: 0.95,
	sliderMinZoom: 0.25,
	sliderMaxZoom: 2,
} as const;

export interface RenderedBounds {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	w: number;
	h: number;
}

export function renderedVisibleFraction(bounds: RenderedBounds, viewportWidth: number, viewportHeight: number): number {
	if (![bounds.x1, bounds.y1, bounds.x2, bounds.y2, bounds.w, bounds.h, viewportWidth, viewportHeight].every(Number.isFinite)) return 0;
	const area = Math.max(0, bounds.w) * Math.max(0, bounds.h);
	if (area <= 0 || viewportWidth <= 0 || viewportHeight <= 0) return 0;
	const visibleWidth = Math.max(0, Math.min(bounds.x2, viewportWidth) - Math.max(bounds.x1, 0));
	const visibleHeight = Math.max(0, Math.min(bounds.y2, viewportHeight) - Math.max(bounds.y1, 0));
	return Math.max(0, Math.min(1, visibleWidth * visibleHeight / area));
}

export function shouldRecenterTappedNode(bounds: RenderedBounds, viewportWidth: number, viewportHeight: number): boolean {
	return renderedVisibleFraction(bounds, viewportWidth, viewportHeight) < VIEWPORT_POLICY.stableTapVisibleFraction;
}

export function fitZoomForBounds(
	viewportWidth: number,
	viewportHeight: number,
	boundsWidth: number,
	boundsHeight: number,
	padding: number,
): number {
	const availableWidth = Math.max(1, viewportWidth - Math.max(0, padding) * 2);
	const availableHeight = Math.max(1, viewportHeight - Math.max(0, padding) * 2);
	return Math.min(availableWidth / Math.max(boundsWidth, 1), availableHeight / Math.max(boundsHeight, 1));
}

export function boundedFocusZoom(currentZoom: number, neighborhoodFitZoom: number): number {
	if (!Number.isFinite(currentZoom) || !Number.isFinite(neighborhoodFitZoom)) return 1;
	const comfortableZoom = Math.min(
		VIEWPORT_POLICY.focusMaxZoom,
		Math.max(VIEWPORT_POLICY.focusReadableFloor, currentZoom * VIEWPORT_POLICY.focusStepMultiplier),
	);
	// 聚焦首先保证目标可读；邻域过大时允许裁掉远端，而不是把目标再次缩成全图概览。
	return clampManualZoom(Math.max(VIEWPORT_POLICY.focusReadableFloor, Math.min(neighborhoodFitZoom, comfortableZoom)));
}

export function boundedLocateZoom(currentZoom: number): number {
	if (!Number.isFinite(currentZoom)) return VIEWPORT_POLICY.locateReadableZoom;
	return clampManualZoom(Math.min(VIEWPORT_POLICY.focusMaxZoom, Math.max(VIEWPORT_POLICY.locateReadableZoom, currentZoom)));
}

export function clampOverviewZoom(zoom: number): number {
	if (!Number.isFinite(zoom)) return 1;
	return Math.max(VIEWPORT_POLICY.hardMinZoom, Math.min(zoom, VIEWPORT_POLICY.overviewMaxZoom));

}

export function clampManualZoom(zoom: number): number {
	if (!Number.isFinite(zoom)) return 1;
	return Math.max(VIEWPORT_POLICY.hardMinZoom, Math.min(zoom, VIEWPORT_POLICY.hardMaxZoom));
}
