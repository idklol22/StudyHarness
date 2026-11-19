/**
 * Notes viewer: mark geometry is deterministic and inside sensible bounds; a page renders its elements,
 * the figure screenshot with its marks, and the learner's ink/stickies.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { addLearnerSticky, addStroke, appendBlocks, emptyNotebook } from "../src/core/study/notes.ts";
import { markShapes } from "../components/study/notes-geometry.ts";
import { NotePageView, pageImageUrl } from "../components/study/notes-view.tsx";

describe("mark geometry", () => {
	it("is deterministic and draws each kind", () => {
		for (const kind of ["circle", "arrow", "underline", "highlight", "bracket", "label"] as const) {
			const m = { kind, x: 0.3, y: 0.3, w: 0.2, h: 0.1, fromX: 0.6, fromY: 0.1, label: "V(s)" };
			const a = markShapes(m, 400, 300), b = markShapes(m, 400, 300);
			assert.deepEqual(a, b);
			assert.ok(a.length >= 1, kind);
		}
		const arrow = markShapes({ kind: "arrow", x: 0.5, y: 0.5, fromX: 0.8, fromY: 0.2, label: "here" }, 400, 300);
		assert.ok(arrow.some((s) => s.kind === "text" && s.text === "here"));
	});
});

describe("note page view", () => {
	it("renders text, the figure screenshot with its marks, and the learner's ink", () => {
		let book = appendBlocks(emptyNotebook(), [
			{ type: "heading", text: "Bellman equation" },
			{ type: "bullets", items: ["value of a state", "best action"] },
			{ type: "box", kind: "exam", text: "Know the recursion" },
			{ type: "figure", materialId: "mat_1", page: 12, aspect: 1.3, marks: [{ kind: "circle", x: 0.4, y: 0.4, w: 0.2, h: 0.2, label: "V(s)" }], caption: "slide 12" },
			{ type: "sticky", text: "exam favourite" },
		], "s").notebook;
		const page = book.pages[0]!;
		book = addStroke(book, page.id, { tool: "pen", color: "#111827", width: 2, points: [[10, 10], [40, 40]] });
		book = addLearnerSticky(book, page.id, { x: 100, y: 100, text: "ask Tuesday" }, "ls1");
		const html = renderToStaticMarkup(<NotePageView page={book.pages[0]!} number={1} notebook={book} scale={0.5} tool="view" imageUrl={pageImageUrl} />);
		assert.match(html, /Bellman equation/);
		assert.match(html, /value of a state/);
		assert.match(html, /Know the recursion/);
		assert.match(html, /src="\/api\/study\/pages\/mat_1\/12"/);
		assert.match(html, /V\(s\)/);
		assert.match(html, /slide 12/);
		assert.match(html, /exam favourite/);
		assert.match(html, /ask Tuesday/);
		assert.match(html, /M10,10 L40,40/, "the learner's stroke is drawn");
	});
});
