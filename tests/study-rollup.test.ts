/**
 * Subject/topic file roll-up, text (markdown) materials, related-topic knowledge, chat-attachment paths and
 * the chat digest that "Create notes" summarises.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { studyInstructions, visibleMaterials } from "../src/core/study/doctrine.ts";
import { addMaterial, createSubject, createTopic, emptyLibrary, materialsUnder, relatedContexts, setContext } from "../src/core/study/model.ts";
import { isTextName, textOutline, textPages } from "../src/core/study/text-material.ts";
import { createStudyService, StudyInputError, type StudyPdf } from "../src/server/study.ts";
import { attachedPaths } from "../src/server/study-attachments.ts";
import { chatLines } from "../src/server/study-digest.ts";
import { createStudyStore } from "../src/store/study.ts";
import { lookup } from "../src/core/study/material-memory.ts";
import { openingOf } from "../src/server/chat-title.ts";

function library() {
	let lib = emptyLibrary();
	const s = createSubject(lib, "OS"); lib = s.library;
	const a = createTopic(lib, s.subject.id, "Scheduling"); lib = a.library;
	const b = createTopic(lib, s.subject.id, "Memory"); lib = b.library;
	const own = addMaterial(lib, { sha256: "a".repeat(64), fileName: "sched.pdf", pageCount: 3, bytes: 1, scope: { subjectId: s.subject.id, topicId: a.topic.id } }); lib = own.library;
	const wide = addMaterial(lib, { sha256: "b".repeat(64), fileName: "book.pdf", pageCount: 3, bytes: 1, scope: { subjectId: s.subject.id } }); lib = wide.library;
	const sib = addMaterial(lib, { sha256: "c".repeat(64), fileName: "paging.md", pageCount: 1, bytes: 1, scope: { subjectId: s.subject.id, topicId: b.topic.id }, kind: "text" }); lib = sib.library;
	return { lib, s: s.subject, a: a.topic, b: b.topic };
}

describe("files roll up from topics to the subject", () => {
	it("a subject lists every file in it, topics' included; a topic lists its own", () => {
		const f = library();
		assert.deepEqual(materialsUnder(f.lib, { subjectId: f.s.id }).map((m) => m.fileName).sort(), ["book.pdf", "paging.md", "sched.pdf"]);
		assert.deepEqual(materialsUnder(f.lib, { subjectId: f.s.id, topicId: f.a.id }).map((m) => m.fileName), ["sched.pdf"]);
	});

	it("a chat sees its own files first; a topic chat can reach the subject's and its neighbours'; a subject chat sees all", () => {
		const f = library();
		assert.deepEqual(visibleMaterials(f.lib, { subjectId: f.s.id, topicId: f.a.id, startMode: "check" }).map((m) => m.fileName), ["sched.pdf", "book.pdf", "paging.md"]);
		assert.deepEqual(visibleMaterials(f.lib, { subjectId: f.s.id, startMode: "check" }).map((m) => m.fileName).sort(), ["book.pdf", "paging.md", "sched.pdf"]);
	});
});

describe("what the agent knows flows between a subject and its topics", () => {
	it("a topic chat is shown the subject and its neighbouring topics; a subject chat is shown what each topic holds", () => {
		const f = library();
		let lib = setContext(f.lib, { subjectId: f.s.id }, "SUBJECT: operating systems");
		lib = setContext(lib, { subjectId: f.s.id, topicId: f.a.id }, "TOPIC-A: round robin");
		lib = setContext(lib, { subjectId: f.s.id, topicId: f.b.id }, "TOPIC-B: paging and TLBs");
		assert.deepEqual(relatedContexts(lib, { subjectId: f.s.id, topicId: f.a.id }).map((r) => r.name), ["Memory"]);
		const topicChat = studyInstructions({ library: lib, placement: { subjectId: f.s.id, topicId: f.a.id, startMode: "check" }, kind: "teach" });
		assert.ok(topicChat.indexOf("TOPIC-A") < topicChat.indexOf("SUBJECT:") && topicChat.includes("TOPIC-B: paging"), "own topic first, subject, then the neighbour");
		const subjectChat = studyInstructions({ library: lib, placement: { subjectId: f.s.id, startMode: "check" }, kind: "teach" });
		assert.ok(subjectChat.includes("TOPIC-A") && subjectChat.includes("TOPIC-B") && /What each topic holds/.test(subjectChat));
		assert.match(topicChat, /paging\.md[^\n]*text pages[^\n]*topic "Memory"/);
	});

	it("long neighbouring contexts are shortened and empty ones skipped", () => {
		const f = library();
		const lib = setContext(f.lib, { subjectId: f.s.id, topicId: f.b.id }, "x".repeat(5000));
		const [r] = relatedContexts(lib, { subjectId: f.s.id, topicId: f.a.id });
		assert.ok(r!.context.length <= 701);
		assert.deepEqual(relatedContexts(f.lib, { subjectId: f.s.id, topicId: f.a.id }), []);
	});
});

describe("text materials", () => {
	it("splits text into bounded pages and reads markdown headings as contents", () => {
		const md = "# Intro\n\nHello.\n\n" + Array.from({ length: 40 }, (_, i) => `## Part ${i}\n\n${"word ".repeat(120)}`).join("\n\n");
		const pages = textPages(md);
		assert.ok(pages.length > 3);
		assert.ok(pages.every((p) => p.length <= 2400), "pages fit the memory cap");
		const outline = textOutline(pages);
		assert.equal(outline.toc[0]!.title, "Intro");
		assert.ok(outline.toc.some((t) => t.title === "Part 39"));
		assert.deepEqual(textPages("   "), [""]);
		assert.ok(isTextName("Notes.MD") && isTextName("a.txt") && !isTextName("slides.pptx"));
		assert.ok(textPages("x".repeat(9000)).every((p) => p.length <= 2400), "a single long line is cut too");
	});

	describe("in the service", () => {
		const roots: string[] = [];
		afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
		const setup = () => {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), "study-text-")); roots.push(root);
			const pdf: StudyPdf = { async pageCount() { return 3; }, async texts() { return []; }, async render() { return []; } };
			const store = createStudyStore(root);
			return { svc: createStudyService(store, pdf), store, root };
		};
		const stored = (root: string) => (fs.existsSync(path.join(root, "materials")) ? fs.readdirSync(path.join(root, "materials")).length : 0);

		it("saves a .md file as a material that is remembered whole, shares one copy, and is cleaned up with its last reference", async () => {
			const { svc, store, root } = setup();
			const sub = svc.createSubject("OS"), topic = svc.createTopic(sub.id, "Paging");
			const bytes = Buffer.from("# Paging\n\nPages map virtual to physical memory.\n\n## TLB\n\nA cache of translations.");
			const a = await svc.addMaterial({ bytes, fileName: "paging.md", scope: { subjectId: sub.id, topicId: topic.id } });
			assert.equal(a.material.kind, "text");
			assert.equal(a.material.pageCount, 1);
			const memory = store.readMemory(a.material.sha256);
			assert.deepEqual(memory.read, [1]);
			assert.deepEqual(memory.toc.map((t) => t.title), ["Paging", "TLB"]);
			assert.match(JSON.stringify(lookup(memory, { query: "TLB" })), /TLB/);
			const b = await svc.addMaterial({ bytes, fileName: "paging-copy.txt", scope: { subjectId: sub.id } });
			assert.equal(b.alreadyStored, true);
			assert.equal(stored(root), 1);
			svc.removeMaterial(a.material.id);
			assert.equal(stored(root), 1, "still referenced by the subject-wide copy");
			svc.removeMaterial(b.material.id);
			assert.equal(stored(root), 0);
			assert.equal(fs.existsSync(path.join(root, "memory", `${a.material.sha256}.json`)), false);
		});

		it("refuses slides and binary files with a clear message", async () => {
			const { svc } = setup();
			const sub = svc.createSubject("OS");
			await assert.rejects(svc.addMaterial({ bytes: Buffer.from("PK zip"), fileName: "slides.pptx", scope: { subjectId: sub.id } }), /Only PDF, Markdown/);
			await assert.rejects(svc.addMaterial({ bytes: Buffer.from([0, 1, 2, 3]), fileName: "x.txt", scope: { subjectId: sub.id } }), StudyInputError);
		});
	});
});

describe("chat attachments", () => {
	it("finds quoted and bare PDF / markdown / text paths in a message and ignores everything else", () => {
		const text = String.raw`Please read "C:\Users\me\My Notes\week 1.pdf" and 'C:\data\uploads\2026\lecture.md' also C:\x\plain.txt, /home/me/a.pdf and https://example.com/z.pdf. Ignore C:\x\photo.png and "C:\x\slides.pptx".`;
		const found = attachedPaths(text);
		for (const p of [String.raw`C:\Users\me\My Notes\week 1.pdf`, String.raw`C:\data\uploads\2026\lecture.md`, String.raw`C:\x\plain.txt`, "/home/me/a.pdf"]) assert.ok(found.includes(p), p);
		assert.ok(!found.some((p) => /photo|slides|example\.com/.test(p)), found.join(" | "));
		assert.deepEqual(attachedPaths("no files here"), []);
	});
});

describe("backtick-quoted attachments (how the composer writes them)", () => {
	it("finds every path in a message of backticked paths", () => {
		const a = String.raw`C:\Users\me\repo\data\uploads\2026-11-19-8ecc\CS3.301_L13-L16_slide_notes.md`;
		const b = String.raw`C:\Users\me\repo\data\uploads\2026-11-19-8ecc\CS3.301_L07-L09_slide_notes.md`;
		assert.deepEqual(attachedPaths(`notes for todays lecture\`${a}\` \`${b}\``), [a, b]);
	});
});

describe("the chat digest", () => {
	it("keeps learner and tutor text only", () => {
		const lines = chatLines({ messages: [
			{ id: "1", role: "user", content: "What is  a mutex?" },
			{ id: "2", role: "assistant", content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "A lock." }, { type: "toolCall", name: "x" }] },
			{ id: "3", role: "toolResult", content: [{ type: "text", text: "secret" }] },
		] as never });
		assert.deepEqual(lines, ["Learner: What is a mutex?", "Tutor: A lock."]);
	});
});

describe("chat titles and file handover", () => {
	it("shortens attached paths to file names for the titler", () => {
		const o = openingOf("notes for todays lecture`C:\\Users\\me\\repo\\data\\uploads\\x\\CS3.301_L13.md` `C:\\a\\b\\L07.md`");
		assert.deepEqual(o.files, ["CS3.301_L13.md", "L07.md"]);
		assert.ok(!o.text.includes("Users"), o.text);
	});

	it("tells the agent that handing over files is not a question", () => {
		const f = library();
		for (const startMode of ["scratch", "check"] as const) {
			const text = studyInstructions({ library: f.lib, placement: { subjectId: f.s.id, startMode }, kind: "teach" });
			assert.match(text, /HANDING OVER FILES IS NOT A QUESTION/);
			assert.match(text, /Do NOT start teaching/);
		}
	});
});
