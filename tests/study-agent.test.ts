/**
 * Study agents (Phase D): the instructions a placed chat gets, the Study tools over fake ports, and the
 * scratch-start phase fold.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { studyTools, type StudyToolPorts } from "../src/agent/tools/study.ts";
import { emptyCards, type CardSet } from "../src/core/study/cards.ts";
import { studyInstructions } from "../src/core/study/doctrine.ts";
import { addMaterial, createSubject, createTopic, emptyLibrary, setContext, type Library } from "../src/core/study/model.ts";
import { phaseAt3Lh, phaseTimeline } from "../src/core/phases.ts";

function fixture() {
	let lib = emptyLibrary();
	const s = createSubject(lib, "Machine Learning"); lib = s.library;
	const t = createTopic(lib, s.subject.id, "Dynamic programming"); lib = t.library;
	lib = setContext(lib, { subjectId: s.subject.id }, "SUBJECT-CTX: intro to ML");
	lib = setContext(lib, { subjectId: s.subject.id, topicId: t.topic.id }, "TOPIC-CTX: bellman");
	const topicMat = addMaterial(lib, { sha256: "a".repeat(64), fileName: "dp.pdf", pageCount: 40, bytes: 10, scope: { subjectId: s.subject.id, topicId: t.topic.id } }); lib = topicMat.library;
	const subjMat = addMaterial(lib, { sha256: "b".repeat(64), fileName: "ml.pdf", pageCount: 80, bytes: 10, scope: { subjectId: s.subject.id } }); lib = subjMat.library;
	return { lib, subjectId: s.subject.id, topicId: t.topic.id, topicMat: topicMat.material, subjMat: subjMat.material };
}

describe("study instructions", () => {
	it("lists the layers topic first, then subject, with materials of both and the scratch doctrine", () => {
		const f = fixture();
		const text = studyInstructions({ library: f.lib, placement: { subjectId: f.subjectId, topicId: f.topicId, startMode: "scratch" }, kind: "teach" });
		assert.ok(text.indexOf("TOPIC-CTX") < text.indexOf("SUBJECT-CTX"), "topic context comes first");
		assert.match(text, /dp\.pdf/);
		assert.match(text, /ml\.pdf/);
		assert.match(text, /START FROM SCRATCH/);
		assert.match(text, /Never read the same pages twice/);
		assert.ok(!/CHECK WHAT THEY KNOW/.test(text));
	});

	it("check mode keeps the probe; practice gets the practice doctrine; a stale subject gives nothing", () => {
		const f = fixture();
		assert.match(studyInstructions({ library: f.lib, placement: { subjectId: f.subjectId, startMode: "check" }, kind: "teach" }), /CHECK WHAT THEY KNOW FIRST/);
		assert.match(studyInstructions({ library: f.lib, placement: { subjectId: f.subjectId, startMode: "check" }, kind: "practice" }), /PRACTICE chat/);
		assert.equal(studyInstructions({ library: f.lib, placement: { subjectId: "sub_gone", startMode: "check" }, kind: "teach" }), "");
		const empty = studyInstructions({ library: { ...f.lib, materials: [] }, placement: { subjectId: f.subjectId, startMode: "scratch" }, kind: "teach" });
		assert.match(empty, /None uploaded yet/);
	});
});

describe("study tools", () => {
	const setup = () => {
		const f = fixture();
		const stores = new Map<string, CardSet>();
		const calls: string[] = [];
		const ports: StudyToolPorts = {
			library: () => f.lib,
			placement: () => ({ subjectId: f.subjectId, topicId: f.topicId, startMode: "scratch" }),
			async lookup(id, input) { calls.push(`lookup ${id} ${JSON.stringify(input)}`); return "memory says hi"; },
			async read(id, pages) { calls.push(`read ${id} ${pages.join(",")}`); return "read ok"; },
			cards: () => [{ key: f.topicId, group: "Dynamic programming", set: stores.get(f.topicId) ?? emptyCards() }],
			saveCards: (key, set) => { stores.set(key, set); },
			ownCardKey: () => ({ key: f.topicId, group: "Dynamic programming" }),
			now: () => Date.parse("2026-11-19T10:00:00"),
		};
		const tools = studyTools(ports);
		const run = async (name: string, input: unknown): Promise<string> => {
			const result = await (tools[name]!.execute as (id: string, i: unknown) => Promise<{ content: Array<{ text?: string }> }>)("t1", input);
			return result.content.map((c) => c.text ?? "").join("");
		};
		return { f, tools, run, calls, stores };
	};

	it("looks up and reads by material id or file name, and refuses unknown ones with the choices", async () => {
		const { f, run, calls } = setup();
		assert.match(await run("study_context", { material: f.topicMat.id, query: "bellman" }), /memory says hi/);
		await run("study_material", { material: "ml.pdf", pages: "1-3" });
		assert.deepEqual(calls, [`lookup ${f.topicMat.id} {"query":"bellman"}`, `read ${f.subjMat.id} 1,2,3`]);
		await assert.rejects(run("study_context", { material: "nope.pdf" }), /Unknown material.*dp\.pdf/s);
	});

	it("adds cards (skipping duplicates), practises the next card and records a rating", async () => {
		const { run, stores, f } = setup();
		assert.match(await run("study_cards", { action: "add", cards: [{ q: "What is memoization?", a: "Caching." }, { q: "what is memoization?", a: "dup" }] }), /Added 1 card.*1 already existed/);
		assert.equal(stores.get(f.topicId)!.cards[0]!.group, "Dynamic programming");
		const next = await run("study_practice_next", { mode: "due" });
		assert.match(next, /What is memoization\?/);
		const id = stores.get(f.topicId)!.cards[0]!.id;
		assert.match(await run("study_practice_rate", { id, rating: 3 }), /Rated 3/);
		assert.equal(stores.get(f.topicId)!.cards[0]!.reviews.length, 1);
		assert.match(await run("study_practice_next", { mode: "due" }), /Nothing to practise/);
		assert.match(await run("study_cards", { action: "remove", id }), /Removed/);
		assert.match(await run("study_practice_next", { mode: "all" }), /no cards yet/);
	});
});

describe("scratch start phases", () => {
	it("a chat that starts from scratch begins in planning, not probing", () => {
		assert.equal(phaseAt3Lh([]), "probe");
		assert.equal(phaseAt3Lh([], undefined, "plan"), "plan");
		assert.deepEqual(phaseTimeline([{ parts: [] }, { parts: [] }], "plan"), ["plan", "plan"]);
		assert.deepEqual(phaseTimeline([{ parts: [] }]), ["probe"]);
	});
});

export type { Library };
