/**
 * Pure geometry for the knowledge graph's node card (the idea card and the
 * inline subject/topic scope card) on Home. No DOM, no React, no three.js.
 *
 * Wide (>= 900px): the card is pinned to the TOP-LEFT, just under the top bar,
 * and its max-height stops short of the bottom-centre chat composer.
 * Narrow (< 900px): the card is a bottom sheet ABOVE the composer, full width
 * minus the side gutters, capped at 45vh.
 *
 * The composer height is Home's measured `--home-dock-h`; it is passed in by
 * the caller so the decision and the max-height maths stay testable here.
 */

/** Below this viewport width the card becomes a bottom sheet. */
export const NARROW_BREAKPOINT_PX = 900;
/** `top-14` — the card clears the top bar. */
export const TOP_OFFSET_PX = 56;
/** `left-3` / `right-3` — the side gutter on both layouts. */
export const SIDE_GAP_PX = 12;
/** Wide: clearance between the card's bottom edge and the composer. */
export const COMPOSER_GAP_PX = 24;
/** Narrow: clearance between the sheet's bottom edge and the composer. */
export const SHEET_BOTTOM_GAP_PX = 12;
/** Narrow: 45vh expressed as a fraction. */
export const SHEET_MAX_HEIGHT_FRACTION = 0.45;
/** The wide card's width (Tailwind `w-[380px]`). */
export const CARD_WIDTH_PX = 380;

export interface KnowledgeCardPlacementInput {
	viewportWidth: number;
	viewportHeight: number;
	/** Height of the docked composer in px (Home's `--home-dock-h`). */
	dockHeight: number;
}

/** The resolved inline geometry for the card wrapper. */
export interface KnowledgeCardGeometry {
	/** True below {@link NARROW_BREAKPOINT_PX}: the card is a bottom sheet. */
	narrow: boolean;
	/** CSS `top` in px, or `null` when the card is anchored to the bottom. */
	top: number | null;
	/** CSS `bottom` in px, or `null` when the card is anchored to the top. */
	bottom: number | null;
	left: number;
	width: number;
	/** `max-height` in px, with internal scroll so the card never reaches the composer. */
	maxHeight: number;
}

/** Decide wide-vs-narrow and compute the card's offsets and max-height. */
export function knowledgeCardPlacement(input: KnowledgeCardPlacementInput): KnowledgeCardGeometry {
	const viewportWidth = Math.max(0, input.viewportWidth);
	const viewportHeight = Math.max(0, input.viewportHeight);
	const dockHeight = Math.max(0, input.dockHeight);
	if (viewportWidth < NARROW_BREAKPOINT_PX) {
		return {
			narrow: true,
			top: null,
			bottom: dockHeight + SHEET_BOTTOM_GAP_PX,
			left: SIDE_GAP_PX,
			width: Math.max(0, viewportWidth - SIDE_GAP_PX * 2),
			maxHeight: viewportHeight * SHEET_MAX_HEIGHT_FRACTION,
		};
	}
	return {
		narrow: false,
		top: TOP_OFFSET_PX,
		bottom: null,
		left: SIDE_GAP_PX,
		width: Math.min(CARD_WIDTH_PX, Math.max(0, viewportWidth - SIDE_GAP_PX * 2)),
		maxHeight: Math.max(0, viewportHeight - TOP_OFFSET_PX - dockHeight - COMPOSER_GAP_PX),
	};
}
