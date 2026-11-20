/** Pure lecture metadata: guesses from names/first pages, validation of learner edits, and library sorting. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { guessLectureMeta, readMaterialMeta, sortMaterials } from "../src/core/study/lecture-meta.ts";
import { emptyLibrary, setMaterialMeta, type Library, type Material } from "../src/core/study/model.ts";

const material = (id: string, fileName: string, meta?: Material["meta"], addedAt = "2026-01-01T00:00:00Z"): Material => ({
	id,
	sha256: "a".repeat(64),
	fileName,
	pageCount: 34,
	bytes: 1000,
	scope: { subjectId: "sub" },
	addedAt,
	...(meta === undefined ? {} : { meta }),
});

describe("guessLectureMeta — lecture number", () => {
	it("reads every supported spelling from the file name", () => {
		for (const [name, lecture] of [
			["Lecture 5.pdf", 5], ["Lec05.pdf", 5], ["L5.pdf", 5], ["Week 3.pdf", 3],
			["W03.pdf", 3], ["Class 7.pdf", 7], ["Session 2.pdf", 2],
		] as const) assert.equal(guessLectureMeta(name).lecture, lecture, name);
	});

	it("matches underscores, case-insensitively, but needs a word-like boundary", () => {
		assert.equal(guessLectureMeta("LECTURE_12_notes.pdf").lecture, 12);
		assert.equal(guessLectureMeta("L5_notes.pdf").lecture, 5);
		assert.equal(guessLectureMeta("pLecture 5.pdf").lecture, undefined, "no match inside another word");
		assert.equal(guessLectureMeta("Lecture 5x.pdf").lecture, undefined, "no partial number match");
	});

	it("prefers the file name and only then looks at the first page", () => {
		assert.equal(guessLectureMeta("L4_slides.pdf", "Lecture 9\nIntroduction").lecture, 4);
		assert.equal(guessLectureMeta("intro.pdf", "Week 12: Dynamic programming").lecture, 12);
		assert.equal(guessLectureMeta("intro.pdf", "No lecture here.").lecture, undefined);
	});
});

describe("guessLectureMeta — date and kind", () => {
	it("reads ISO, dotted and slashed dates as ISO", () => {
		assert.equal(guessLectureMeta("2026-11-12_Lec05.pdf").date, "2026-11-12");
		assert.equal(guessLectureMeta("12.11.2026 notes.pdf").date, "2026-11-12");
		assert.equal(guessLectureMeta("12/11/2026 slides.pdf").date, "2026-11-12");
	});

	it("reads '12 Nov 2026' style and ignores impossible dates", () => {
		assert.equal(guessLectureMeta("12 Nov 2026 lecture.pdf").date, "2026-11-12");
		assert.equal(guessLectureMeta("notes.pdf", "Handed in 3 March 2026").date, "2026-03-03");
		assert.equal(guessLectureMeta("31.02.2026.pdf").date, undefined);
		assert.equal(guessLectureMeta("2026-13-01.pdf").date, undefined, "falls back to another valid spelling only");
	});

	it("classifies assignments from the name or the text, ahead of other kinds", () => {
		assert.equal(guessLectureMeta("Homework_3.pdf", "Scanned handwritten pages").kind, "assignment");
		assert.equal(guessLectureMeta("L5.pdf", "Problem set 2").kind, "assignment");
		assert.equal(guessLectureMeta("quiz1.pdf").kind, "assignment");
		assert.equal(guessLectureMeta("HW4.pdf").kind, "assignment");
	});

	it("classifies handwritten and slides from the name, otherwise other", () => {
		assert.equal(guessLectureMeta("Week 3 notes.pdf").kind, "handwritten");
		assert.equal(guessLectureMeta("scan_01.pdf").kind, "handwritten");
		assert.equal(guessLectureMeta("Lecture 5 slides.pdf").kind, "slides");
		assert.equal(guessLectureMeta("deck-2.pdf").kind, "slides");
		assert.equal(guessLectureMeta("random.pdf", "quiz question").kind, "assignment");
		assert.equal(guessLectureMeta("random.pdf").kind, "other");
	});
});

describe("guessLectureMeta — title", () => {
	it("drops the extension, separators, lecture and date tokens", () => {
		assert.equal(guessLectureMeta("Lecture_5_-_Intro_to_Maths.pdf").title, "Intro to Maths");
		assert.equal(guessLectureMeta("2026-11-12_Lec05_-_Derivatives.pdf").title, "Derivatives");
		assert.equal(guessLectureMeta("12-Nov-2026__Week_3_notes.md").title, "notes");
	});

	it("falls back to the original name when nothing readable is left", () => {
		assert.equal(guessLectureMeta("L5.pdf").title, "L5.pdf");
		assert.equal(guessLectureMeta("readme.md").title, "readme");
		assert.deepEqual(guessLectureMeta("random.pdf"), { kind: "other", title: "random" });
	});
});

describe("sortMaterials", () => {
	const list: Material[] = [
		material("a", "alpha.pdf", { lecture: 5, date: "2026-11-12" }),
		material("b", "beta.pdf", { lecture: 5, date: "2026-11-02" }),
		material("c", "charlie.pdf", { lecture: 5 }),
		material("d", "delta.pdf", { lecture: 2, date: "2026-12-01" }),
		material("e", "echo.pdf"),
		material("f", "foxtrot.pdf", { date: "2026-01-01" }),
	];

	it("sorts by lecture, then date, then name; undated and unnumbered files go last", () => {
		assert.deepEqual(sortMaterials(list, "lecture").map((m) => m.id), ["d", "b", "a", "c", "f", "e"]);
	});

	it("sorts by name and by recently added", () => {
		const named = [...list, material("g", "Zulu.pdf", undefined, "2026-10-01T00:00:00Z")];
		assert.deepEqual(sortMaterials(named, "name").map((m) => m.id).slice(0, 2), ["a", "b"]);
		assert.deepEqual(sortMaterials(named, "added").map((m) => m.id).slice(0, 2), ["g", "a"]);
	});

	it("never mutates the input", () => {
		const before = list.map((m) => m.id);
		const sorted = sortMaterials(list, "lecture");
		assert.notEqual(sorted, list);
		assert.deepEqual(list.map((m) => m.id), before);
	});
});

describe("editing metadata", () => {
	it("accepts valid edits and clears blank fields", () => {
		assert.deepEqual(readMaterialMeta({ lecture: 5, date: "2026-11-12", kind: "slides", title: "  Intro  " }), { lecture: 5, date: "2026-11-12", kind: "slides", title: "Intro" });
		assert.deepEqual(readMaterialMeta({ lecture: "", date: null, kind: "", title: "" }), {});
		assert.deepEqual(readMaterialMeta({ lecture: 2, unexpected: "ignored" }), { lecture: 2 });
	});

	it("rejects bad lecture numbers, dates, kinds and titles", () => {
		assert.throws(() => readMaterialMeta({ lecture: 2.5 }), /whole number/);
		assert.throws(() => readMaterialMeta({ date: "12/11/2026" }), /YYYY-MM-DD/);
		assert.throws(() => readMaterialMeta({ date: "2026-02-30" }), /real date/);
		assert.throws(() => readMaterialMeta({ kind: "video" }), /valid kind/);
		assert.throws(() => readMaterialMeta({ title: 42 }), /must be text/);
		assert.throws(() => readMaterialMeta(null), /object/);
	});

	it("stores and clears metadata on a material", () => {
		let lib: Library = emptyLibrary();
		const m = material("m1", "L5.pdf");
		lib = { ...lib, materials: [m] };
		const withMeta = setMaterialMeta(lib, "m1", { lecture: 5, kind: "slides" });
		assert.deepEqual(withMeta.materials[0]!.meta, { lecture: 5, kind: "slides" });
		const cleared = setMaterialMeta(withMeta, "m1", {});
		assert.equal(cleared.materials[0]!.meta, undefined);
		assert.throws(() => setMaterialMeta(lib, "missing", { kind: "other" }), /no longer exists/);
	});
});
