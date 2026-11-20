/** Pure placement maths for the knowledge graph's node card on Home. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CARD_WIDTH_PX, COMPOSER_GAP_PX, knowledgeCardPlacement, NARROW_BREAKPOINT_PX,
	SHEET_MAX_HEIGHT_FRACTION, TOP_OFFSET_PX,
} from "../components/study/knowledge-card-placement.ts";

const base = { viewportWidth: 1280, viewportHeight: 800, dockHeight: 120 };

describe("knowledgeCardPlacement — wide layout", () => {
	it("anchors the card top-left, clear of the top bar and the composer", () => {
		const p = knowledgeCardPlacement(base);
		assert.equal(p.narrow, false);
		assert.equal(p.top, TOP_OFFSET_PX); // top-14 = 56px
		assert.equal(p.bottom, null);
		assert.equal(p.left, 12); // left-3
		assert.equal(p.width, CARD_WIDTH_PX); // w-[380px]
		// max-height = 100% - 56px(top) - 120px(composer) - 24px(gap)
		assert.equal(p.maxHeight, 800 - 56 - 120 - 24);
	});

	it("shrinks the max-height as the composer grows, clamped at zero", () => {
		const zeroDock = knowledgeCardPlacement({ ...base, dockHeight: 0 });
		assert.equal(zeroDock.maxHeight, 800 - TOP_OFFSET_PX - COMPOSER_GAP_PX);
		const tallDock = knowledgeCardPlacement({ ...base, dockHeight: 800 });
		assert.equal(tallDock.maxHeight, 0);
	});

	it("caps the width on a viewport narrower than the card plus gutters", () => {
		const p = knowledgeCardPlacement({ ...base, viewportWidth: 900 });
		assert.equal(p.narrow, false);
		assert.equal(p.width, CARD_WIDTH_PX);
		const snug = knowledgeCardPlacement({ ...base, viewportWidth: 200 });
		assert.equal(snug.width, 200 - 24);
	});
});

describe("knowledgeCardPlacement — narrow layout", () => {
	it("switches to a bottom sheet strictly below 900px", () => {
		assert.equal(knowledgeCardPlacement({ ...base, viewportWidth: NARROW_BREAKPOINT_PX - 1 }).narrow, true);
		assert.equal(knowledgeCardPlacement({ ...base, viewportWidth: NARROW_BREAKPOINT_PX }).narrow, false);
	});

	it("places the sheet above the composer, full width minus 24px, capped at 45vh", () => {
		const p = knowledgeCardPlacement({ ...base, viewportWidth: 640 });
		assert.equal(p.narrow, true);
		assert.equal(p.top, null);
		assert.equal(p.bottom, 120 + 12); // --home-dock-h + 12px
		assert.equal(p.left, 12);
		assert.equal(p.width, 640 - 24);
		assert.equal(p.maxHeight, 800 * SHEET_MAX_HEIGHT_FRACTION);
	});

	it("tracks the composer height for the sheet's bottom offset", () => {
		const a = knowledgeCardPlacement({ ...base, viewportWidth: 500, dockHeight: 90 });
		const b = knowledgeCardPlacement({ ...base, viewportWidth: 500, dockHeight: 140 });
		assert.ok(a.bottom !== null && b.bottom !== null);
		assert.equal(b.bottom - a.bottom, 50);
	});
});

describe("knowledgeCardPlacement — degenerate input", () => {
	it("never returns negative geometry", () => {
		const p = knowledgeCardPlacement({ viewportWidth: 10, viewportHeight: 0, dockHeight: -5 });
		assert.equal(p.width, 0);
		assert.equal(p.maxHeight, 0);
		assert.equal(p.bottom, 12);
	});
});
