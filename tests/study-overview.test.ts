/**
 * Task 4: subject Overview — To-do composition, overdue ordering, coverage percentages, deadline editing
 * and scope deletion. Pure core only (node:test + assert/strict).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDeadline, editDeadline, removeDeadline, toggleDeadline, upcoming } from "../src/core/study/deadlines.ts";
import { buildTodo, coverageRows, coverageTotals, percent } from "../src/core/study/overview.ts";
import { addMaterial, createSubject, createTopic, deleteSubject, deleteTopic, emptyLibrary, materialsUnder, setMaterialMeta, type Library } from "../src/core/study/model.ts";

const NOW = new Date("2026-11-20T12:00:00Z");
const dueIn = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

function fixture() {
	let l: Library = emptyLibrary();
	const s = createSubject(l, "Algorithms"); l = s.library;
	const other = createSubject(l, "Biology"); l = other.library;
	const t = createTopic(l, s.subject.id, "Graphs"); l = t.library;
	const big = addMaterial(l, { sha256: "a".repeat(64), fileName: "Lec01.pdf", pageCount: 30, bytes: 1, scope: { subjectId: s.subject.id } }); l = big.library;
	const small = addMaterial(l, { sha256: "b".repeat(64), fileName: "Lec02.pdf", pageCount: 10, bytes: 1, scope: { subjectId: s.subject.id, topicId: t.topic.id } }); l = small.library;
	return { l, s: s.subject, other: other.subject, t: t.topic, big: big.material, small: small.material };
}

describe("to-do composition", () => {
	it("cards, a near deadline, uncovered files and waiting suggestions, each with its link", () => {
		const f = fixture();
		const withDeadline = addDeadline(f.l, { subjectId: f.s.id, title: "Problem set", due: dueIn(3), kind: "assignment" }).library;
		const lib: Library = { ...withDeadline, suggestions: [{ id: "sg1", materialId: f.big.id, createdAt: NOW.toISOString(), topics: [] }] };
		const progress = [{ id: f.big.id, pageCount: 30, readPages: 12, notedPages: 5 }, { id: f.small.id, pageCount: 10, readPages: 0, notedPages: 0 }];
		const todo = buildTodo({ scope: { subjectId: f.s.id }, library: lib, now: NOW, dueCards: 2, progress });
		assert.deepEqual(todo.map((t) => t.label), [
			"2 flashcards due",
			"Assignment Problem set due in 3 days",
			"Not covered yet: Lec02.pdf",
			"Topic suggestions waiting",
		]);
		assert.equal(todo[0]!.href, `/subjects/${f.s.id}#flashcards`);
		assert.equal(todo[1]!.href, `/subjects/${f.s.id}#deadlines`);
		assert.equal(todo[2]!.href, `/subjects/${f.s.id}/read/${f.small.id}`);
		assert.equal(todo[3]!.href, `/subjects/${f.s.id}#files`);
		assert.equal(todo.length > 0, true);
	});

	it("caps uncovered files at five with a '+k more' link; empty when caught up", () => {
		const f = fixture();
		let l = f.l;
		for (let i = 0; i < 5; i++) {
			const m = addMaterial(l, { sha256: String(i).repeat(64), fileName: `Extra${i}.pdf`, pageCount: 2, bytes: 1, scope: { subjectId: f.s.id } });
			l = m.library;
		}
		const files = materialsUnder(l, { subjectId: f.s.id });
		const coveredProgress = files.map((m) => ({ id: m.id, pageCount: m.pageCount, readPages: 1, notedPages: 0 }));
		assert.deepEqual(buildTodo({ scope: { subjectId: f.s.id }, library: l, now: NOW, dueCards: 0, progress: coveredProgress }), []);
		const untouched = files.map((m) => ({ id: m.id, pageCount: m.pageCount, readPages: 0, notedPages: 0 }));
		const todo = buildTodo({ scope: { subjectId: f.s.id }, library: l, now: NOW, dueCards: 0, progress: untouched });
		assert.equal(todo.filter((t) => t.label.startsWith("Not covered")).length, 5);
		assert.equal(todo.at(-1)!.label, "+2 more");
		assert.equal(todo.at(-1)!.href, `/subjects/${f.s.id}#files`);
	});
});

describe("overdue ordering", () => {
	it("not done, overdue first then soonest; beyond 14 days is not a to-do", () => {
		const f = fixture();
		let l = f.l;
		for (const [title, due] of [
			["Soon", dueIn(3)], ["Late", dueIn(-2)], ["Far", dueIn(20)], ["Today", dueIn(0)],
		] as const) l = addDeadline(l, { subjectId: f.s.id, title, due, kind: "other" }).library;
		const done = addDeadline(l, { subjectId: f.s.id, title: "Finished", due: dueIn(-9), kind: "other", done: true }).library;
		assert.deepEqual(upcoming(done, f.s.id, NOW).map((d) => d.title), ["Late", "Today", "Soon", "Far"]);
		const progress = materialsUnder(done, { subjectId: f.s.id }).map((m) => ({ id: m.id, pageCount: m.pageCount, readPages: m.pageCount, notedPages: 0 }));
		const todo = buildTodo({ scope: { subjectId: f.s.id }, library: done, now: NOW, dueCards: 0, progress });
		assert.deepEqual(todo.map((t) => t.label), ["Other Late 2 days overdue", "Other Today due today", "Other Soon due in 3 days"]);
		assert.equal(todo[0]!.danger, true);
		assert.equal(todo[1]!.danger, undefined);
		assert.deepEqual(upcoming(done, f.other.id, NOW), []);
	});
});

describe("coverage numbers", () => {
	it("percentages of page counts, lecture ordering and totals", () => {
		const f = fixture();
		let l = setMaterialMeta(f.l, f.big.id, { lecture: 2, title: "Big file" });
		l = setMaterialMeta(l, f.small.id, { lecture: 1, title: "Small file" });
		const rows = coverageRows(materialsUnder(l, { subjectId: f.s.id }), [
			{ id: f.big.id, pageCount: 30, readPages: 12, notedPages: 6 },
			{ id: f.small.id, pageCount: 10, readPages: 4, notedPages: 0 },
		]);
		assert.deepEqual(rows.map((r) => r.title), ["Small file", "Big file"]);
		assert.deepEqual(rows[1] && [rows[1].readPct, rows[1].notedPct, rows[1].readPages], [40, 20, 12]);
		assert.deepEqual(coverageTotals(rows), { pages: 40, readPages: 16, notedPages: 6, readPct: 40, notedPct: 15 });
		assert.equal(percent(1, 3), 33);
		assert.equal(percent(5, 0), 0);
	});
});

describe("deadline editing", () => {
	it("add, edit, toggle and remove with validation", () => {
		const f = fixture();
		const make = () => ({ id: "dl_test", at: NOW.toISOString() });
		const added = addDeadline(f.l, { subjectId: f.s.id, title: "  Exam  ", due: "2026-11-28", kind: "exam" }, make);
		assert.equal(added.deadline.id, "dl_test");
		assert.deepEqual([added.deadline.title, added.deadline.due, added.deadline.kind], ["Exam", "2026-11-28", "exam"]);
		let l = editDeadline(added.library, "dl_test", { title: "Final exam", due: "2026-11-29T10:00", kind: "quiz" });
		assert.deepEqual([l.deadlines![0]!.title, l.deadlines![0]!.due, l.deadlines![0]!.kind], ["Final exam", "2026-11-29T10:00", "quiz"]);
		l = toggleDeadline(l, "dl_test");
		assert.equal(l.deadlines![0]!.done, true);
		assert.equal(upcoming(l, f.s.id, NOW).length, 0);
		l = removeDeadline(toggleDeadline(l, "dl_test"), "dl_test");
		assert.deepEqual(l.deadlines, []);
	});

	it("rejects empty/overlong titles, invalid dates, bad kinds and unknown ids", () => {
		const f = fixture();
		const base = { subjectId: f.s.id, due: "2026-11-28", kind: "quiz" as const };
		assert.throws(() => addDeadline(f.l, { ...base, title: "   " }), /not be empty/);
		assert.throws(() => addDeadline(f.l, { ...base, title: "x".repeat(121) }), /at most 120/);
		assert.throws(() => addDeadline(f.l, { ...base, title: "Bad date", due: "2026-02-30" }), /Due must be a real date/);
		assert.throws(() => addDeadline(f.l, { ...base, title: "Bad kind", kind: "nonsense" }), /valid kind/);
		const l = addDeadline(f.l, { ...base, title: "Quiz" }).library;
		assert.throws(() => editDeadline(l, "dl_missing", { title: "X" }), /no longer exists/);
		assert.throws(() => editDeadline(l, l.deadlines![0]!.id, { due: "tomorrow" }), /Due must be a real date/);
		assert.throws(() => removeDeadline(l, "dl_missing"), /no longer exists/);
	});
});

describe("scope deletion", () => {
	it("deleting a subject removes its deadlines (including its topics'); deleting a topic removes only its own", () => {
		const f = fixture();
		let l = addDeadline(f.l, { subjectId: f.s.id, title: "Subject", due: dueIn(1), kind: "other" }).library;
		l = addDeadline(l, { subjectId: f.s.id, topicId: f.t.id, title: "Topic", due: dueIn(2), kind: "other" }).library;
		l = addDeadline(l, { subjectId: f.other.id, title: "Elsewhere", due: dueIn(3), kind: "other" }).library;
		const afterTopic = deleteTopic(l, f.t.id).library;
		assert.deepEqual((afterTopic.deadlines ?? []).map((d) => d.title), ["Subject", "Elsewhere"]);
		const afterSubject = deleteSubject(afterTopic, f.s.id).library;
		assert.deepEqual((afterSubject.deadlines ?? []).map((d) => d.title), ["Elsewhere"]);
	});
});
