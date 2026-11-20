/**
 * Study agents (Phase D): the instructions a placed chat gets, the Study tools over fake ports, and the
 * scratch-start phase fold.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { studyTools, type StudyToolPorts } from "../src/agent/tools/study.ts";
import { createStudyChatTools } from "../src/agent/tools.ts";
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

	it("plain mode keeps the library listing but none of the teaching doctrine", () => {
		const f = fixture();
		const text = studyInstructions({ library: f.lib, placement: { subjectId: f.subjectId, topicId: f.topicId, startMode: "scratch" }, kind: "teach", mode: "plain" });
		assert.match(text, /This chat belongs to the subject "Machine Learning", topic "Dynamic programming"/);
		assert.ok(text.indexOf("TOPIC-CTX") < text.indexOf("SUBJECT-CTX"), "topic context comes first");
		assert.match(text, /## Materials/);
		assert.match(text, /dp\.pdf/);
		assert.match(text, /ml\.pdf/);
		for (const forbidden of [/Where to look, in this order/, /START FROM SCRATCH/, /CHECK WHAT THEY KNOW FIRST/, /HANDING OVER FILES IS NOT A QUESTION/, /Notes: keep the learner's class notes/, /Flashcards:/, /PRACTICE chat/]) {
			assert.ok(!forbidden.test(text), `plain mode must omit ${forbidden}`);
		}
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
			notes: {
				outline: () => "(no notes yet)",
				async add(planned, summary) { calls.push(`notes ${summary} ${planned.map((p) => p.block.type + (p.focus ? `:${p.focus}` : "")).join(",")}`); return "added"; },
				async edit(id, patch) { calls.push(`edit ${id} ${patch.text}`); return "Updated."; },
			},
			now: () => Date.parse("2026-11-19T10:00:00"),
		};
		const tools = studyTools(ports);
		const run = async (name: string, input: unknown): Promise<string> => {
			const result = await (tools[name]!.execute as (id: string, i: unknown) => Promise<{ content: Array<{ text?: string }> }>)("t1", input);
			return result.content.map((c) => c.text ?? "").join("");
		};
		return { f, tools, run, calls, stores, ports };
	};

	it("looks up and reads by material id or file name, and refuses unknown ones with the choices", async () => {
		const { f, run, calls } = setup();
		assert.match(await run("study_context", { material: f.topicMat.id, query: "bellman" }), /memory says hi/);
		await run("study_material", { material: "ml.pdf", pages: "1-3" });
		assert.deepEqual(calls, [`lookup ${f.topicMat.id} {"query":"bellman"}`, `read ${f.subjMat.id} 1,2,3`]);
		await assert.rejects(run("study_context", { material: "nope.pdf" }), /Unknown material.*dp\.pdf/s);
	});

	it("study_notes places blocks (figures resolved to the material), edits, and shows the outline", async () => {
		const { f, run, calls } = setup();
		assert.match(await run("study_notes", { action: "outline" }), /no notes yet/);
		await run("study_notes", { action: "add", summary: "Bellman", blocks: [{ type: "heading", text: "Bellman" }, { type: "figure", material: "dp.pdf", page: 12, focus: "the recursion" }, { type: "sticky", text: "exam!" }] });
		assert.deepEqual(calls, ["notes Bellman heading,figure:the recursion,sticky"]);
		await run("study_notes", { action: "edit", id: "el_1", text: "better" });
		assert.equal(calls[1], "edit el_1 better");
		void f;
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

	it("plain mode exposes only context/material/notes/note-export and no cards or practice tools", () => {
		const { ports } = setup();
		const tools = studyTools(ports, "plain");
		assert.deepEqual(Object.keys(tools).sort(), ["save_chat_notes", "study_context", "study_material", "study_notes"]);
		for (const excluded of ["study_cards", "study_practice_next", "study_practice_rate", "probe", "quiz", "explain", "recall", "ask_user_question"]) {
			assert.equal(tools[excluded], undefined, `${excluded} must not be in a plain study chat`);
		}
	});

	it("save_chat_notes writes Markdown through the port and returns the saved material details", async () => {
		const { ports } = setup();
		const saved = { id: "mat_1", title: "Chat notes", subjectId: ports.placement().subjectId, topicId: ports.placement().topicId, subjectName: "Machine Learning", topicName: "Dynamic programming" };
		let written: { title: string; markdown: string } | undefined;
		const tool = studyTools({ ...ports, async saveChatNotes(title, markdown) { written = { title, markdown }; return saved; } }, "plain").save_chat_notes!;
		const result = await (tool.execute as (id: string, input: unknown) => Promise<{ details: unknown }>)("t1", { title: "Chat notes", markdown: "# Notes\nBellman." });
		assert.deepEqual(written, { title: "Chat notes", markdown: "# Notes\nBellman." });
		assert.deepEqual(result.details, { tool: "save_chat_notes", saved: true, ...saved });
	});

	it("the plain chat's own registry excludes teaching, question and planning tools", () => {
		const ctx = {
			chatId: "c1",
			chatStore: { getChat: () => undefined, saveImageSnapshot: async () => {} },
			jobStore: { list: () => [] },
			spawn: () => {},
			search: () => null,
			searchAvailable: () => false,
		} as unknown as Parameters<typeof createStudyChatTools>[0];
		const names = Object.keys(createStudyChatTools(ctx));
		for (const required of ["read", "ls", "find", "grep", "show_image", "research", "demo", "visual", "pdf", "web_search", "web_fetch"]) {
			assert.ok(names.includes(required), `${required} should be available in a plain study chat`);
		}
		for (const excluded of ["probe", "quiz", "explain", "recall", "ask_user_question", "plan_init", "plan_add", "plan_done", "study_cards", "study_practice_next", "study_practice_rate", "save_chat_notes"]) {
			assert.ok(!names.includes(excluded), `${excluded} must not be in the plain chat's own registry`);
		}
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
