/** Token diet: planner-note absorption calls the model only when it is worth it and due. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { absorbGate, absorbModelDue, dayEnded, localDay, unparsedDateLines } from "../src/core/study/planner-absorb.ts";
import { absorbPlannerNote, type AbsorbState, type AbsorbStateStore } from "../src/server/planner-absorb.ts";
import type { PlannerNote } from "../src/server/planner-notes.ts";
import { createStudyService, type StudyPdf } from "../src/server/study.ts";
import { createStudyStore } from "../src/store/study.ts";

const FACTS = "A semaphore is a counter guarded by atomic wait and signal operations; a mutex is a binary lock owned by one thread. ".repeat(3);
const SHORT = "xv6 is cool\nquiz tomorrow at 5pm";

describe("absorb gate", () => {
	it("a short note with only parseable dated items never needs the model", () => {
		const g = absorbGate(SHORT, "2026-11-20");
		assert.equal(g.useModel, false);
		assert.equal(g.regex.items.length, 1);
	});
	it("study content beyond ~200 chars needs it", () => assert.equal(absorbGate(`${SHORT}\n${FACTS}`, "2026-11-20").useModel, true));
	it("a date the regex cannot parse needs it", () => {
		const text = "midterm exam on dec 5 covers chapters 1-4";
		assert.deepEqual(unparsedDateLines(text, "2026-11-20"), [text]);
		assert.equal(absorbGate(text, "2026-11-20").useModel, true);
		assert.equal(unparsedDateLines("exam syllabus is os", "2026-11-20").length, 0);
	});
});

describe("absorb timing", () => {
	it("is due for a finished task, or once the note's day has ended", () => {
		const noon = new Date("2026-11-20T12:00:00");
		assert.equal(absorbModelDue({ finished: true, date: "2026-11-20" }, noon), true);
		assert.equal(absorbModelDue({ finished: false, date: "2026-11-20" }, noon), false);
		assert.equal(absorbModelDue({ finished: false, date: "2026-11-19" }, noon), true);
		assert.equal(localDay(noon), "2026-11-20");
		assert.equal(dayEnded("2026-11-20", new Date("2026-11-21T00:30:00")), true);
	});
});

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const pdf: StudyPdf = { async pageCount() { return 1; }, async texts() { return []; }, async render() { return []; } };
function setup() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "absorb-gate-"));
	roots.push(root);
	const study = createStudyService(createStudyStore(root), pdf);
	const subject = study.createSubject("OSN");
	let all: Record<string, AbsorbState> = {};
	const state: AbsorbStateStore = { read: () => ({ ...all }), write: (next) => { all = { ...next }; } };
	return { study, subject, state };
}

describe("absorbPlannerNote gating", () => {
	const noon = () => new Date("2026-11-20T12:00:00");
	const note = (subjectId: string, over: Partial<PlannerNote> = {}): PlannerNote => ({ externalId: "t1", subjectId, title: "OSN", date: "2026-11-20", markdown: `${SHORT}\n${FACTS}`, finished: false, ...over });

	it("edits of an unfinished note run only the free regex pass; finishing it calls the model exactly once", async () => {
		const { study, subject, state } = setup();
		let calls = 0;
		const extract = async () => { calls++; return { knowledge: "- semaphore: counter", items: [] }; };
		const deps = { study, extract, state, now: noon };
		const first = await absorbPlannerNote(note(subject.id), deps);
		assert.equal(calls, 0);
		assert.equal(first.final, false);
		assert.equal(first.deadlines.length, 1, "the regex still files the dated item");
		await absorbPlannerNote(note(subject.id), deps);
		assert.equal(calls, 0, "same content, still not due");
		const done = await absorbPlannerNote(note(subject.id, { finished: true }), deps);
		assert.equal(calls, 1);
		assert.equal(done.final, true);
		await absorbPlannerNote(note(subject.id, { finished: true }), deps);
		assert.equal(calls, 1, "an unchanged hash is skipped");
	});

	it("a note that needs no model is final at once and never calls it", async () => {
		const { study, subject, state } = setup();
		let calls = 0;
		const out = await absorbPlannerNote(note(subject.id, { markdown: SHORT, finished: true }), { study, state, now: noon, extract: async () => { calls++; return {}; } });
		assert.equal(calls, 0);
		assert.equal(out.final, true);
	});

	it("an unfinished note is finished by the model once its day has ended", async () => {
		const { study, subject, state } = setup();
		let calls = 0;
		const extract = async () => { calls++; return { knowledge: "- k", items: [] }; };
		await absorbPlannerNote(note(subject.id), { study, extract, state, now: noon });
		await absorbPlannerNote(note(subject.id), { study, extract, state, now: () => new Date("2026-11-21T08:00:00") });
		assert.equal(calls, 1);
	});
});
