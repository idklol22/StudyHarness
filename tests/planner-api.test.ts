/**
 * Planner API hand-off: pure validation, the externalId → materialId upsert, and the CORS grants.
 * No Next.js runtime here — the route handlers stay thin over these helpers.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { plannerCorsHeaders, plannerOrigins, plannerPreflight } from "../src/server/planner-cors.ts";
import {
	PlannerNoteInputError,
	parsePlannerNoteMap,
	plannerNoteFileName,
	plannerNoteMarkdown,
	upsertPlannerNote,
	validatePlannerNote,
	type PlannerNote,
	type PlannerNoteMap,
} from "../src/server/planner-notes.ts";
import { createStudyService, type StudyPdf } from "../src/server/study.ts";
import { createStudyStore } from "../src/store/study.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

const pdf: StudyPdf = {
	async pageCount() { return 1; },
	async texts() { return []; },
	async render() { return []; },
};

function setup() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "planner-api-"));
	roots.push(root);
	const store = createStudyStore(root);
	const study = createStudyService(store, pdf);
	const subject = study.createSubject("Statistics");
	const topic = study.createTopic(subject.id, "Regression");
	let data: Record<string, string> = {};
	const map: PlannerNoteMap = {
		read: () => ({ ...data }),
		write: (next) => { data = { ...next }; },
	};
	return { study, store, subject, topic, map, data: () => data };
}

const valid = (over: Partial<PlannerNote> = {}): PlannerNote => ({
	externalId: "task-1",
	subjectId: "sub_1",
	title: "Regression notes",
	date: "2026-11-20",
	markdown: "# Regression\n\nFit a line.",
	finished: true,
	...over,
});

describe("validatePlannerNote", () => {
	it("accepts a full payload, with and without a topic", () => {
		const base = { externalId: " task-1 ", subjectId: "sub_1", title: "  Regression notes ", date: "2026-11-20", markdown: "# Notes", finished: true };
		assert.deepEqual(validatePlannerNote(base), { ...valid({ externalId: "task-1", title: "Regression notes", markdown: "# Notes" }) });
		assert.deepEqual(validatePlannerNote({ ...base, topicId: " top_1 ", finished: false }), valid({ topicId: "top_1", markdown: "# Notes", finished: false }));
	});

	it("rejects missing, wrong-typed or empty fields", () => {
		const base = valid();
		for (const patch of [
			{ externalId: "" }, { subjectId: 5 }, { title: "   " }, { markdown: "" }, { finished: "yes" }, { finished: undefined },
			{ topicId: "" }, { topicId: 7 }, { date: "20-11-2026" }, { date: "2026-02-30" }, { title: "a/b" }, { title: "a\\b" }, { title: "a\nb" },
		]) assert.throws(() => validatePlannerNote({ ...base, ...patch }), PlannerNoteInputError, JSON.stringify(patch));
		for (const bad of [null, [], "note", 42]) assert.throws(() => validatePlannerNote(bad), PlannerNoteInputError);
	});

	it("rejects a title too long to name the material", () => {
		assert.throws(() => validatePlannerNote(valid({ title: "x".repeat(107) })), /at most 106 characters/);
	});
});

describe("planner note content", () => {
	it("names the material `<date> <title>.md`", () => {
		assert.equal(plannerNoteFileName(valid()), "2026-11-20 Regression notes.md");
	});

	it("marks unfinished notes inside the Markdown, followed by a blank line", () => {
		const note = valid({ markdown: "# Heading" });
		assert.equal(plannerNoteMarkdown(note), "# Heading");
		assert.equal(plannerNoteMarkdown({ ...note, finished: false }), "> Unfinished notes (task not completed)\n\n# Heading");
	});

	it("parses only string entries out of a hand-edited map", () => {
		assert.deepEqual(parsePlannerNoteMap({ a: "mat_1", b: 7, c: null }), { a: "mat_1" });
		assert.deepEqual(parsePlannerNoteMap(null), {});
	});
});

describe("upsertPlannerNote", () => {
	it("stores Markdown as a TEXT material in the requested scope and records the mapping", async () => {
		const f = setup();
		const note = valid({ subjectId: f.subject.id, topicId: f.topic.id, markdown: "# Heading", finished: false });
		const { materialId } = await upsertPlannerNote(note, { study: f.study, map: f.map });
		const material = f.study.library().materials.find((m) => m.id === materialId)!;
		assert.equal(material.fileName, "2026-11-20 Regression notes.md");
		assert.equal(material.kind, "text");
		assert.deepEqual(material.scope, { subjectId: f.subject.id, topicId: f.topic.id });
		assert.equal(f.store.readText(material.sha256), "> Unfinished notes (task not completed)\n\n# Heading");
		assert.deepEqual(f.data(), { "task-1": materialId });
	});

	it("re-sending the same note is a no-op; changed content replaces the old material", async () => {
		const f = setup();
		const note = valid({ subjectId: f.subject.id });
		const first = await upsertPlannerNote(note, { study: f.study, map: f.map });
		const again = await upsertPlannerNote({ ...note }, { study: f.study, map: f.map });
		assert.equal(again.materialId, first.materialId);
		assert.equal(f.study.library().materials.length, 1);

		const changed = await upsertPlannerNote({ ...note, markdown: "# Revised" }, { study: f.study, map: f.map });
		assert.notEqual(changed.materialId, first.materialId);
		assert.equal(f.study.library().materials.length, 1, "the replaced material is removed");
		const material = f.study.material(changed.materialId);
		assert.equal(f.store.readText(material.sha256), "# Revised");
		assert.deepEqual(f.data(), { "task-1": changed.materialId });
	});

	it("a finished flag, a rename or a scope change also replaces the material", async () => {
		const f = setup();
		const note = valid({ subjectId: f.subject.id });
		const first = await upsertPlannerNote({ ...note, finished: false }, { study: f.study, map: f.map });
		const done = await upsertPlannerNote({ ...note, finished: true }, { study: f.study, map: f.map });
		assert.notEqual(done.materialId, first.materialId);
		const renamed = await upsertPlannerNote({ ...note, title: "New title" }, { study: f.study, map: f.map });
		assert.equal(f.study.material(renamed.materialId).fileName, "2026-11-20 New title.md");
		const moved = await upsertPlannerNote({ ...note, topicId: f.topic.id }, { study: f.study, map: f.map });
		assert.deepEqual(f.study.material(moved.materialId).scope, { subjectId: f.subject.id, topicId: f.topic.id });
		assert.equal(f.study.library().materials.length, 1);
	});

	it("different task ids keep different materials", async () => {
		const f = setup();
		const a = await upsertPlannerNote(valid({ subjectId: f.subject.id, externalId: "a", markdown: "Task A" }), { study: f.study, map: f.map });
		const b = await upsertPlannerNote(valid({ subjectId: f.subject.id, externalId: "b", markdown: "Task B" }), { study: f.study, map: f.map });
		assert.notEqual(a.materialId, b.materialId);
		assert.deepEqual(f.data(), { a: a.materialId, b: b.materialId });
	});

	it("identical notes share a Study material, and updating one cannot dangle the other", async () => {
		const f = setup();
		const shared = valid({ subjectId: f.subject.id, externalId: "a" });
		const a = await upsertPlannerNote(shared, { study: f.study, map: f.map });
		const b = await upsertPlannerNote({ ...shared, externalId: "b" }, { study: f.study, map: f.map });
		assert.equal(a.materialId, b.materialId, "Study dedupes identical bytes in one scope");
		const revised = await upsertPlannerNote({ ...shared, markdown: "Revised A" }, { study: f.study, map: f.map });
		assert.notEqual(revised.materialId, a.materialId);
		assert.equal(f.study.material(b.materialId).fileName, shared.date + " " + shared.title + ".md");
		assert.deepEqual(f.data(), { a: revised.materialId, b: a.materialId });
	});

	it("refuses unknown subjects and topics outside the subject", async () => {
		const f = setup();
		const other = f.study.createSubject("Biology");
		const otherTopic = f.study.createTopic(other.id, "Cells");
		await assert.rejects(upsertPlannerNote(valid({ subjectId: "sub_gone" }), { study: f.study, map: f.map }), /Unknown subject/);
		await assert.rejects(upsertPlannerNote(valid({ subjectId: f.subject.id, topicId: "top_gone" }), { study: f.study, map: f.map }), /Unknown topic/);
		await assert.rejects(upsertPlannerNote(valid({ subjectId: f.subject.id, topicId: otherTopic.id }), { study: f.study, map: f.map }), /Unknown topic/);
		assert.deepEqual(f.data(), {});
		assert.equal(f.study.library().materials.length, 0);
	});
});

describe("planner CORS", () => {
	it("uses the default origins, and reads PLANNER_ORIGINS at call time", () => {
		assert.deepEqual(plannerOrigins({}), ["http://localhost:5173", "http://localhost:4173"]);
		assert.deepEqual(plannerOrigins({ PLANNER_ORIGINS: " http://app.test , , https://planner.test " }), ["http://app.test", "https://planner.test"]);
		assert.deepEqual(plannerOrigins({ PLANNER_ORIGINS: "" }), []);
	});

	it("echoes allowed origins on responses and preflights, and grants nothing to others", () => {
		const request = (origin: string) => new Request("http://localhost:3000/api/planner/notes", { headers: { Origin: origin } });
		const allowed = plannerCorsHeaders(request("http://localhost:5173"), "POST, OPTIONS");
		assert.equal(allowed["Access-Control-Allow-Origin"], "http://localhost:5173");
		assert.equal(allowed["Access-Control-Allow-Methods"], "POST, OPTIONS");
		assert.equal(allowed["Access-Control-Allow-Headers"], "Content-Type");
		assert.equal(allowed.Vary, "Origin");
		assert.equal(plannerCorsHeaders(request("http://evil.test"), "GET, OPTIONS")["Access-Control-Allow-Origin"], undefined);
		const preflight = plannerPreflight(request("http://localhost:4173"), "GET, OPTIONS");
		assert.equal(preflight.status, 204);
		assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "http://localhost:4173");
		assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");
	});
});
