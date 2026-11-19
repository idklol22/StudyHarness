/**
 * The Study service: idempotent create-on-the-spot, hash-based material dedupe with a shared stored copy,
 * reclaiming files when nothing references them, rejection of non-PDFs, and memory/page fetching without
 * rereading what is already stored. Uses a fake PDF engine (no real PDF parsing).
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createStudyService, StudyInputError, type StudyPdf } from "../src/server/study.ts";
import { createStudyStore, sha256Of } from "../src/store/study.ts";
import { recordBatch, emptyMemory } from "../src/core/study/material-memory.ts";

const roots: string[] = [];
function setup() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "study-service-"));
	roots.push(root);
	const calls = { count: 0, texts: 0, render: 0 };
	const pdf: StudyPdf = {
		async pageCount() { calls.count++; return 12; },
		async texts(_p, pages) { calls.texts++; return pages.map((page) => ({ page, text: `text of page ${page}` })); },
		async render(_p, { pages }) { calls.render++; return pages.map((page) => ({ page, image: Buffer.from(`img${page}`).toString("base64"), mimeType: "image/jpeg" as const, width: 100, height: 60, text: "" })); },
	};
	const store = createStudyStore(root);
	return { svc: createStudyService(store, pdf), store, calls };
}
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const pdfBytes = (t: string) => Buffer.from(`%PDF-1.4\n${t}`);

describe("study service", () => {
	it("creating a subject or topic that exists returns it (create on the spot is idempotent)", () => {
		const { svc } = setup();
		const a = svc.createSubject("Statistics");
		assert.equal(svc.createSubject(" statistics ").id, a.id);
		const t = svc.createTopic(a.id, "Regression");
		assert.equal(svc.createTopic(a.id, "regression").id, t.id);
		assert.throws(() => svc.createTopic("sub_gone", "x"), StudyInputError);
		assert.equal(svc.library().topics.length, 1);
	});

	it("stores one copy per file; the same file in two topics shares it; non-PDFs are refused", async () => {
		const { svc, store, calls } = setup();
		const sub = svc.createSubject("ML");
		const dp = svc.createTopic(sub.id, "DP"), rl = svc.createTopic(sub.id, "RL");
		const bytes = pdfBytes("book");
		const first = await svc.addMaterial({ bytes, fileName: "C:\\x\\book.pdf", scope: { subjectId: sub.id, topicId: dp.id } });
		assert.equal(first.created, true);
		assert.equal(first.alreadyStored, false);
		assert.equal(first.material.pageCount, 12);
		const again = await svc.addMaterial({ bytes, fileName: "book.pdf", scope: { subjectId: sub.id, topicId: dp.id } });
		assert.equal(again.created, false);
		const second = await svc.addMaterial({ bytes, fileName: "book.pdf", scope: { subjectId: sub.id, topicId: rl.id } });
		assert.equal(second.alreadyStored, true);
		assert.equal(svc.library().materials.length, 2);
		assert.equal(fs.readdirSync(path.join(store.root, "materials")).length, 1, "one stored copy for both topics");
		assert.equal(first.material.fileName, "book.pdf");
		await assert.rejects(svc.addMaterial({ bytes: Buffer.from("PK zip file"), fileName: "slides.pptx", scope: { subjectId: sub.id } }), /Only PDF, Markdown/);
		assert.ok(calls.count >= 1);
	});

	it("an unreadable PDF leaves nothing stored", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "study-bad-")); roots.push(root);
		const store = createStudyStore(root);
		const svc = createStudyService(store, { pageCount: async () => { throw new Error("corrupt"); }, texts: async () => [], render: async () => [] });
		const sub = svc.createSubject("S");
		await assert.rejects(svc.addMaterial({ bytes: pdfBytes("bad"), fileName: "bad.pdf", scope: { subjectId: sub.id } }), /Could not read that PDF: corrupt/);
		assert.equal(store.hasMaterial(sha256Of(pdfBytes("bad"))), false);
		assert.equal(svc.library().materials.length, 0);
	});

	it("deleting a topic keeps a file another topic still uses; deleting the subject removes everything", async () => {
		const { svc, store } = setup();
		const sub = svc.createSubject("ML");
		const dp = svc.createTopic(sub.id, "DP"), rl = svc.createTopic(sub.id, "RL");
		const shared = pdfBytes("shared"), only = pdfBytes("only-dp");
		await svc.addMaterial({ bytes: shared, fileName: "shared.pdf", scope: { subjectId: sub.id, topicId: dp.id } });
		await svc.addMaterial({ bytes: shared, fileName: "shared.pdf", scope: { subjectId: sub.id, topicId: rl.id } });
		await svc.addMaterial({ bytes: only, fileName: "only.pdf", scope: { subjectId: sub.id, topicId: dp.id } });
		store.writeDoc("notes", dp.id, { pages: [] });
		store.writeMemory(sha256Of(only), emptyMemory());
		svc.deleteTopic(dp.id);
		assert.equal(store.hasMaterial(sha256Of(shared)), true);
		assert.equal(store.hasMaterial(sha256Of(only)), false, "unreferenced file removed with the topic");
		assert.equal(fs.existsSync(path.join(store.root, "memory", `${sha256Of(only)}.json`)), false);
		assert.equal(store.readDoc("notes", dp.id, null), null, "the notebook goes with its topic");
		svc.deleteSubject(sub.id);
		assert.equal(store.hasMaterial(sha256Of(shared)), false);
		assert.deepEqual(svc.sweep(), [], "nothing left to sweep");
	});

	it("page lookups answer from memory; missing pages are fetched once (text only) and remembered", async () => {
		const { svc, store, calls } = setup();
		const sub = svc.createSubject("ML");
		const { material } = await svc.addMaterial({ bytes: pdfBytes("m"), fileName: "m.pdf", scope: { subjectId: sub.id } });
		store.writeMemory(material.sha256, recordBatch(emptyMemory(), { pages: [{ n: 1, text: "memoization caches results" }], summary: "intro" }));
		const q = await svc.lookupPages(material.sha256, { query: "memoization" });
		assert.equal(q.result.kind, "search");
		assert.equal(calls.texts, 0, "a memory search never touches the PDF");
		const fetched = await svc.lookupPages(material.sha256, { pages: [1, 7] });
		assert.ok(fetched.result.kind === "pages" && fetched.result.pages.map((p) => p.n).join() === "1,7");
		assert.equal(calls.texts, 1);
		await svc.lookupPages(material.sha256, { pages: [7] });
		assert.equal(calls.texts, 1, "page 7 is now in memory: no second fetch");
	});

	it("page images are cached after the first render", async () => {
		const { svc, calls } = setup();
		const sub = svc.createSubject("ML");
		const { material } = await svc.addMaterial({ bytes: pdfBytes("img"), fileName: "i.pdf", scope: { subjectId: sub.id } });
		const a = await svc.pageImage(material.sha256, 4);
		const b = await svc.pageImage(material.sha256, 4);
		assert.equal(a.bytes.toString(), "img4");
		assert.equal(b.width, 100);
		assert.equal(calls.render, 1);
	});
});
