/**
 * Study notes model: deterministic stable layout, validation, edits with history, and the learner's ink
 * surviving agent changes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addLearnerSticky, addStroke, appendBlocks, editElement, emptyNotebook, notebookOutline, PAGE_H, PAGE_W, undoStroke, type Block, type Notebook } from "../src/core/study/notes.ts";

let n = 0;
const id = () => `el_${++n}`;
const T = 1_000_000;
const long = "word ".repeat(60);

describe("note layout", () => {
	it("flows blocks down a page, puts stickies in the margin, and keeps everything inside the page", () => {
		const { notebook } = appendBlocks(emptyNotebook(), [
			{ type: "heading", text: "Bellman equation" },
			{ type: "text", text: "The value of a state is the best action's reward plus the discounted next value." },
			{ type: "sticky", text: "exam favourite!" },
			{ type: "figure", materialId: "m1", page: 12, aspect: 1.33, marks: [{ kind: "circle", x: 0.5, y: 0.4, w: 0.2, h: 0.2, label: "V(s)" }] },
		], "first", T, id);
		const els = notebook.pages[0]!.elements;
		assert.equal(els.length, 4);
		const [h, t, s, f] = els;
		assert.ok(t!.y > h!.y && f!.y > t!.y, "main column flows downward");
		assert.ok(s!.x > f!.x + f!.w - 1 || s!.x >= 560, "sticky sits in the margin column");
		for (const e of els) assert.ok(e.x >= 0 && e.x + e.w <= PAGE_W && e.y >= 0 && e.y + e.h <= PAGE_H, `${e.type} inside the page`);
	});

	it("starts a new page when the content does not fit, and never deletes or moves earlier pages or elements", () => {
		let book = appendBlocks(emptyNotebook(), [{ type: "heading", text: "A" }], "a", T, id).notebook;
		const before = JSON.stringify(book.pages);
		const many: Block[] = Array.from({ length: 14 }, () => ({ type: "text", text: long }));
		book = appendBlocks(book, many, "b", T + 1, id).notebook;
		assert.ok(book.pages.length >= 2);
		assert.equal(JSON.stringify(book.pages[0]!.elements[0]), JSON.stringify(JSON.parse(before)[0].elements[0]), "the first element is exactly where it was");
		for (const p of book.pages) for (const e of p.elements) assert.ok(e.y + e.h <= PAGE_H, "nothing runs off the page");
	});

	it("is deterministic for the same input", () => {
		const run = () => { n = 0; return appendBlocks(emptyNotebook(), [{ type: "heading", text: "X" }, { type: "bullets", items: ["a", "b"] }, { type: "box", kind: "exam", text: "remember" }], "s", T, id).notebook.pages.map((p) => p.elements.map((e) => [e.id, e.x, e.y, e.h])); };
		assert.deepEqual(run(), run());
	});

	it("rejects bad blocks and clamps figure marks to the figure", () => {
		assert.throws(() => appendBlocks(emptyNotebook(), [], "x"), /at least one block/);
		assert.throws(() => appendBlocks(emptyNotebook(), [{ type: "text", text: "  " }], "x"), /needs text/);
		assert.throws(() => appendBlocks(emptyNotebook(), [{ type: "figure", materialId: "", page: 1, aspect: 1 }], "x"), /needs a materialId/);
		assert.throws(() => appendBlocks(emptyNotebook(), [{ type: "figure", materialId: "m", page: 1, aspect: 1, marks: [{ kind: "scribble" as never, x: 0, y: 0 }] }], "x"), /Unknown mark kind/);
		const fig = appendBlocks(emptyNotebook(), [{ type: "figure", materialId: "m", page: 1, aspect: 1, marks: [{ kind: "circle", x: 1.7, y: -2, w: 0.3, h: 0.3 }] }], "x", T, id).notebook.pages[0]!.elements[0]!;
		assert.equal(fig.type === "figure" && fig.marks[0]!.x, 1);
		assert.equal(fig.type === "figure" && fig.marks[0]!.y, 0);
	});
});

describe("edits and the learner's ink", () => {
	const seeded = (): Notebook => appendBlocks(emptyNotebook(), [{ type: "text", text: "old wording" }], "s", T, id).notebook;

	it("an edit keeps the old text in history and bumps the version", () => {
		const book = seeded();
		const eid = book.pages[0]!.elements[0]!.id;
		const next = editElement(book, eid, { text: "new wording" }, T + 5);
		const el = next.pages[0]!.elements[0]!;
		assert.equal(el.type === "text" && el.text, "new wording");
		assert.equal(el.version, 2);
		assert.equal(el.history[0]!.text, "old wording");
		assert.equal(next.revision, book.revision + 1);
		assert.throws(() => editElement(book, "nope", { text: "x" }), /no longer exists/);
	});

	it("learner strokes and stickies survive agent appends and edits; undo removes only the last stroke", () => {
		let book = seeded();
		const page = book.pages[0]!.id;
		book = addStroke(book, page, { tool: "pen", color: "#ff0000", width: 3, points: [[1, 2], [3, 4]] });
		book = addStroke(book, page, { tool: "highlighter", color: "#ffee00", width: 12, points: [[5, 6], [900, -5]] });
		book = addLearnerSticky(book, page, { x: 10, y: 10, text: "ask in class" }, "ls1");
		book = appendBlocks(book, [{ type: "text", text: "more" }], "m", T + 1, id).notebook;
		book = editElement(book, book.pages[0]!.elements[0]!.id, { text: "changed" }, T + 2);
		assert.equal(book.learner[page]!.strokes.length, 2);
		assert.deepEqual(book.learner[page]!.strokes[1]!.points[1], [PAGE_W, 0], "points are clamped to the page");
		assert.equal(book.learner[page]!.stickies[0]!.text, "ask in class");
		book = undoStroke(book, page);
		assert.equal(book.learner[page]!.strokes.length, 1);
		assert.throws(() => addStroke(book, "page_gone", { tool: "pen", color: "#000", width: 1, points: [[0, 0]] }), /no longer exists/);
	});

	it("the outline lists what the notes say with element ids, so the agent can edit rather than repeat", () => {
		const out = notebookOutline(appendBlocks(seeded(), [{ type: "heading", text: "Topic" }], "h", T, id).notebook);
		assert.match(out, /Page 1/);
		assert.match(out, /\[el_\d+\] heading: Topic/);
		assert.equal(notebookOutline(emptyNotebook()), "(no notes yet)");
	});
});
