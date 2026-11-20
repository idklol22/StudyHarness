/**
 * Where to crop a figure from a lecture page. Pure: page text runs and the
 * model's requested region in, one clamped region of the page out.
 *
 * A model is good at naming the diagram or the words beside it and bad at
 * guessing coordinates: `box` is used only when it was given, otherwise a
 * quote is found in the PDF's own text layout and opened up around the words.
 */
import { locateQuote, type Box, type TextRun } from "./text-boxes.ts";

/** 6% of the page on each side, and never less than a quarter page tall. */
const PAD = 0.06;
const MIN_HEIGHT = 0.25;

export interface FigureRegion extends Box {
	/** True when no usable region was found and the whole page must be shown. */
	wholePage: boolean;
}

const clamp = (n: number): number => Math.min(1, Math.max(0, n));

/** Clamp a box to the page, keeping its right/bottom edge inside it. */
function onPage(box: Box): Box {
	const x = clamp(box.x), y = clamp(box.y);
	return { x, y, w: Math.min(clamp(box.w), 1 - x), h: Math.min(clamp(box.h), 1 - y) };
}

/**
 * Resolve the region to crop: an explicit box wins; otherwise the quote is
 * located on the page, padded on every side and grown to at least 25% of the
 * page height without leaving the page. When neither is usable, the whole
 * page is returned with `wholePage: true`.
 */
export function figureRegion(runs: readonly TextRun[], input: { quote?: string; box?: Box }): FigureRegion {
	if (input.box) return { ...onPage(input.box), wholePage: false };
	const found = input.quote?.trim() ? locateQuote(runs, input.quote) : null;
	if (!found) return { x: 0, y: 0, w: 1, h: 1, wholePage: true };
	const region = onPage({ x: found.x - PAD, y: found.y - PAD, w: found.w + PAD * 2, h: found.h + PAD * 2 });
	let { y, h } = region;
	if (h < MIN_HEIGHT) {
		const center = y + h / 2;
		y = clamp(center - MIN_HEIGHT / 2);
		h = Math.min(MIN_HEIGHT, 1 - y);
		if (h < MIN_HEIGHT) { y = 1 - MIN_HEIGHT; h = MIN_HEIGHT; }
	}
	return { ...region, y, h, wholePage: false };
}
