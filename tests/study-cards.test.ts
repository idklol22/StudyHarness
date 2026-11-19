/**
 * Study flashcards: de-duplicated adds, edits that keep history, FSRS scheduling, and the three study modes
 * (due / progressive weakest-topic-first / all). Pure.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addCards, editCard, emptyCards, groupSummaries, rateCard, removeCard, studyQueue, weakness } from "../src/core/study/cards.ts";
import { createSchedule, isDue, rate } from "../src/core/study/fsrs.ts";

const T = Date.parse("2026-11-19T10:00:00");
let n = 0;
const id = () => `card_${++n}`;

describe("fsrs", () => {
	it("a new card is due at once; Good schedules a learning step, repeated Good graduates to review days", () => {
		let s = createSchedule(T);
		assert.equal(isDue(s, T), true);
		s = rate(s, 3, T);
		assert.equal(s.state, 1);
		assert.ok(s.due > T && s.due - T <= 15 * 60_000, "a short learning step");
		s = rate(s, 3, s.due);
		assert.equal(s.state, 2, "graduated to review");
		assert.ok(s.scheduled_days >= 1);
		assert.equal(isDue(s, s.due - 3600_000), false);
	});

	it("Again on a review card lapses it into relearning; bad ratings are refused", () => {
		let s = createSchedule(T);
		for (let i = 0; i < 3; i++) s = rate(s, 3, s.due);
		assert.equal(s.state, 2);
		const lapsed = rate(s, 1, s.due);
		assert.equal(lapsed.lapses, 1);
		assert.equal(lapsed.state, 3);
		assert.throws(() => rate(s, 5, T), /rating must be 1–4/);
	});
});

describe("cards", () => {
	it("adds cards, skipping questions that already exist; edits keep schedule and history", () => {
		let set = emptyCards();
		const first = addCards(set, [{ q: "What is memoization?", a: "Caching results.", group: "DP" }, { q: "  what is  memoization? ", a: "dup" }], "agent", T, id);
		set = first.set;
		assert.equal(first.added.length, 1);
		assert.equal(first.skipped, 1);
		const card = first.added[0]!;
		set = rateCard(set, card.id, 3, T).set;
		set = editCard(set, card.id, { a: "Caching the result of each subproblem." }, T + 1);
		const edited = set.cards[0]!;
		assert.equal(edited.a, "Caching the result of each subproblem.");
		assert.equal(edited.reviews.length, 1, "history kept");
		assert.equal(edited.schedule.reps, 1, "schedule kept");
		assert.throws(() => addCards(set, [{ q: "", a: "x" }]), /needs a question/);
		assert.throws(() => addCards(set, []), /at least one card/);
		assert.throws(() => editCard(set, "nope", { a: "x" }), /no longer exists/);
		assert.equal(removeCard(set, card.id).cards.length, 0);
	});

	it("a card cannot be edited into another card's question", () => {
		const { set } = addCards(emptyCards(), [{ q: "A?", a: "1" }, { q: "B?", a: "2" }], "agent", T, id);
		assert.throws(() => editCard(set, set.cards[0]!.id, { q: "b?" }), /already has that question/);
	});
});

describe("study modes", () => {
	// Topic A is solid (two Easy reviews); topic B was failed; topic C has never been seen.
	const build = () => {
		let { set } = addCards(emptyCards(), [
			{ q: "a1", a: "1", group: "A" }, { q: "a2", a: "2", group: "A" },
			{ q: "b1", a: "1", group: "B" }, { q: "b2", a: "2", group: "B" },
			{ q: "c1", a: "1", group: "C" },
		], "agent", T, id);
		for (const c of set.cards.filter((x) => x.group === "A")) { set = rateCard(set, c.id, 4, T).set; set = rateCard(set, c.id, 4, T + 60_000).set; }
		for (const c of set.cards.filter((x) => x.group === "B")) set = rateCard(set, c.id, 1, T).set;
		return set;
	};
	const later = T + 3 * 60_000;

	it("progressive: the weakest topic first, then the order of the rest; solid topics are left out", () => {
		const q = studyQueue(build().cards, { mode: "progressive" }, later);
		assert.equal(q.group, "B");
		assert.ok(q.cards.every((c) => c.group === "B"));
		assert.deepEqual(q.groupOrder.slice(0, 2), ["B", "C"].sort((a, b) => weakness(build().cards.filter((c) => c.group === b)) - weakness(build().cards.filter((c) => c.group === a))));
		assert.ok(!q.groupOrder.includes("A"), "a solid topic is not due");
	});

	it("due: only FSRS-due cards, soonest first; all: weakest first; topics can be limited", () => {
		const set = build();
		const due = studyQueue(set.cards, { mode: "due" }, later);
		assert.ok(due.cards.every((c) => c.group !== "A"));
		assert.ok(due.cards.every((c, i, a) => i === 0 || a[i - 1]!.schedule.due <= c.schedule.due));
		const all = studyQueue(set.cards, { mode: "all", groups: ["A", "B"] }, later);
		assert.equal(all.cards.length, 4);
		assert.equal(all.cards[0]!.group, "B", "weakest first");
		assert.equal(studyQueue(set.cards, { mode: "progressive", groups: ["A"] }, later).cards.length, 0);
	});

	it("group summaries count cards and what is due", () => {
		const s = groupSummaries(build().cards, later);
		assert.deepEqual(s.map((g) => [g.group, g.total]), [["A", 2], ["B", 2], ["C", 1]]);
		assert.equal(s.find((g) => g.group === "C")!.due, 1);
	});
});
