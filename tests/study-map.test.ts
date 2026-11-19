/**
 * The Study map: subject → topics → ideas (no file or chat nodes); an idea links to its files (with pages) and
 * chats; subjects sharing ideas are linked.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addMaterial, createSubject, createTopic, emptyLibrary, type Library } from "../src/core/study/model.ts";
import { mergeIdeas, setIdeas } from "../src/core/study/ideas.ts";
import { buildStudyMap, findMapIdea } from "../src/core/study/map.ts";
import { layoutStudyMap } from "../src/core/study/map-layout.ts";

function fixture() {
	let lib: Library = emptyLibrary();
	const os = createSubject(lib, "OS"); lib = os.library;
	const net = createSubject(lib, "Networks"); lib = net.library;
	const art = createSubject(lib, "Art"); lib = art.library;
	const sched = createTopic(lib, os.subject.id, "Scheduling"); lib = sched.library;
	const sockets = createTopic(lib, net.subject.id, "Sockets"); lib = sockets.library;
	const book = addMaterial(lib, { sha256: "a".repeat(64), fileName: "sched.pdf", pageCount: 40, bytes: 1, scope: { subjectId: os.subject.id, topicId: sched.topic.id } }); lib = book.library;
	let n = 0;
	const id = () => `idea_${++n}`;
	lib = setIdeas(lib, { subjectId: os.subject.id, topicId: sched.topic.id }, mergeIdeas([], [
		{ name: "Round robin", summary: "Each process gets a quantum.", file: { materialId: book.material.id, pages: "3-5" }, chat: "c1" },
		{ name: "Queues", summary: "Ready queue.", chat: "c1" },
	], id));
	lib = setIdeas(lib, { subjectId: net.subject.id, topicId: sockets.topic.id }, mergeIdeas([], [{ name: "queues", summary: "Socket buffers." }], id));
	lib = setIdeas(lib, { subjectId: os.subject.id }, mergeIdeas([], [{ name: "Kernel", summary: "The core." }], id));
	const chats = [{ id: "c1", title: "Round robin explained", placement: { subjectId: os.subject.id, topicId: sched.topic.id } }];
	return { lib, os: os.subject, net: net.subject, art: art.subject, chats, book: book.material };
}

describe("buildStudyMap", () => {
	it("hangs topics and their ideas under the subject; ideas link to files with pages and to chats", () => {
		const f = fixture();
		const map = buildStudyMap({ library: f.lib, chats: f.chats });
		const os = map.subjects.find((s) => s.id === f.os.id)!;
		assert.deepEqual(os.topics.map((t) => t.name), ["Scheduling"]);
		assert.deepEqual(os.topics[0]!.ideas.map((i) => i.name), ["Round robin", "Queues"]);
		assert.deepEqual(os.ideas.map((i) => i.name), ["Kernel"]);
		const rr = os.topics[0]!.ideas[0]!;
		assert.deepEqual(rr.files, [{ materialId: f.book.id, label: "sched.pdf", pages: "3-5", href: `/subjects/${f.os.id}/${os.topics[0]!.id}` }]);
		assert.deepEqual(rr.chats, [{ id: "c1", title: "Round robin explained", href: "/chat/c1" }]);
		assert.equal(findMapIdea(map, rr.id)?.topic?.name, "Scheduling");
	});

	it("links subjects that share an idea name, and through the idea graph", () => {
		const f = fixture();
		const map = buildStudyMap({ library: f.lib, chats: f.chats });
		assert.equal(map.links.length, 1);
		assert.deepEqual([map.links[0]!.a, map.links[0]!.b].sort(), [f.net.id, f.os.id].sort());
		assert.deepEqual(map.links[0]!.ideas.map((i) => i.toLowerCase()), ["queues"]);
		const withGraph = buildStudyMap({ library: f.lib, chats: [...f.chats, { id: "c2", title: "x", placement: { subjectId: f.art.id } }], graph: { propositions: [{ id: "n1", name: "Colour" }], logicalEdges: [], nodeSessions: { n1: ["c1", "c2"] } } });
		assert.ok(withGraph.links.some((l) => [l.a, l.b].includes(f.art.id) && l.ideas.includes("Colour")));
	});
});

describe("layoutStudyMap", () => {
	it("draws subjects, topics and ideas only — no file or chat nodes — and is deterministic", () => {
		const f = fixture();
		const map = buildStudyMap({ library: f.lib, chats: f.chats });
		const a = layoutStudyMap(map);
		assert.deepEqual(new Set(a.nodes.map((n) => n.kind)), new Set(["subject", "topic", "idea"]));
		assert.equal(a.nodes.filter((n) => n.kind === "idea").length, 4);
		assert.deepEqual(layoutStudyMap(map), a);
		for (const n of a.nodes) assert.ok(n.x >= 0 && n.y >= 0 && n.x <= a.w && n.y <= a.h);
		assert.equal(new Set(a.nodes.map((n) => n.id)).size, a.nodes.length);
	});

	it("a single subject sits at the centre with its topics on one ring", () => {
		let lib = emptyLibrary();
		const s = createSubject(lib, "OS"); lib = s.library;
		for (const name of ["A", "B", "C", "D"]) lib = createTopic(lib, s.subject.id, name).library;
		const layout = layoutStudyMap(buildStudyMap({ library: lib, chats: [] }));
		const hub = layout.nodes.find((n) => n.kind === "subject")!;
		const d = layout.nodes.filter((n) => n.kind === "topic").map((t) => Math.hypot(t.x - hub.x, t.y - hub.y));
		assert.ok(d.every((x) => Math.abs(x - d[0]!) < 1e-6));
		assert.ok(Math.abs(hub.x - layout.w / 2) < 1 && Math.abs(hub.y - layout.h / 2) < 1);
	});

	it("an empty library lays out nothing", () => {
		assert.deepEqual(layoutStudyMap({ subjects: [], links: [] }), { nodes: [], edges: [], links: [], w: 0, h: 0 });
	});
});
