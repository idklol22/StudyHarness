import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldRenderMarkdown } from "../lib/reader-markdown.ts";
import {
	clampScale,
	MAX_SCALE,
	MIN_SCALE,
	nextZoomStep,
	previousZoomStep,
	wheelDeltaToScale,
	ZOOM_STEPS,
	zoomAnchorOffset,
	zoomPercent,
} from "../lib/reader-zoom.ts";

describe("reader zoom steps", () => {
	it("exposes the exact 25–500% preset ladder", () => {
		assert.deepEqual([...ZOOM_STEPS], [0.25, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]);
		assert.equal(MIN_SCALE, 0.25);
		assert.equal(MAX_SCALE, 5);
	});

	it("steps up to the next preset and clamps at 500%", () => {
		assert.equal(nextZoomStep(1), 1.1);
		assert.equal(nextZoomStep(1.1), 1.25);
		assert.equal(nextZoomStep(0.3), 0.5);
		assert.equal(nextZoomStep(5), 5);
		assert.equal(nextZoomStep(9), 5);
	});

	it("steps down to the previous preset and clamps at 25%", () => {
		assert.equal(previousZoomStep(1), 0.9);
		assert.equal(previousZoomStep(1.1), 1);
		assert.equal(previousZoomStep(0.3), 0.25);
		assert.equal(previousZoomStep(0.25), 0.25);
	});

	it("clamps arbitrary scales into the range", () => {
		assert.equal(clampScale(0.1), 0.25);
		assert.equal(clampScale(7), 5);
		assert.equal(clampScale(1.37), 1.37);
		assert.equal(clampScale(Number.NaN), 1);
	});

	it("formats the toolbar percentage label", () => {
		assert.equal(zoomPercent(0.67), 67);
		assert.equal(zoomPercent(1), 100);
		assert.equal(zoomPercent(5), 500);
		assert.equal(zoomPercent(0.4237), 42);
	});
});

describe("reader wheel zoom", () => {
	it("maps wheel delta to a scale with exponential sensitivity", () => {
		assert.equal(wheelDeltaToScale(1, 0), 1);
		assert.ok(Math.abs(wheelDeltaToScale(1, -100) - Math.exp(0.2)) < 1e-9);
		assert.ok(Math.abs(wheelDeltaToScale(1, 100) - Math.exp(-0.2)) < 1e-9);
		assert.ok(wheelDeltaToScale(1, -100) > 1);
		assert.ok(wheelDeltaToScale(1, 100) < 1);
	});

	it("clamps continuous zoom to the preset range", () => {
		assert.equal(wheelDeltaToScale(0.25, 500), 0.25);
		assert.equal(wheelDeltaToScale(5, -500), 5);
	});

	it("normalises line and page deltas to pixels", () => {
		assert.ok(Math.abs(wheelDeltaToScale(1, -3, 1) - wheelDeltaToScale(1, -48)) < 1e-9);
		assert.ok(wheelDeltaToScale(1, -1, 2) > wheelDeltaToScale(1, -1));
	});
});

describe("reader zoom toward cursor", () => {
	it("keeps the document point under the cursor fixed", () => {
		// offset 100 + anchor 200 = content x 300; doubling puts it at 600, so
		// the scroll offset must become 600 - 200 = 400.
		assert.equal(zoomAnchorOffset(100, 200, 1, 2), 400);
		assert.equal(zoomAnchorOffset(400, 200, 2, 1), 100);
	});

	it("leaves the offset alone when the scale is unchanged", () => {
		assert.equal(zoomAnchorOffset(137, 55, 1.5, 1.5), 137);
	});

	it("uses the scale ratio for non-integer scales from wheel zoom", () => {
		assert.ok(Math.abs(zoomAnchorOffset(0, 300, 1, 1.5) - 150) < 1e-9);
		assert.ok(Math.abs(zoomAnchorOffset(500, 120, 2, 1) - 190) < 1e-9);
	});
});

describe("reader Markdown-vs-plain detection", () => {
	it("renders .md, .markdown and extensionless notes as Markdown", () => {
		assert.equal(shouldRenderMarkdown("notes.md", "plain words"), true);
		assert.equal(shouldRenderMarkdown("notes.markdown", ""), true);
		assert.equal(shouldRenderMarkdown("Planner note", "just text"), true);
		assert.equal(shouldRenderMarkdown("Class inbox.md", "- [ ] task"), true);
	});

	it("falls back to plain text only for a .txt file with no Markdown syntax", () => {
		assert.equal(shouldRenderMarkdown("lecture.txt", "Just prose.\nAnother line."), false);
		assert.equal(shouldRenderMarkdown("notes.TXT", "123 456"), false);
	});

	it("still renders Markdown syntax found in a .txt file", () => {
		assert.equal(shouldRenderMarkdown("notes.txt", "# Heading\nText"), true);
		assert.equal(shouldRenderMarkdown("notes.txt", "- first\n- second"), true);
		assert.equal(shouldRenderMarkdown("notes.txt", "```js\nconst x = 1;\n```"), true);
		assert.equal(shouldRenderMarkdown("notes.txt", "| a | b |\n| - | - |"), true);
		assert.equal(shouldRenderMarkdown("notes.txt", "**bold** and `code`"), true);
		assert.equal(shouldRenderMarkdown("notes.txt", "The value is $x^2$ here."), true);
	});

	it("does not mistake ordinary prose for Markdown", () => {
		assert.equal(shouldRenderMarkdown("data.txt", "Costs $5 and $10 total."), false);
		assert.equal(shouldRenderMarkdown("data.txt", "some_var_name = 2 * 3 * 4"), false);
	});
});
