/**
 * Accurate annotations (owner 2026-11-19: marks "land in a completely different position"). A model is good at
 * choosing WHAT to mark and bad at guessing coordinates, so the marker names the words to mark (a short quote from
 * the page) and this module finds those words in the PDF's own text layout and draws the mark around them.
 * Pure: page text runs (fractions of the page) in, marks out.
 */
import type { Mark, MarkKind } from "./notes.ts";

/** One run of text on a page; the box is in fractions of the page (0 = left/top, 1 = right/bottom). */
export interface TextRun { text: string; x: number; y: number; w: number; h: number }
export interface Box { x: number; y: number; w: number; h: number }

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Where a quote sits on the page: the union box of the runs that contain it (matching ignores case, accents,
 * punctuation and spacing; a phrase may span several runs and lines). Falls back to the longest leading part of
 * the quote that still matches (at least 3 words, or the whole quote if shorter). Null when it is not there.
 */
export function locateQuote(runs: readonly TextRun[], quote: string): Box | null {
	const words = norm(quote).split(" ").filter(Boolean);
	if (!words.length || !runs.length) return null;
	// One normalized stream of the page with, for each character, the run it came from.
	let stream = "";
	const owner: number[] = [];
	runs.forEach((r, i) => {
		const t = norm(r.text);
		if (!t) return;
		if (stream) { stream += " "; owner.push(i); }
		for (const ch of t) { stream += ch; owner.push(i); }
	});
	const find = (n: number): Box | null => {
		const needle = words.slice(0, n).join(" ");
		let at = stream.indexOf(needle);
		// Prefer a whole-word match.
		while (at > 0 && /[\p{L}\p{N}]/u.test(stream[at - 1]!)) at = stream.indexOf(needle, at + 1);
		if (at < 0) return null;
		const used = new Set(owner.slice(at, at + needle.length));
		const boxes = [...used].map((i) => runs[i]!);
		const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
		return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
	};
	for (let n = words.length; n >= Math.min(3, words.length); n--) {
		const box = find(n);
		if (box) return box;
	}
	return null;
}

export interface MarkPick { quote: string; kind: MarkKind; label?: string }

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** Turn the marker's picks into marks placed exactly on the quoted words (picks not found are dropped). At most `max`. */
export function marksFromQuotes(runs: readonly TextRun[], picks: readonly MarkPick[], max = 2): Mark[] {
	const out: Mark[] = [];
	for (const pick of picks) {
		if (out.length >= max) break;
		const box = locateQuote(runs, pick.quote);
		if (!box) continue;
		const pad = 0.006;
		const b = { x: clamp(box.x - pad), y: clamp(box.y - pad), w: Math.min(1, box.w + pad * 2), h: Math.min(1, box.h + pad * 2) };
		const label = pick.label?.trim().slice(0, 40) || undefined;
		if (pick.kind === "arrow" || pick.kind === "label") {
			// The arrow points at the left middle of the words from the nearer margin; the label rides on its tail.
			const fromLeft = b.x > 0.25;
			const tipX = fromLeft ? b.x : clamp(b.x + b.w);
			const tipY = clamp(b.y + b.h / 2);
			out.push({ kind: "arrow", x: tipX, y: tipY, fromX: fromLeft ? clamp(b.x - 0.14) : clamp(b.x + b.w + 0.14), fromY: clamp(tipY - 0.06), ...(label ? { label } : {}) });
		} else {
			out.push({ kind: pick.kind, ...b, ...(label && pick.kind === "circle" ? { label } : {}) });
		}
	}
	return out;
}
