/**
 * Study notes (Phase E): iPad-style class-note pages. Pure data + deterministic layout.
 *
 * The agent writes SEMANTIC blocks (heading, text, bullets, box, sticky, steps, figure with marks); `appendBlocks`
 * places them on fixed-size pages. Layout is code, not the model: existing elements never move when blocks are
 * appended, pages are never deleted, edits keep the earlier text in `history`. The learner's own ink (pen strokes,
 * highlighter, stickies) lives in a separate layer per page that agent functions never touch.
 */

import { cleanDiagram, diagramText, drawDiagram, type Diagram } from "./diagram.ts";

/** One notebook (one exported PDF) holds at most this many pages; a subject or topic can have several notebooks. */
export const MAX_NOTE_PAGES = 32;

export const PAGE_W = 800;
export const PAGE_H = 1100;
const MARGIN = 48;
const MAIN_W = 500;
const SIDE_X = MARGIN + MAIN_W + 24;
const SIDE_W = PAGE_W - SIDE_X - MARGIN;
const BOTTOM = PAGE_H - MARGIN;
const GAP = 16;

export type MarkKind = "circle" | "arrow" | "underline" | "highlight" | "bracket" | "label";
/** Fractions (0–1) of the figure's width/height. For an arrow, (x,y) is the tip and (fromX,fromY) the tail. */
export interface Mark { kind: MarkKind; x: number; y: number; w?: number; h?: number; fromX?: number; fromY?: number; label?: string }

export type BoxKind = "definition" | "exam" | "revisit" | "mistake" | "idea";

export type Block =
	| { type: "heading"; text: string }
	| { type: "text"; text: string }
	| { type: "bullets"; items: string[] }
	| { type: "box"; kind: BoxKind; title?: string; text: string }
	| { type: "sticky"; text: string }
	| { type: "steps"; title?: string; steps: string[] }
	| { type: "figure"; materialId: string; page: number; /** width / height of the page image */ aspect: number; marks?: Mark[]; caption?: string }
	/** A flowchart or mind map drawn by code from the agent's content. */
	| { type: "diagram"; title?: string; diagram: Diagram }
	/** A displayed equation in LaTeX, with an optional one-line explanation. */
	| { type: "math"; latex: string; text?: string };

interface Frame { id: string; x: number; y: number; w: number; h: number; version: number; history: Array<{ at: number; text: string }>; createdAt: number }
export type Element =
	| (Frame & { type: "heading"; text: string })
	| (Frame & { type: "text"; text: string })
	| (Frame & { type: "bullets"; items: string[] })
	| (Frame & { type: "box"; kind: BoxKind; title?: string; text: string })
	| (Frame & { type: "sticky"; text: string; tilt: number })
	| (Frame & { type: "steps"; title?: string; steps: string[] })
	| (Frame & { type: "figure"; materialId: string; page: number; aspect: number; marks: Mark[]; caption?: string })
	| (Frame & { type: "diagram"; title?: string; diagram: Diagram })
	| (Frame & { type: "math"; latex: string; text?: string });

export interface Stroke { tool: "pen" | "highlighter"; color: string; width: number; points: Array<[number, number]> }
export interface LearnerSticky { id: string; x: number; y: number; text: string }
export interface LearnerLayer { strokes: Stroke[]; stickies: LearnerSticky[] }

export interface NotePage { id: string; elements: Element[] }
export interface Notebook {
	version: 1;
	/** Bumped on every agent change. */
	revision: number;
	pages: NotePage[];
	learner: Record<string, LearnerLayer>;
	log: Array<{ at: number; revision: number; summary: string }>;
}
export const emptyNotebook = (): Notebook => ({ version: 1, revision: 0, pages: [], learner: {}, log: [] });

const fail = (m: string): never => { throw new Error(m); };
const clean = (v: unknown, max = 1200): string => (typeof v === "string" ? v.replace(/\s+\n/g, "\n").trim().slice(0, max) : "");

// ── size estimates (deterministic; the viewer wraps the same way) ─────────────────────────────────────────────
const lines = (text: string, width: number, size: number): number => {
	const perLine = Math.max(8, Math.floor(width / (size * 0.5)));
	return text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
};
const HEAD = 30, BODY = 20;
function measure(block: Block, width: number): number {
	switch (block.type) {
		case "heading": return lines(block.text, width, HEAD) * (HEAD + 6) + 8;
		case "text": return lines(block.text, width, BODY) * (BODY + 6);
		case "bullets": return block.items.reduce((n, i) => n + lines(i, width - 28, BODY) * (BODY + 6), 0) + 4;
		case "box": return (block.title ? BODY + 10 : 0) + lines(block.text, width - 32, BODY) * (BODY + 6) + 28;
		case "steps": return (block.title ? BODY + 10 : 0) + block.steps.reduce((n, s) => n + lines(s, width - 44, BODY) * (BODY + 6) + 6, 0) + 20;
		case "sticky": return lines(block.text, SIDE_W - 24, 17) * 23 + 28;
		case "figure": return Math.round(width / Math.max(0.3, block.aspect)) + (block.caption ? 26 : 0);
		case "diagram": return (block.title ? 30 : 0) + Math.round(drawDiagram(block.diagram, width).h) + 12;
		case "math": return 30 + Math.ceil(block.latex.length / 60) * 30 + (block.text ? lines(block.text, width, 17) * 23 : 0);
	}
}

/** Displayed equations ($$…$$) inside text take a taller line of their own. */
const displayMathRoom = (block: Block): number => (block.type === "math" ? 0 : Math.floor((JSON.stringify(block).match(/\$\$/g)?.length ?? 0) / 2) * 30);

function validate(block: Block): Block {
	if (!block || typeof block !== "object") return fail("Each block must be an object.");
	switch (block.type) {
		case "heading": case "text": case "sticky": {
			const text = clean(block.text, block.type === "heading" ? 160 : 900);
			return text ? { ...block, text } : fail(`A ${block.type} block needs text.`);
		}
		case "bullets": {
			const items = (block.items ?? []).map((i) => clean(i, 300)).filter(Boolean).slice(0, 12);
			return items.length ? { type: "bullets", items } : fail("A bullets block needs items.");
		}
		case "box": {
			const text = clean(block.text, 900);
			if (!text) return fail("A box needs text.");
			return { type: "box", kind: (["definition", "exam", "revisit", "mistake", "idea"] as const).includes(block.kind) ? block.kind : "idea", title: clean(block.title, 80) || undefined, text };
		}
		case "steps": {
			const steps = (block.steps ?? []).map((s) => clean(s, 300)).filter(Boolean).slice(0, 12);
			return steps.length ? { type: "steps", title: clean(block.title, 80) || undefined, steps } : fail("A steps block needs steps.");
		}
		case "figure": {
			if (!block.materialId || !Number.isInteger(block.page) || block.page < 1) return fail("A figure needs a materialId and a page number.");
			const marks = (block.marks ?? []).slice(0, 2).map((m) => {
				const f = (n: unknown) => Math.min(1, Math.max(0, Number(n)));
				if (!["circle", "arrow", "underline", "highlight", "bracket", "label"].includes(m.kind)) return fail(`Unknown mark kind "${String(m.kind)}".`);
				return { kind: m.kind, x: f(m.x), y: f(m.y), ...(m.w != null ? { w: f(m.w) } : {}), ...(m.h != null ? { h: f(m.h) } : {}), ...(m.fromX != null ? { fromX: f(m.fromX) } : {}), ...(m.fromY != null ? { fromY: f(m.fromY) } : {}), ...(m.label ? { label: clean(m.label, 60) } : {}) } as Mark;
			});
			return { type: "figure", materialId: block.materialId, page: block.page, aspect: Number.isFinite(block.aspect) && block.aspect > 0 ? block.aspect : 0.75, marks, caption: clean(block.caption, 120) || undefined };
		}
		case "diagram": return { type: "diagram", title: clean(block.title, 80) || undefined, diagram: cleanDiagram(block.diagram) };
		case "math": {
			const latex = (typeof block.latex === "string" ? block.latex : "").trim().replace(/^\$+|\$+$/g, "").trim().slice(0, 600);
			return latex ? { type: "math", latex, text: clean(block.text, 200) || undefined } : fail("A math block needs latex.");
		}
		default: return fail(`Unknown block type "${String((block as { type?: unknown }).type)}".`);
	}
}

// ── layout ─────────────────────────────────────────────────────────────────────────────────────────────────────
interface Cursor { main: number; side: number }
function cursorOf(page: NotePage): Cursor {
	let main = MARGIN, side = MARGIN;
	for (const e of page.elements) {
		const bottom = e.y + e.h + GAP;
		if (e.x >= SIDE_X) side = Math.max(side, bottom); else main = Math.max(main, bottom);
	}
	return { main, side };
}

/** Add blocks to the notebook, flowing them down the last page (new pages as needed). Nothing placed earlier moves. */
export function appendBlocks(book: Notebook, blocks: readonly Block[], summary: string, now = Date.now(), makeId: () => string = () => `el_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`, maxPages = MAX_NOTE_PAGES): { notebook: Notebook; added: number; /** True when the notebook reached MAX_NOTE_PAGES and later blocks were not placed. */ full: boolean } {
	if (!blocks.length) fail("Give at least one block.");
	const checked = blocks.map(validate);
	const pages = book.pages.map((p) => ({ ...p, elements: [...p.elements] }));
	const newPage = (): NotePage => { const p = { id: `page_${(pages.length + 1)}_${Math.random().toString(36).slice(2, 6)}`, elements: [] }; pages.push(p); return p; };
	let page = pages.at(-1) ?? newPage();
	let cursor = cursorOf(page);
	let placed = 0;
	for (const block of checked) {
		const side = block.type === "sticky";
		const width = side ? SIDE_W : MAIN_W;
		const h = measure(block, width) + displayMathRoom(block);
		const room = (c: Cursor) => (side ? c.side : c.main) + h <= BOTTOM;
		if (!room(cursor)) {
			if (pages.length >= Math.min(maxPages, MAX_NOTE_PAGES)) break; // full (or at the page count asked for)
			page = newPage(); cursor = cursorOf(page);
		}
		placed++;
		const y = side ? cursor.side : cursor.main;
		const frame = { id: makeId(), x: side ? SIDE_X : MARGIN, y, w: width, h: Math.min(h, BOTTOM - y > 0 ? Math.max(h, 0) : h), version: 1, history: [] as Frame["history"], createdAt: now };
		const el: Element = block.type === "sticky" ? { ...frame, ...block, tilt: ((pages.length + page.elements.length) % 5 - 2) } : block.type === "figure" ? { ...frame, ...block, marks: block.marks ?? [] } : { ...frame, ...block } as Element;
		page.elements.push(el);
		if (side) cursor.side = y + h + GAP; else cursor.main = y + h + GAP;
	}
	if (!placed) return { notebook: book, added: 0, full: true };
	const revision = book.revision + 1;
	return { notebook: { ...book, pages, revision, log: [...book.log, { at: now, revision, summary: clean(summary, 140) || `Added ${placed} blocks` }].slice(-200) }, added: placed, full: placed < checked.length };
}

const textOf = (e: Element): string => {
	switch (e.type) {
		case "bullets": return e.items.join("\n");
		case "steps": return [e.title ?? "", ...e.steps].join("\n");
		case "figure": return e.caption ?? "";
		case "diagram": return [e.title ?? "", diagramText(e.diagram)].join(" ");
		case "math": return [e.latex, e.text ?? ""].join(" ");
		default: return e.text;
	}
};

/** Change an element's wording (text, heading, box, sticky) or a figure's marks; the old text goes to `history`. */
export function editElement(book: Notebook, elementId: string, patch: { text?: string; items?: string[]; marks?: Mark[]; caption?: string }, now = Date.now()): Notebook {
	let found = false;
	const pages = book.pages.map((p) => ({
		...p,
		elements: p.elements.map((e): Element => {
			if (e.id !== elementId) return e;
			found = true;
			const history = [...e.history, { at: now, text: textOf(e) }].slice(-20);
			const next = { ...e, version: e.version + 1, history } as Element;
			if (e.type === "figure") {
				const checked = validate({ type: "figure", materialId: e.materialId, page: e.page, aspect: e.aspect, marks: patch.marks ?? e.marks, caption: patch.caption ?? e.caption }) as Extract<Block, { type: "figure" }>;
				return { ...next, marks: checked.marks ?? [], caption: checked.caption } as Element;
			}
			if (e.type === "diagram") return fail("A diagram cannot be edited; add a corrected one instead.");
			if (e.type === "math") return fail("An equation cannot be edited; add a corrected one instead.");
			if (e.type === "bullets" || e.type === "steps") {
				const items = (patch.items ?? []).map((i) => clean(i, 300)).filter(Boolean);
				if (!items.length) return fail("Give the new items.");
				return e.type === "bullets" ? { ...next, items } as Element : { ...next, steps: items } as Element;
			}
			const text = clean(patch.text, 900);
			if (!text) return fail("Give the new text.");
			return { ...next, text } as Element;
		}),
	}));
	if (!found) fail("That note element no longer exists.");
	const revision = book.revision + 1;
	return { ...book, pages, revision, log: [...book.log, { at: now, revision, summary: "Edited a note" }].slice(-200) };
}

// ── the learner's ink (never touched by the functions above) ───────────────────────────────────────────────────
const layerOf = (book: Notebook, pageId: string): LearnerLayer => {
	if (!book.pages.some((p) => p.id === pageId)) fail("That page no longer exists.");
	return book.learner[pageId] ?? { strokes: [], stickies: [] };
};
const MAX_POINTS = 4000;

export function addStroke(book: Notebook, pageId: string, stroke: Stroke): Notebook {
	const layer = layerOf(book, pageId);
	const points = stroke.points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).slice(0, MAX_POINTS).map(([x, y]) => [Math.round(Math.min(PAGE_W, Math.max(0, x)) * 10) / 10, Math.round(Math.min(PAGE_H, Math.max(0, y)) * 10) / 10] as [number, number]);
	if (points.length < 1) return fail("A stroke needs points.");
	const tool = stroke.tool === "highlighter" ? "highlighter" : "pen";
	return { ...book, learner: { ...book.learner, [pageId]: { ...layer, strokes: [...layer.strokes, { tool, color: /^#[0-9a-f]{3,8}$/i.test(stroke.color) ? stroke.color : "#1f2937", width: Math.min(40, Math.max(0.5, Number(stroke.width) || 2)), points }] } } };
}
export function undoStroke(book: Notebook, pageId: string): Notebook {
	const layer = layerOf(book, pageId);
	return { ...book, learner: { ...book.learner, [pageId]: { ...layer, strokes: layer.strokes.slice(0, -1) } } };
}
export function addLearnerSticky(book: Notebook, pageId: string, sticky: { x: number; y: number; text: string }, id = `ls_${Date.now().toString(36)}`): Notebook {
	const layer = layerOf(book, pageId);
	const text = clean(sticky.text, 400);
	if (!text) return fail("A sticky needs text.");
	return { ...book, learner: { ...book.learner, [pageId]: { ...layer, stickies: [...layer.stickies, { id, x: Math.min(PAGE_W - 40, Math.max(0, sticky.x)), y: Math.min(PAGE_H - 40, Math.max(0, sticky.y)), text }] } } };
}
export function removeLearnerSticky(book: Notebook, pageId: string, id: string): Notebook {
	const layer = layerOf(book, pageId);
	return { ...book, learner: { ...book.learner, [pageId]: { ...layer, stickies: layer.stickies.filter((s) => s.id !== id) } } };
}

/** Plain text of every page, for the agent to see what the notes already say. */
export function notebookOutline(book: Notebook, maxChars = 3000): string {
	const out: string[] = [];
	book.pages.forEach((p, i) => {
		out.push(`Page ${i + 1}:`);
		for (const e of p.elements) out.push(`  [${e.id}] ${e.type}${e.type === "figure" ? ` p.${e.page}` : ""}${e.type === "diagram" ? ` (${e.diagram.kind})` : ""}: ${textOf(e).replace(/\s+/g, " ").slice(0, 120)}`);
	});
	const text = out.join("\n");
	return text.length > maxChars ? "…\n" + text.slice(-maxChars) : text || "(no notes yet)";
}
