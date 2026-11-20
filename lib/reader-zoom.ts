/**
 * Pure zoom math for the in-app file reader. Kept out of the React component so
 * the step table, wheel mapping and cursor anchoring can be pinned by tests
 * (tests/reader-zoom.test.ts) without importing the client module graph.
 */

/** The toolbar's discrete zoom steps, as scale factors (25% … 500%). */
export const ZOOM_STEPS = [0.25, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5] as const;

export const MIN_SCALE = ZOOM_STEPS[0]!;
export const MAX_SCALE = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;

/** Continuous wheel zooms stay inside the same range as the presets. */
export function clampScale(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

/** First preset strictly above `scale` (or the ceiling). Pure. */
export function nextZoomStep(scale: number): number {
	const value = clampScale(scale);
	return ZOOM_STEPS.find((step) => step > value + 1e-6) ?? MAX_SCALE;
}

/** Last preset strictly below `scale` (or the floor). Pure. */
export function previousZoomStep(scale: number): number {
	const value = clampScale(scale);
	for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
		const step = ZOOM_STEPS[i]!;
		if (step < value - 1e-6) return step;
	}
	return MIN_SCALE;
}

/**
 * Wheel/pinch delta to a new scale. Pixel deltas use the app's existing
 * sensitivity (exp(-dy * 0.002), as in components/graph-canvas.ts); line and
 * page deltas are normalised to pixels first. Pure.
 */
export function wheelDeltaToScale(scale: number, deltaY: number, deltaMode = 0): number {
	const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 120 : deltaY;
	return clampScale(scale * Math.exp(-pixels * 0.002));
}

/**
 * New scroll offset on one axis that keeps `anchor` (the cursor's position
 * inside the scroll box) over the same document point as the scale changes:
 * content position = offset + anchor, so offset' = content * k - anchor.
 * Pure — the DOM clamps the result to its own scroll range.
 */
export function zoomAnchorOffset(scrollOffset: number, anchor: number, oldScale: number, newScale: number): number {
	if (!(oldScale > 0) || !(newScale > 0)) return scrollOffset;
	return (scrollOffset + anchor) * (newScale / oldScale) - anchor;
}

/** Toolbar label for any continuous scale (a fit width is rarely a preset). */
export function zoomPercent(scale: number): number {
	return Math.round(scale * 100);
}
