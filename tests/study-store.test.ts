/**
 * The Study storage adapter: library round trip, one managed copy per file, hash-checked writes,
 * page-image pruning that keeps pinned pages, and reclaiming everything for an unreferenced file.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { addMaterial, createSubject, deleteSubject, emptyLibrary } from "../src/core/study/model.ts";
import { emptyMemory, recordBatch } from "../src/core/study/material-memory.ts";
import { createStudyStore, sha256Of } from "../src/store/study.ts";

const roots: string[] = [];
const store = () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "study-store-"));
	roots.push(root);
	let announced = 0;
	return { s: createStudyStore(root, () => { announced++; }), root, announced: () => announced };
};
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });

const pdf = (text: string) => Buffer.from(`%PDF-1.4\n${text}`);
const image = (n: number) => ({ bytes: Buffer.from(`image ${n}`), mimeType: "image/jpeg" as const, width: 160, height: 90 });

describe("study store", () => {
	it("round-trips the library and announces writes; an empty folder reads as an empty library", () => {
		const { s, announced } = store();
		assert.deepEqual(s.readLibrary(), emptyLibrary());
		const { library } = createSubject(emptyLibrary(), "Statistics");
		s.writeLibrary(library);
		assert.equal(s.readLibrary().subjects[0]!.name, "Statistics");
		assert.equal(announced(), 1);
	});

	it("stores one copy per file, refuses contents that do not match their hash", () => {
		const { s } = store();
		const bytes = pdf("a");
		const hash = sha256Of(bytes);
		assert.equal(s.saveMaterial(hash, bytes), true);
		assert.equal(s.saveMaterial(hash, bytes), false, "the identical copy already exists");
		assert.equal(fs.readFileSync(s.materialPath(hash)).equals(bytes), true);
		assert.throws(() => s.saveMaterial(sha256Of(pdf("b")), pdf("tampered")), /do not match/);
		assert.throws(() => s.materialPath("../../etc/passwd"), /Invalid file hash/);
	});

	it("keeps page memory per file and page images; pruning keeps pinned pages and the newest others", () => {
		const { s } = store();
		const hash = sha256Of(pdf("m"));
		s.writeMemory(hash, recordBatch(emptyMemory(), { pages: [{ n: 1, text: "one" }], summary: "s" }));
		assert.equal(s.readMemory(hash).pages[1], "one");
		assert.deepEqual(s.readMemory(sha256Of(pdf("none"))), emptyMemory());
		for (let n = 1; n <= 6; n++) { s.savePage(hash, n, image(n)); fs.utimesSync(path.join(s.root, "pages", hash, `${n}.json`), new Date(2026, 0, n), new Date(2026, 0, n)); }
		assert.equal(s.readPage(hash, 3)!.bytes.toString(), "image 3");
		assert.equal(s.prunePages(hash, new Set([1]), 3), 3);
		assert.equal(s.hasPage(hash, 1), true, "pinned (used in notes) stays even though oldest");
		assert.deepEqual([1, 2, 3, 4, 5, 6].filter((n) => s.hasPage(hash, n)), [1, 5, 6], "the newest others fill the remaining room");
		assert.equal(s.readPage(hash, 2), null);
	});

	it("deleting a library subject reclaims the stored file, its memory and its page images", () => {
		const { s } = store();
		const bytes = pdf("book");
		const hash = sha256Of(bytes);
		let { library, subject } = createSubject(emptyLibrary(), "Algorithms");
		library = addMaterial(library, { sha256: hash, fileName: "book.pdf", pageCount: 9, bytes: bytes.length, scope: { subjectId: subject.id } }).library;
		s.saveMaterial(hash, bytes);
		s.writeMemory(hash, emptyMemory());
		s.savePage(hash, 1, image(1));
		const removal = deleteSubject(library, subject.id);
		for (const orphan of removal.orphaned) s.deleteFile(orphan);
		assert.equal(s.hasMaterial(hash), false);
		assert.equal(fs.existsSync(path.join(s.root, "memory", `${hash}.json`)), false);
		assert.equal(fs.existsSync(path.join(s.root, "pages", hash)), false);
	});

	it("the sweep removes stored files no material references (the safety net)", () => {
		const { s } = store();
		const keep = pdf("keep"), drop = pdf("drop");
		s.saveMaterial(sha256Of(keep), keep);
		s.saveMaterial(sha256Of(drop), drop);
		let { library, subject } = createSubject(emptyLibrary(), "S");
		library = addMaterial(library, { sha256: sha256Of(keep), fileName: "keep.pdf", pageCount: 1, bytes: 1, scope: { subjectId: subject.id } }).library;
		assert.deepEqual(s.sweepUnreferenced(library), [sha256Of(drop)]);
		assert.equal(s.hasMaterial(sha256Of(keep)), true);
	});

	it("notebook and card documents are keyed, listed and deleted by scope key", () => {
		const { s } = store();
		s.writeDoc("notes", "top_abc", { pages: [] });
		assert.deepEqual(s.readDoc("notes", "top_abc", null), { pages: [] });
		assert.deepEqual(s.listDocs("notes"), ["top_abc"]);
		s.deleteDoc("notes", "top_abc");
		assert.equal(s.readDoc("notes", "top_abc", "gone"), "gone");
		assert.throws(() => s.writeDoc("notes", "../x", {}), /Invalid key/);
	});
});
