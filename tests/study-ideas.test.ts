/**
 * Topic suggestions and ideas, the whole-document outline, annotations placed on the PDF's own words, the 32-page
 * notebook cap, maths blocks and LaTeX splitting.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptSuggestion, addSuggestion, dismissSuggestion, ideasOf, mergeIdeas, suggestionsIn, tidyLibrary } from "../src/core/study/ideas.ts";
import { addMaterial, createSubject, createTopic, emptyLibrary, materialsIn, removeMaterial, type Library } from "../src/core/study/model.ts";
import { documentOutline, headingsOf, skimPageCount } from "../src/core/study/outline.ts";
import { locateQuote, marksFromQuotes, type TextRun } from "../src/core/study/text-boxes.ts";
import { appendBlocks, emptyNotebook, MAX_NOTE_PAGES, notebookOutline } from "../src/core/study/notes.ts";
import { mathPieces } from "../components/study/rich-text.tsx";

function subjectWithFile() {
	let lib: Library = emptyLibrary();
	const s = createSubject(lib, "Algorithms"); lib = s.library;
	const existing = createTopic(lib, s.subject.id, "Graphs"); lib = existing.library;
	const m = addMaterial(lib, { sha256: "a".repeat(64), fileName: "algo.pdf", pageCount: 100, bytes: 1, scope: { subjectId: s.subject.id } }); lib = m.library;
	return { lib, subjectId: s.subject.id, graphs: existing.topic, file: m.material };
}

describe("ideas", () => {
	it("merge by name (ignoring case and punctuation), union links, keep the first summary, cap the list", () => {
		let n = 0;
		const id = () => `i${++n}`;
		const a = mergeIdeas([], [{ name: "Memoization", summary: "Cache results.", file: { materialId: "m1", pages: "3-4" } }], id);
		const b = mergeIdeas(a, [{ name: "memoization!", summary: "other", chat: "c1" }, { name: "Tabulation", summary: "Bottom-up." }], id);
		assert.deepEqual(b.map((i) => i.name), ["Memoization", "Tabulation"]);
		assert.equal(b[0]!.summary, "Cache results.");
		assert.deepEqual(b[0]!.files, [{ materialId: "m1", pages: "3-4" }]);
		assert.deepEqual(b[0]!.chats, ["c1"]);
		const many = mergeIdeas([], Array.from({ length: 30 }, (_, i) => ({ name: `Idea ${i}` })), id);
		assert.equal(many.length, 12);
	});
});

describe("topic suggestions", () => {
	it("keep at most two topics, clamp page ranges, and ignore a topic id from another subject", () => {
		const f = subjectWithFile();
		const r = addSuggestion(f.lib, f.file.id, [
			{ name: "Dynamic programming", pages: { from: 0, to: 400 }, summary: "DP.", ideas: [{ name: "Memoization", summary: "x", pages: "3-9" }] },
			{ name: "Greedy", topicId: "top_elsewhere", pages: { from: 60, to: 90 }, summary: "G.", ideas: [] },
			{ name: "Third", pages: { from: 1, to: 2 }, summary: "", ideas: [] },
		]);
		const s = r.suggestion!;
		assert.equal(s.topics.length, 2);
		assert.deepEqual(s.topics[0]!.pages, { from: 1, to: 100 });
		assert.equal(s.topics[1]!.topicId, undefined);
		assert.equal(suggestionsIn(r.library, f.subjectId).length, 1);
		assert.equal(suggestionsIn(dismissSuggestion(r.library, s.id), f.subjectId).length, 0);
	});

	it("accepting one topic creates it, moves the file in and gives the topic its ideas linked to the file", () => {
		const f = subjectWithFile();
		const { library, suggestion } = addSuggestion(f.lib, f.file.id, [{ name: "Dynamic programming", pages: { from: 1, to: 100 }, summary: "DP.", ideas: [{ name: "Memoization", summary: "Cache.", pages: "3-9" }, { name: "Tabulation", summary: "Table." }] }]);
		const r = acceptSuggestion(library, suggestion!.id);
		const topicId = r.topics[0]!.topicId;
		assert.equal(r.topics[0]!.created, true);
		assert.deepEqual(materialsIn(r.library, { subjectId: f.subjectId }), []);
		const moved = materialsIn(r.library, { subjectId: f.subjectId, topicId });
		assert.equal(moved.length, 1);
		assert.equal(moved[0]!.pages, undefined);
		const ideas = ideasOf(r.library, { subjectId: f.subjectId, topicId });
		assert.deepEqual(ideas.map((i) => i.name), ["Memoization", "Tabulation"]);
		assert.deepEqual(ideas[0]!.files, [{ materialId: moved[0]!.id, pages: "3-9" }]);
		assert.equal(suggestionsIn(r.library, f.subjectId).length, 0);
	});

	it("accepting two topics references the one file from both with page ranges; a matching topic is reused; renames win", () => {
		const f = subjectWithFile();
		const { library, suggestion } = addSuggestion(f.lib, f.file.id, [
			{ name: "Shortest paths", topicId: f.graphs.id, pages: { from: 1, to: 40 }, summary: "", ideas: [{ name: "Dijkstra", summary: "" }] },
			{ name: "Sorting", pages: { from: 41, to: 100 }, summary: "", ideas: [] },
		]);
		const r = acceptSuggestion(library, suggestion!.id, { 1: "Sorting algorithms" });
		assert.equal(r.topics[0]!.topicId, f.graphs.id);
		assert.equal(r.topics[0]!.created, false);
		const graphsFile = materialsIn(r.library, { subjectId: f.subjectId, topicId: f.graphs.id })[0]!;
		assert.deepEqual(graphsFile.pages, { from: 1, to: 40 });
		const sorting = r.library.topics.find((t) => t.name === "Sorting algorithms")!;
		const sortingFile = materialsIn(r.library, { subjectId: f.subjectId, topicId: sorting.id })[0]!;
		assert.deepEqual(sortingFile.pages, { from: 41, to: 100 });
		assert.equal(sortingFile.sha256, graphsFile.sha256, "one stored copy");
	});

	it("removing a file drops its suggestion and the idea links to it", () => {
		const f = subjectWithFile();
		let { library } = addSuggestion(f.lib, f.file.id, [{ name: "DP", pages: { from: 1, to: 9 }, summary: "", ideas: [] }]);
		library = { ...library, topics: library.topics.map((t) => ({ ...t, ideas: [{ id: "i", name: "x", summary: "", files: [{ materialId: f.file.id }], chats: [] }] })) };
		const after = tidyLibrary(removeMaterial(library, f.file.id).library);
		assert.equal((after.suggestions ?? []).length, 0);
		assert.deepEqual(after.topics[0]!.ideas![0]!.files, []);
	});
});

describe("whole-document outline", () => {
	it("finds heading-like lines and stays within budget for a long book, keeping every heading", () => {
		assert.deepEqual(headingsOf("# Dynamic programming\nWe now turn to the idea of overlapping subproblems.\n3.1 Memoization\nThis is long prose. It has full stops."), ["Dynamic programming", "3.1 Memoization"]);
		const pages: Record<number, string> = {};
		for (let n = 1; n <= 600; n++) pages[n] = (n % 50 === 1 ? `# Chapter ${Math.ceil(n / 50)}: Part ${n}\n` : "") + "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(30);
		const out = documentOutline({ pages, pageCount: 600 }, 20000);
		assert.ok(out.length <= 20000);
		for (let c = 1; c <= 12; c++) assert.ok(out.includes(`Chapter ${c}:`), `chapter ${c} kept`);
		assert.match(out, /600 of 600 pages have text/);
	});

	it("skims 20% of a file, at most 8 pages", () => {
		assert.deepEqual([1, 5, 10, 20, 39, 40, 300].map(skimPageCount), [1, 1, 2, 4, 8, 8, 8]);
	});
});

describe("annotations on the PDF's own words", () => {
	const runs: TextRun[] = [
		{ text: "Theorem 2.1", x: 0.1, y: 0.10, w: 0.2, h: 0.03 },
		{ text: "The recurrence T(n) = 2T(n/2)", x: 0.1, y: 0.20, w: 0.5, h: 0.03 },
		{ text: "+ O(n) solves to O(n log n).", x: 0.1, y: 0.24, w: 0.45, h: 0.03 },
	];
	it("finds a quote across runs and lines, ignoring case and punctuation", () => {
		const box = locateQuote(runs, "t(n) = 2t(n/2) + O(n)")!;
		assert.ok(box);
		assert.equal(box.x, 0.1);
		assert.equal(box.y, 0.20);
		assert.ok(Math.abs(box.y + box.h - 0.27) < 1e-9);
		assert.equal(locateQuote(runs, "a sentence that is not on the page"), null);
		assert.ok(locateQuote(runs, "Theorem 2.1 and something extra the model added"), "falls back to the longest matching start");
	});

	it("turns picks into at most two marks placed on the words; unknown quotes are dropped", () => {
		const marks = marksFromQuotes(runs, [{ quote: "Theorem 2.1", kind: "circle", label: "key" }, { quote: "not there at all here", kind: "highlight" }, { quote: "O(n log n)", kind: "arrow", label: "answer" }, { quote: "The recurrence", kind: "underline" }]);
		assert.equal(marks.length, 2);
		assert.equal(marks[0]!.kind, "circle");
		assert.ok(marks[0]!.x <= 0.1 && marks[0]!.x >= 0.09);
		assert.equal(marks[1]!.kind, "arrow");
		assert.equal(marks[1]!.label, "answer");
		assert.deepEqual(marksFromQuotes([], [{ quote: "x y z", kind: "circle" }]), []);
	});
});

describe("notebooks", () => {
	it("a notebook never grows past 32 pages: later blocks are reported, not placed", () => {
		const big = Array.from({ length: 400 }, (_, i) => ({ type: "text" as const, text: `Paragraph ${i} `.repeat(30) }));
		const r = appendBlocks(emptyNotebook(), big, "lots");
		assert.equal(r.notebook.pages.length, MAX_NOTE_PAGES);
		assert.equal(r.full, true);
		assert.ok(r.added < big.length);
		const again = appendBlocks(r.notebook, [{ type: "text", text: "x ".repeat(400) }], "more");
		assert.equal(again.added, 0);
		assert.equal(again.full, true);
		assert.equal(again.notebook, r.notebook);
	});

	it("maths blocks are placed and listed; $$ in text takes extra room", () => {
		const { notebook } = appendBlocks(emptyNotebook(), [{ type: "math", latex: "$$T(n) = 2T(n/2) + O(n)$$", text: "merge sort" }, { type: "text", text: "Short." }, { type: "text", text: "With $$a^2+b^2=c^2$$ displayed." }], "m");
		const [math, short, display] = notebook.pages[0]!.elements;
		assert.equal(math?.type === "math" && math.latex, "T(n) = 2T(n/2) + O(n)");
		assert.ok(display!.h > short!.h);
		assert.match(notebookOutline(notebook), /math: T\(n\)/);
		assert.throws(() => appendBlocks(emptyNotebook(), [{ type: "math", latex: "  " }], "x"), /needs latex/);
	});
});

describe("LaTeX in notes", () => {
	it("splits text into plain, inline and displayed maths", () => {
		assert.deepEqual(mathPieces("Cost $O(n)$ and $$\\sum_i x_i$$ end"), [
			{ kind: "text", value: "Cost " }, { kind: "inline", value: "O(n)" }, { kind: "text", value: " and " }, { kind: "display", value: "\\sum_i x_i" }, { kind: "text", value: " end" },
		]);
		assert.deepEqual(mathPieces("no maths, $5 only"), [{ kind: "text", value: "no maths, $5 only" }]);
	});
});
