/** Region arithmetic behind `show_figure`: box passthrough, quote expansion, whole-page fallback. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { figureRegion } from "../src/core/study/figures.ts";
import type { TextRun } from "../src/core/study/text-boxes.ts";

const runs: TextRun[] = [
	{ text: "The recurrence is", x: 0.4, y: 0.5, w: 0.2, h: 0.03 },
	{ text: "on the next slide", x: 0.1, y: 0.7, w: 0.3, h: 0.03 },
];

const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} ≠ ${expected}`);
const regionIs = (actual: ReturnType<typeof figureRegion>, expected: { x: number; y: number; w: number; h: number; wholePage: boolean }) => {
	near(actual.x, expected.x, "x"); near(actual.y, expected.y, "y");
	near(actual.w, expected.w, "w"); near(actual.h, expected.h, "h");
	assert.equal(actual.wholePage, expected.wholePage);
};

describe("figureRegion", () => {
	it("passes a box through, clamped to the page", () => {
		regionIs(figureRegion(runs, { box: { x: 0.12, y: 0.2, w: 0.3, h: 0.4 } }), { x: 0.12, y: 0.2, w: 0.3, h: 0.4, wholePage: false });
		regionIs(figureRegion(runs, { box: { x: -0.1, y: 0.8, w: 1.5, h: 0.9 } }), { x: 0, y: 0.8, w: 1, h: 0.2, wholePage: false });
	});

	it("a box wins over a quote", () => {
		const box = { x: 0.05, y: 0.05, w: 0.25, h: 0.25 };
		regionIs(figureRegion(runs, { box, quote: "recurrence" }), { ...box, wholePage: false });
	});

	it("pads a located quote and grows a short region to a quarter page", () => {
		const region = figureRegion(runs, { quote: "The recurrence is" });
		regionIs(region, { x: 0.34, y: 0.39, w: 0.32, h: 0.25, wholePage: false });
	});

	it("keeps a tall quote's own height and stays on the page", () => {
		const tall: TextRun[] = [{ text: "A tall figure caption", x: 0.7, y: 0.7, w: 0.2, h: 0.15 }];
		const region = figureRegion(tall, { quote: "A tall figure caption" });
		regionIs(region, { x: 0.64, y: 0.64, w: 0.32, h: 0.27, wholePage: false });
		assert.ok(region.y + region.h <= 1 + 1e-9);
	});

	it("falls back to the whole page when the quote is missing or nothing was asked for", () => {
		assert.deepEqual(figureRegion(runs, { quote: "not on this page" }), { x: 0, y: 0, w: 1, h: 1, wholePage: true });
		assert.deepEqual(figureRegion(runs, {}), { x: 0, y: 0, w: 1, h: 1, wholePage: true });
		assert.deepEqual(figureRegion([], { quote: "recurrence" }), { x: 0, y: 0, w: 1, h: 1, wholePage: true });
	});
});
