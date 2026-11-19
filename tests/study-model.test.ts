/**
 * The Study library model (subjects → topics → materials) and the per-file page memory.
 * Pure: no IO. Owner rules: user-defined subjects/topics, create-on-the-spot is idempotent, one stored
 * copy per file, and reclaiming copies nothing references any more.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	addMaterial, checkPlacement, contextScopes, createSubject, createTopic, deleteSubject, deleteTopic, emptyLibrary,
	materialsIn, moveMaterial, removeMaterial, renameSubject, renameTopic, setContext, topicsOf, type Library,
} from "../src/core/study/model.ts";
import {
	emptyMemory, formatLookup, lookup, parseRange, recordBatch, recordPages, unread,
} from "../src/core/study/material-memory.ts";

const HASH_A = "a".repeat(64), HASH_B = "b".repeat(64);
const setup = () => {
	let lib: Library = emptyLibrary();
	const ml = createSubject(lib, "Machine Learning"); lib = ml.library;
	const dp = createTopic(lib, ml.subject.id, "Dynamic programming"); lib = dp.library;
	const rl = createTopic(lib, ml.subject.id, "Reinforcement learning"); lib = rl.library;
	return { lib, ml: ml.subject, dp: dp.topic, rl: rl.topic };
};

describe("subjects and topics", () => {
	it("are user-defined; creating an existing name returns it (create on the spot is idempotent)", () => {
		const { lib, ml, dp } = setup();
		const again = createSubject(lib, "  machine   learning ");
		assert.equal(again.created, false);
		assert.equal(again.subject.id, ml.id);
		const topicAgain = createTopic(lib, ml.id, "DYNAMIC PROGRAMMING");
		assert.equal(topicAgain.created, false);
		assert.equal(topicAgain.topic.id, dp.id);
		assert.deepEqual(topicsOf(lib, ml.id).map((t) => t.name), ["Dynamic programming", "Reinforcement learning"]);
		assert.throws(() => createSubject(lib, "   "), /must not be empty/);
		assert.throws(() => createTopic(lib, "nope", "x"), /no longer exists/);
	});

	it("rename refuses a clash within the parent but allows the same name under another subject", () => {
		const { lib, ml, dp, rl } = setup();
		assert.throws(() => renameTopic(lib, rl.id, "dynamic programming"), /already has that name/);
		const other = createSubject(lib, "Algorithms");
		const withTopic = createTopic(other.library, other.subject.id, "Dynamic programming");
		assert.equal(withTopic.created, true, "the same topic name is fine in another subject");
		assert.equal(renameSubject(lib, ml.id, "ML").subjects[0]!.name, "ML");
		assert.throws(() => renameSubject(withTopic.library, other.subject.id, "machine learning"), /already has that name/);
		void dp;
	});
});

describe("materials", () => {
	it("share one stored copy per file; the same file in the same scope is a no-op", () => {
		const { lib, ml, dp, rl } = setup();
		const a = addMaterial(lib, { sha256: HASH_A, fileName: "C:\\x\\dp.pdf", pageCount: 80, bytes: 1000, scope: { subjectId: ml.id, topicId: dp.id } });
		assert.equal(a.material.fileName, "dp.pdf");
		assert.equal(a.shared, false);
		const same = addMaterial(a.library, { sha256: HASH_A, fileName: "dp.pdf", pageCount: 80, bytes: 1000, scope: { subjectId: ml.id, topicId: dp.id } });
		assert.equal(same.created, false);
		assert.equal(same.library.materials.length, 1);
		const other = addMaterial(a.library, { sha256: HASH_A, fileName: "dp.pdf", pageCount: 80, bytes: 1000, scope: { subjectId: ml.id, topicId: rl.id } });
		assert.equal(other.created, true);
		assert.equal(other.shared, true, "a second reference to an already stored file");
		assert.equal(other.library.materials.length, 2);
	});

	it("subject-wide and topic-level materials are listed per scope", () => {
		const { lib, ml, dp } = setup();
		let next = addMaterial(lib, { sha256: HASH_A, fileName: "book.pdf", pageCount: 300, bytes: 1, scope: { subjectId: ml.id } }).library;
		next = addMaterial(next, { sha256: HASH_B, fileName: "notes.pdf", pageCount: 5, bytes: 1, scope: { subjectId: ml.id, topicId: dp.id } }).library;
		assert.deepEqual(materialsIn(next, { subjectId: ml.id }).map((m) => m.fileName), ["book.pdf"]);
		assert.deepEqual(materialsIn(next, { subjectId: ml.id, topicId: dp.id }).map((m) => m.fileName), ["notes.pdf"]);
		assert.throws(() => addMaterial(next, { sha256: "xyz", fileName: "a.pdf", pageCount: 1, bytes: 1, scope: { subjectId: ml.id } }), /Invalid file hash/);
		assert.throws(() => addMaterial(next, { sha256: HASH_A, fileName: "a.pdf", pageCount: 1, bytes: 1, scope: { subjectId: "sub_x" } }), /no longer exists/);
	});

	it("deleting reclaims a stored copy only when nothing references it any more", () => {
		const { lib, ml, dp, rl } = setup();
		let next = addMaterial(lib, { sha256: HASH_A, fileName: "shared.pdf", pageCount: 9, bytes: 1, scope: { subjectId: ml.id, topicId: dp.id } }).library;
		next = addMaterial(next, { sha256: HASH_A, fileName: "shared.pdf", pageCount: 9, bytes: 1, scope: { subjectId: ml.id, topicId: rl.id } }).library;
		next = addMaterial(next, { sha256: HASH_B, fileName: "only-dp.pdf", pageCount: 9, bytes: 1, scope: { subjectId: ml.id, topicId: dp.id } }).library;
		const dropTopic = deleteTopic(next, dp.id);
		assert.deepEqual(dropTopic.orphaned, [HASH_B], "the shared file survives through the other topic");
		const dropSubject = deleteSubject(dropTopic.library, ml.id);
		assert.deepEqual(dropSubject.orphaned, [HASH_A]);
		assert.equal(dropSubject.library.topics.length, 0);
		assert.equal(dropSubject.library.materials.length, 0);
		const ref = next.materials.find((m) => m.sha256 === HASH_B)!;
		assert.deepEqual(removeMaterial(next, ref.id).orphaned, [HASH_B]);
	});

	it("moving to a scope that already has the file drops the duplicate reference", () => {
		const { lib, ml, dp } = setup();
		const a = addMaterial(lib, { sha256: HASH_A, fileName: "a.pdf", pageCount: 3, bytes: 1, scope: { subjectId: ml.id, topicId: dp.id } });
		const b = addMaterial(a.library, { sha256: HASH_A, fileName: "a.pdf", pageCount: 3, bytes: 1, scope: { subjectId: ml.id } });
		const moved = moveMaterial(b.library, a.material.id, { subjectId: ml.id });
		assert.equal(moved.materials.length, 1);
		const promoted = moveMaterial(a.library, a.material.id, { subjectId: ml.id });
		assert.deepEqual(promoted.materials[0]!.scope, { subjectId: ml.id });
	});
});

describe("context and placement", () => {
	it("keeps a context document per level; a chat sees topic context first, then subject", () => {
		const { lib, ml, dp } = setup();
		let next = setContext(lib, { subjectId: ml.id }, "ML overview.");
		next = setContext(next, { subjectId: ml.id, topicId: dp.id }, "DP: memoization covered.");
		const levels = contextScopes(next, { subjectId: ml.id, topicId: dp.id });
		assert.deepEqual(levels.map((l) => [l.level, l.context]), [["topic", "DP: memoization covered."], ["subject", "ML overview."]]);
		assert.deepEqual(contextScopes(next, { subjectId: ml.id }).map((l) => l.level), ["subject"]);
	});

	it("a chat placement needs a real subject/topic and an explicit start mode", () => {
		const { lib, ml, dp } = setup();
		assert.deepEqual(checkPlacement(lib, { subjectId: ml.id, topicId: dp.id, startMode: "scratch" }), { subjectId: ml.id, topicId: dp.id, startMode: "scratch" });
		assert.equal(checkPlacement(lib, { subjectId: ml.id }).startMode, "scratch");
		assert.throws(() => checkPlacement(lib, { startMode: "check" }), /Choose a subject/);
		assert.throws(() => checkPlacement(lib, { subjectId: ml.id, topicId: "top_gone", startMode: "check" }), /no longer exists/);
	});
});

describe("material memory", () => {
	it("page ranges: lists, ranges, clamping, all", () => {
		assert.deepEqual(parseRange("1-3, 7, 5-4", 10), [1, 2, 3, 4, 5, 7]);
		assert.deepEqual(parseRange("8-20", 10), [8, 9, 10]);
		assert.deepEqual(parseRange(undefined, 3), [1, 2, 3]);
		assert.throws(() => parseRange("one to five", 10), /page range/);
	});

	// An 80-page book whose printed page numbers are shifted by 6 (front matter).
	const book = () => {
		let m = recordBatch(emptyMemory(), {
			pages: [{ n: 3, text: "Contents  1 Introduction 1  2 Memoization 9  3 Exercises 41" }, { n: 4, text: "Preface" }],
			summary: "Title page, preface and the table of contents.",
			toc: [{ title: "Introduction", page: 1 }, { title: "Memoization", page: 9 }, { title: "Exercises", page: 41 }],
		});
		m = recordBatch(m, { pages: [{ n: 7, text: "1 Introduction Dynamic programming solves problems by combining subproblems." }, { n: 15, text: "2 Memoization caches each subproblem result." }], summary: "Introduces dynamic programming and memoization.", concepts: ["Dynamic programming", "Memoization"] });
		return m;
	};

	it("remembers each batch once; read pages are not read again; the same range replaces its memory", () => {
		let m = book();
		assert.deepEqual(m.read, [3, 4, 7, 15]);
		assert.equal(m.chunks.length, 2);
		assert.deepEqual(unread(m, [3, 4, 5, 7]), [5]);
		m = recordBatch(m, { pages: [{ n: 3, text: "again" }, { n: 4, text: "Preface" }], summary: "again", toc: [{ title: "exercises", page: 41 }] });
		assert.equal(m.chunks.length, 2);
		assert.equal(m.toc.length, 3);
		const fetched = recordPages(m, [{ n: 30, text: "fetched" }]);
		assert.deepEqual(unread(fetched, [30]), [30], "a fetched page has text but was never model-read");
		assert.equal(fetched.pages[30], "fetched");
	});

	it("the contents jump straight to the right PDF page and learn the printed-page offset", () => {
		const r = lookup(book(), { query: "go to the exercises" });
		assert.equal(r.kind, "search");
		if (r.kind !== "search") return;
		assert.equal(r.toc[0]!.title, "Exercises");
		assert.equal(r.toc[0]!.page, 47, "offset 6 learned from Introduction printed p.1 found on PDF page 7");
		assert.deepEqual(r.toc[0]!.around, [46, 47, 48]);
		assert.match(formatLookup("dp-book.pdf", r), /"Exercises" printed p\.41 → PDF page 47 \(estimated\); look at pages 46, 47, 48/);
	});

	it("topic lookups use summaries and page text with short excerpts; unknown pages are listed as missing", () => {
		const m = book();
		const r = lookup(m, { query: "memoization" });
		assert.ok(r.kind === "search" && r.chunks.some((c) => c.from === 7));
		assert.ok(r.kind === "search" && r.pages[0]!.n === 15 && r.pages.every((p) => p.excerpt.length <= 300));
		const exact = lookup(m, { pages: [15, 30] });
		assert.ok(exact.kind === "pages" && exact.pages[0]!.n === 15 && exact.missing[0] === 30);
		assert.match(formatLookup("b.pdf", lookup(m, { query: "quantum chromodynamics" })), /Nothing in the pages read so far matches/);
	});
});
