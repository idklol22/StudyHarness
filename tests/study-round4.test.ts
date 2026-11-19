/**
 * Round 4: editable ideas and topics, choosing a file's topic, notes coverage (≤ 32 source pages), subject fields,
 * the 3D knowledge graph data and layout, and the decluttered subject map.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptSuggestion, addIdea, addSuggestion, assignMaterial, editIdea, ideasOf, removeIdea } from "../src/core/study/ideas.ts";
import { addMaterial, createSubject, createTopic, emptyLibrary, materialsIn, type Library } from "../src/core/study/model.ts";
import { coverageByFile, coveredPages, MAX_SOURCE_PAGES, normalizeCoverage } from "../src/core/study/coverage.ts";
import { FIELDS, fieldDirection, guessField } from "../src/core/study/fields.ts";
import { buildStudyMap } from "../src/core/study/map.ts";
import { layoutStudyMap } from "../src/core/study/map-layout.ts";
import { knowledgeGraph } from "../src/core/study/knowledge-graph.ts";
import { buildKnowledgeTree, DEFAULT_TUNING, Layout3D, placeBalls } from "../components/graph-3d-layout.ts";

function lib() {
	let l: Library = emptyLibrary();
	const s = createSubject(l, "Algorithms"); l = s.library;
	const t = createTopic(l, s.subject.id, "Graphs"); l = t.library;
	const big = addMaterial(l, { sha256: "a".repeat(64), fileName: "book.pdf", pageCount: 100, bytes: 1, scope: { subjectId: s.subject.id } }); l = big.library;
	const small = addMaterial(l, { sha256: "b".repeat(64), fileName: "notes.md", pageCount: 5, bytes: 1, scope: { subjectId: s.subject.id }, kind: "text" }); l = small.library;
	return { l, s: s.subject, t: t.topic, big: big.material, small: small.material };
}

describe("editing ideas", () => {
	it("add, rename, re-describe and remove; names stay unique", () => {
		const f = lib();
		const scope = { subjectId: f.s.id, topicId: f.t.id };
		let l = addIdea(f.l, scope, { name: "Dijkstra", summary: "Shortest paths" });
		l = addIdea(l, scope, { name: "BFS" });
		const [d, b] = ideasOf(l, scope);
		l = editIdea(l, scope, d!.id, { name: "Dijkstra's algorithm", summary: "Non-negative weights" });
		assert.deepEqual(ideasOf(l, scope).map((i) => [i.name, i.summary]), [["Dijkstra's algorithm", "Non-negative weights"], ["BFS", ""]]);
		assert.throws(() => editIdea(l, scope, b!.id, { name: "dijkstra's ALGORITHM" }), /already has that name/);
		assert.throws(() => addIdea(l, scope, { name: "  " }), /needs a name/);
		l = removeIdea(l, scope, b!.id);
		assert.deepEqual(ideasOf(l, scope).map((i) => i.name), ["Dijkstra's algorithm"]);
	});
});

describe("choosing topics", () => {
	it("a file can be put in an existing topic or a new one by name; its suggestion goes", () => {
		const f = lib();
		let { library } = addSuggestion(f.l, f.big.id, [{ name: "DP", pages: { from: 1, to: 100 }, summary: "", ideas: [] }]);
		const a = assignMaterial(library, f.big.id, { topicId: f.t.id });
		assert.equal(a.topicId, f.t.id);
		assert.equal(materialsIn(a.library, { subjectId: f.s.id, topicId: f.t.id }).length, 1);
		assert.equal((a.library.suggestions ?? []).length, 0);
		const b = assignMaterial(a.library, f.small.id, { newTopicName: "Sorting" });
		assert.equal(b.library.topics.find((t) => t.id === b.topicId)!.name, "Sorting");
		assert.throws(() => assignMaterial(b.library, f.small.id, {}), /Choose a topic/);
		library = b.library;
	});

	it("accepting a suggestion uses the learner's edits: another existing topic, a new name, an edited idea list", () => {
		const f = lib();
		const { library, suggestion } = addSuggestion(f.l, f.big.id, [
			{ name: "Shortest paths", pages: { from: 1, to: 50 }, summary: "", ideas: [{ name: "Dijkstra", summary: "" }, { name: "Noise", summary: "" }] },
			{ name: "Sorting", pages: { from: 51, to: 100 }, summary: "", ideas: [{ name: "Merge sort", summary: "" }] },
		]);
		const r = acceptSuggestion(library, suggestion!.id, {
			0: { topicId: f.t.id, ideas: [{ name: "Dijkstra" }, { name: "Bellman-Ford", summary: "added by me" }] },
			1: { name: "Sorting algorithms", ideas: [] },
		});
		assert.equal(r.topics[0]!.topicId, f.t.id);
		assert.deepEqual(ideasOf(r.library, { subjectId: f.s.id, topicId: f.t.id }).map((i) => i.name), ["Dijkstra", "Bellman-Ford"]);
		const sorting = r.library.topics.find((t) => t.name === "Sorting algorithms")!;
		assert.deepEqual(ideasOf(r.library, { subjectId: f.s.id, topicId: sorting.id }), []);
	});
});

describe("notes coverage", () => {
	it("never more than 32 source pages; default covers files in order; ranges are clamped and merged", () => {
		const f = lib();
		const files = [f.big, f.small];
		const d = normalizeCoverage(files);
		assert.deepEqual(d, [{ materialId: f.big.id, from: 1, to: 32 }]);
		const picked = normalizeCoverage(files, [{ materialId: f.small.id, from: 0, to: 99 }, { materialId: f.big.id, from: 10, to: 20 }, { materialId: f.big.id, from: 21, to: 60 }, { materialId: "gone", from: 1, to: 3 }]);
		assert.deepEqual(picked, [{ materialId: f.small.id, from: 1, to: 5 }, { materialId: f.big.id, from: 10, to: 36 }]);
		assert.equal(coveredPages(picked), MAX_SOURCE_PAGES);
	});

	it("shows per file which notebooks cover which pages and how much is uncovered", () => {
		const f = lib();
		const cov = coverageByFile([f.big, f.small], [
			{ id: "n1", title: "Graphs revision", scopeName: "Graphs", href: "/x", covers: [{ materialId: f.big.id, from: 1, to: 20 }] },
			{ id: "n2", title: "More", scopeName: "Algorithms", href: "/y", covers: [{ materialId: f.big.id, from: 15, to: 30 }, { materialId: f.small.id, from: 1, to: 5 }] },
		]);
		assert.equal(cov.get(f.big.id)!.parts.length, 2);
		assert.equal(cov.get(f.big.id)!.uncovered, 70);
		assert.equal(cov.get(f.small.id)!.uncovered, 0);
	});
});

describe("fields and the 3D knowledge graph", () => {
	it("guesses fields from names and gives related fields nearby directions", () => {
		assert.equal(guessField("Algorithms"), "computing");
		assert.equal(guessField("Operating Systems"), "computing");
		assert.equal(guessField("Linear Algebra"), "mathematics");
		assert.equal(guessField("English"), "languages");
		assert.equal(guessField("World History"), "humanities");
		assert.equal(guessField("Zzz"), undefined);
		const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
		const c = fieldDirection("computing"), m = fieldDirection("mathematics"), l = fieldDirection("languages");
		assert.ok(dot(c, m) > dot(c, l), "computing is nearer mathematics than languages");
		for (const f of FIELDS) assert.ok(Math.abs(Math.hypot(...fieldDirection(f)) - 1) < 1e-9);
	});

	it("builds subject hubs → topics → ideas with explicit parents, anchors by field and cross-subject links", () => {
		let l: Library = emptyLibrary();
		const algo = createSubject(l, "Algorithms"); l = algo.library;
		const os = createSubject(l, "Operating Systems"); l = os.library;
		const eng = createSubject(l, "English"); l = eng.library;
		const t = createTopic(l, algo.subject.id, "Graphs"); l = t.library;
		const t2 = createTopic(l, os.subject.id, "Scheduling"); l = t2.library;
		l = addIdea(l, { subjectId: algo.subject.id, topicId: t.topic.id }, { name: "Queues" });
		l = addIdea(l, { subjectId: os.subject.id, topicId: t2.topic.id }, { name: "queues" });
		const g = knowledgeGraph(buildStudyMap({ library: l, chats: [] }));
		assert.deepEqual(g.clusters.map((c) => c.label), ["Algorithms", "English", "Operating Systems"]);
		const idea = g.nodes.find((n) => n.kind === "idea" && n.subjectId === algo.subject.id)!;
		assert.equal(g.parents[idea.id], t.topic.id);
		assert.ok(g.edges.some((e) => g.parents[e.from] && g.parents[e.to] && e.from !== e.to && g.parents[e.from] !== g.parents[e.to]), "the shared idea links the two subjects");
		assert.deepEqual(g.clusters.find((c) => c.id === eng.subject.id)?.members, [], "an empty subject is a group with no members (no placeholder node)");
		assert.ok(buildKnowledgeTree([], [], [eng.subject.id]).ids.includes(`__lh_hub__:${eng.subject.id}`), "and still gets its own hub");
		const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
		assert.ok(dot(g.anchors[algo.subject.id]!, g.anchors[os.subject.id]!) > dot(g.anchors[algo.subject.id]!, g.anchors[eng.subject.id]!));
		// The 3D tree takes the parents as given: hub → topic → idea.
		const tree = buildKnowledgeTree(g.nodes.map((n) => ({ id: n.id, cluster: n.subjectId, ...(g.parents[n.id] ? { parent: g.parents[n.id] } : {}) })), g.edges);
		const at = (id: string) => tree.ids.indexOf(id);
		assert.equal(tree.ids[tree.parent[at(idea.id)]!], t.topic.id);
		assert.equal(tree.ids[tree.parent[at(t.topic.id)]!], `__lh_hub__:${algo.subject.id}`);
	});

	it("subjects with an anchor settle on their field's side of the globe", () => {
		const radii = new Map([["a", 30], ["b", 30], ["c", 30]]);
		const anchors = new Map<string, [number, number, number]>([["a", [1, 0, 0]], ["b", [0.9, 0.3, 0]], ["c", [-1, 0, 0]]]);
		const out = placeBalls(radii, new Map(), anchors);
		const dir = (k: string) => { const p = out.get(k)!; const l = Math.hypot(...p); return p.map((x) => x / l); };
		const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
		assert.ok(dot(dir("a"), dir("b")) > dot(dir("a"), dir("c")), "a and b (neighbouring fields) are closer than a and c");
	});
});

describe("decluttered subject map", () => {
	it("a busy subject's nodes never overlap", () => {
		let l: Library = emptyLibrary();
		const s = createSubject(l, "Algorithms"); l = s.library;
		for (let t = 0; t < 7; t++) {
			const tp = createTopic(l, s.subject.id, `Topic ${t}`); l = tp.library;
			for (let i = 0; i < 12; i++) l = addIdea(l, { subjectId: s.subject.id, topicId: tp.topic.id }, { name: `Idea ${t}.${i}` });
		}
		const layout = layoutStudyMap(buildStudyMap({ library: l, chats: [] }));
		const nodes = layout.nodes;
		for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
			const d = Math.hypot(nodes[a]!.x - nodes[b]!.x, nodes[a]!.y - nodes[b]!.y);
			assert.ok(d >= nodes[a]!.r + nodes[b]!.r + 8, `${nodes[a]!.label} and ${nodes[b]!.label} are ${d.toFixed(1)} apart`);
		}
		assert.ok(nodes.filter((n) => n.kind === "idea").every((n) => n.parentId), "every idea knows its topic");
	});
});

describe("view sliders", () => {
	it("edge length and centre distance move the shells; subjects stay on one level", () => {
		let l: Library = emptyLibrary();
		const a = createSubject(l, "Algorithms"); l = a.library;
		const b = createSubject(l, "English"); l = b.library;
		const t = createTopic(l, a.subject.id, "Graphs"); l = t.library;
		l = addIdea(l, { subjectId: a.subject.id, topicId: t.topic.id }, { name: "BFS" });
		const g = knowledgeGraph(buildStudyMap({ library: l, chats: [] }));
		const layout = new Layout3D();
		layout.setGraph(g.nodes.map((n) => ({ id: n.id, x: 0, y: 0, cluster: n.subjectId, ...(g.parents[n.id] ? { parent: g.parents[n.id] } : {}) })), g.edges, new Map(Object.entries(g.anchors)));
		layout.settle();
		const dist = (id: string) => { const i = layout.indexOf(id); return Math.hypot(layout.pos[i * 3]!, layout.pos[i * 3 + 1]!, layout.pos[i * 3 + 2]!); };
		const hubA = `__lh_hub__:${a.subject.id}`, hubB = `__lh_hub__:${b.subject.id}`;
		assert.ok(Math.abs(dist(hubA) - dist(hubB)) < 2, "subjects share one level");
		assert.ok(dist(t.topic.id) > dist(hubA) + 20, "topics further out");
		const before = dist(hubA);
		layout.setTuning({ ...DEFAULT_TUNING, edgeLength: 2 });
		layout.settle();
		assert.ok(dist(hubA) > before * 1.7, "longer edges push everything out");
	});
});
