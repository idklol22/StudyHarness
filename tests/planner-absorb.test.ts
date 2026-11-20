/**
 * Planner note absorption: the regex fallback (the owner's example), deadline dedupe, the context block
 * replace, JSON repair, and the end-to-end pass against a real study service.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { upsertPlannerNote, type PlannerNoteMap } from "../src/server/planner-notes.ts";
import { isPlannerNote, plannerBadge } from "../components/study/files-table.tsx";
import { alreadyHasItem, matchTopic, dueOf, newItems, normalizeAbsorbed, regexAbsorb, replaceNoteBlock, similarTitles } from "../src/core/study/planner-absorb.ts";
import { absorbPlannerNote, type AbsorbState, type AbsorbStateStore } from "../src/server/planner-absorb.ts";
import type { PlannerNote } from "../src/server/planner-notes.ts";
import { createStudyService, type StudyPdf } from "../src/server/study.ts";
import { createStudyStore } from "../src/store/study.ts";

const OWNER_NOTE = `semaphore vs mutexes
xv6 is cool

| Parameter | Value |
|---|---|
| sched_latency | 48 ms |

We have lab assignment @tomorrow at 5pm syllabus semaphores and mutexs concurrency
We have end sem on 29th syllabus is everything`;

// Real study content (> 200 chars outside the dated items) is what makes the gate call the model.
const FACTS = "The scheduler keeps a runqueue ordered by virtual runtime and always runs the task with the smallest vruntime. ".repeat(3);

describe("regexAbsorb", () => {
	it("extracts the owner's example relative to the note date", () => {
		const out = regexAbsorb(OWNER_NOTE, "2026-11-20");
		assert.deepEqual(out.items, [
			{ title: "Lab assignment", kind: "assignment", date: "2026-11-21", time: "17:00", syllabus: "semaphores and mutexs concurrency" },
			{ title: "End sem", kind: "exam", date: "2026-11-29", syllabus: "everything" },
		]);
		assert.match(out.knowledge, /semaphore vs mutexes/);
		assert.match(out.knowledge, /sched_latency/);
		assert.doesNotMatch(out.knowledge, /end sem/i);
	});

	it("rolls a past day of the month into the next month and skips days that do not exist", () => {
		assert.equal(regexAbsorb("quiz on 5th", "2026-11-20").items[0]?.date, "2026-12-05");
		assert.deepEqual(regexAbsorb("exam on 31st", "2026-11-20").items.map((i) => i.date), ["2026-12-31"]);
		assert.deepEqual(regexAbsorb("exam on 31st", "2026-12-20").items.map((i) => i.date), ["2026-12-31"]);
	});

	it("understands today, weekdays and 24 h times, and ignores lines without a date or keyword", () => {
		const out = regexAbsorb("Assignment due friday at 18:30\nquiz today\nwe had a quiz last week\nnothing here tomorrow", "2026-11-20"); // 2026-11-20 is a Friday
		assert.deepEqual(out.items.map((i) => [i.kind, i.date, i.time]), [["assignment", "2026-11-27", "18:30"], ["quiz", "2026-11-20", undefined]]);
	});

	it("does not read dates out of code fences", () => {
		assert.deepEqual(regexAbsorb("```\nexam tomorrow\n```", "2026-11-20").items, []);
	});
});

describe("dedupe", () => {
	it("matches the same date with a similar title only", () => {
		const existing = [{ title: "Lab assignment (semaphores)", due: "2026-11-21T17:00" }];
		assert.equal(alreadyHasItem(existing, { title: "lab assignments", date: "2026-11-21" }), true);
		assert.equal(alreadyHasItem(existing, { title: "Lab assignment", date: "2026-11-22" }), false);
		assert.equal(alreadyHasItem(existing, { title: "End sem", date: "2026-11-21" }), false);
		assert.equal(similarTitles("End sem exam", "End sem"), true);
		assert.equal(similarTitles("Quiz one", "Quiz two"), false); // 1 of 2 shared
	});

	it("collapses duplicates inside one note and builds due strings", () => {
		const items = [{ title: "End sem", date: "2026-11-29" }, { title: "End sem exam", date: "2026-11-29" }, { title: "Quiz", date: "2026-11-29" }];
		assert.deepEqual(newItems([], items).map((i) => i.title), ["End sem", "Quiz"]);
		assert.equal(dueOf({ date: "2026-11-21", time: "17:00" }), "2026-11-21T17:00");
		assert.equal(dueOf({ date: "2026-11-29" }), "2026-11-29");
	});
});

describe("replaceNoteBlock", () => {
	const note = { externalId: "task-1", title: "OSN class", date: "2026-11-20" };

	it("replaces the block of the same note instead of duplicating it, and keeps the rest", () => {
		const first = replaceNoteBlock("## Covered\n- intro", note, "- semaphores");
		assert.match(first, /## From Planner note: OSN class \(2026-11-20\)/);
		const second = replaceNoteBlock(first, note, "- semaphores\n- mutexes");
		assert.equal(second.match(/From Planner note/g)?.length, 1);
		assert.match(second, /mutexes/);
		assert.match(second, /## Covered\n- intro/);
		const other = replaceNoteBlock(second, { ...note, externalId: "task-2", title: "Other" }, "- x");
		assert.equal(other.match(/From Planner note/g)?.length, 2);
		assert.equal(replaceNoteBlock(other, note, "").includes("OSN class"), false);
	});
});

describe("normalizeAbsorbed", () => {
	it("repairs fenced JSON and drops invalid items", () => {
		const out = normalizeAbsorbed("```json\n{\"knowledge\":\" k \",\"items\":[{\"title\":\"Quiz\",\"kind\":\"quiz\",\"date\":\"2026-11-21\",\"time\":\"9:00\"},{\"title\":\"Bad\",\"kind\":\"exam\",\"date\":\"2026-02-30\"},{\"title\":\"X\",\"kind\":\"nope\",\"date\":\"2026-11-22\"}]}\n```");
		assert.equal(out.knowledge, "k");
		assert.deepEqual(out.items, [{ title: "Quiz", kind: "quiz", date: "2026-11-21" }, { title: "X", kind: "other", date: "2026-11-22" }]);
		assert.throws(() => normalizeAbsorbed("not json"), /JSON/);
	});
});

// ── end to end ──────────────────────────────────────────────────────────────────────────────────────────────────

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const pdf: StudyPdf = { async pageCount() { return 1; }, async texts() { return []; }, async render() { return []; } };

function setup() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "planner-absorb-"));
	roots.push(root);
	const study = createStudyService(createStudyStore(root), pdf);
	const subject = study.createSubject("OSN");
	let all: Record<string, AbsorbState> = {};
	const state: AbsorbStateStore = { read: () => ({ ...all }), write: (next) => { all = { ...next }; } };
	return { study, subject, state };
}

describe("absorbPlannerNote", () => {
	const note = (subjectId: string, markdown = `${OWNER_NOTE}
${FACTS}`): PlannerNote => ({ externalId: "task-1", subjectId, title: "OSN class", date: "2026-11-20", markdown, finished: true });

	it("falls back to the regex extractor when the model fails, writes memory and deadlines once, and skips an unchanged re-send", async () => {
		const { study, subject, state } = setup();
		let calls = 0;
		const extract = async () => { calls++; throw new Error("model down"); };
		const first = await absorbPlannerNote(note(subject.id), { study, extract, state });
		assert.equal(first.status, "done");
		assert.equal(first.deadlines.length, 2);
		const lib = study.library();
		assert.deepEqual(lib.deadlines?.map((d) => [d.title, d.due, d.kind, d.notes]), [
			["Lab assignment", "2026-11-21T17:00", "assignment", "semaphores and mutexs concurrency"],
			["End sem", "2026-11-29", "exam", "everything"],
		]);
		assert.match(lib.subjects[0]!.context, /From Planner note: OSN class \(2026-11-20\)/);
		assert.match(lib.subjects[0]!.context, /xv6 is cool/);

		await absorbPlannerNote(note(subject.id), { study, extract, state });
		assert.equal(calls, 1, "same content is not re-extracted");

		// An edit re-runs; memory is replaced and the existing deadlines are not added again.
		const edited = await absorbPlannerNote(note(subject.id, `${OWNER_NOTE}\ncfs picks the lowest vruntime`), { study, extract, state });
		assert.equal(edited.deadlines.length, 0);
		assert.equal(study.library().deadlines?.length, 2);
		const context = study.library().subjects[0]!.context;
		assert.equal(context.match(/From Planner note/g)?.length, 1);
		assert.match(context, /vruntime/);
	});

	it("uses the model result, and puts knowledge on the topic when the note has one", async () => {
		const { study, subject, state } = setup();
		const topic = study.createTopic(subject.id, "Concurrency");
		const extract = async () => ({ knowledge: "- semaphore: counter", items: [{ title: "Midsem", kind: "exam", date: "2026-12-01", time: "10:00" }] });
		const out = await absorbPlannerNote({ ...note(subject.id), topicId: topic.id }, { study, extract, state });
		assert.deepEqual(out.deadlines.map((d) => d.due), ["2026-12-01T10:00"]);
		const lib = study.library();
		assert.match(lib.topics[0]!.context, /semaphore: counter/);
		assert.equal(lib.subjects[0]!.context, "");
		assert.equal(lib.deadlines?.[0]?.topicId, topic.id);
	});

	it("reports a failure when the subject is gone", async () => {
		const { study, state } = setup();
		const out = await absorbPlannerNote(note("sub_missing"), { study, extract: async () => ({ knowledge: "", items: [] }), state });
		assert.equal(out.status, "failed");
	});
});

describe("matchTopic", () => {
	const topics = [{ id: "t1", name: "Semaphores and Mutexes" }, { id: "t2", name: "Scheduling" }];
	it("matches a clear topic and refuses unclear or ambiguous ones", () => {
		assert.equal(matchTopic("semaphores & mutexes", topics), "t1");
		assert.equal(matchTopic("scheduling", topics), "t2");
		assert.equal(matchTopic("Virtual memory", topics), undefined);
		assert.equal(matchTopic(undefined, topics), undefined);
		assert.equal(matchTopic("Scheduling", [{ id: "a", name: "Scheduling" }, { id: "b", name: "Scheduling" }]), undefined);
	});
});

describe("Planner notes in the library", () => {
	it("are marked as Planner notes with a finished badge, keep their topic across a re-send, and are filed by the absorption", async () => {
		const { study, subject, state } = setup();
		const topic = study.createTopic(subject.id, "Scheduling");
		let data: Record<string, string> = {};
		const map: PlannerNoteMap = { read: () => ({ ...data }), write: (next) => { data = { ...next }; } };
		const n: PlannerNote = { externalId: "task-9", subjectId: subject.id, title: "CFS", date: "2026-11-20", markdown: `cfs picks the lowest vruntime. ${FACTS}`, finished: false };
		const { materialId } = await upsertPlannerNote(n, { study, map });
		const m = () => study.library().materials.find((x) => x.id === materialId)!;
		assert.equal(isPlannerNote(m()), true);
		assert.equal(plannerBadge(m()), "Unfinished");
		assert.equal(m().meta?.date, "2026-11-20");

		const out = await absorbPlannerNote(n, { study, state, now: () => new Date("2026-11-22T10:00:00"), extract: async () => ({ knowledge: "- CFS: lowest vruntime", topic: "scheduling", items: [] }) }, materialId);
		assert.equal(out.status, "done");
		assert.equal(m().scope.topicId, topic.id);
		assert.match(study.library().topics[0]!.context, /CFS: lowest vruntime/);
		assert.equal(study.library().subjects[0]!.context, "");

		const again = await upsertPlannerNote(n, { study, map });
		assert.equal(again.materialId, materialId, "an unchanged re-send keeps the material in its topic");
		const finished = await upsertPlannerNote({ ...n, finished: true }, { study, map });
		assert.equal(plannerBadge(study.library().materials.find((x) => x.id === finished.materialId)!), "Finished");
	});
});
