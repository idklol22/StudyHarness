/**
 * The 3D knowledge graph layout: Knowledge at the centre, each topic a dense ball of its ideas
 * around its hub, the balls far out in 3D, linked topics side by side (owner, 2026-11-18, with an
 * Obsidian "brain atlas" reference). Pure: no DOM, no WebGL.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	LAYOUT_LINK_DISTANCE,
	Layout3D,
	NODE_HUB,
	NODE_IDEA,
	NODE_JUNCTION,
	NODE_ROOT,
	ROOT_ID,
	ballRadius,
	buildKnowledgeTree,
	placeBalls,
	coneDirections,
	fibonacciSphere,
	fitDistance,
	focusGroup,
	focusSet,
	hubId,
	pickNearest3D,
	placeLabels,
	placeTopics,
} from "../components/graph-3d-layout.ts";

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe("buildKnowledgeTree: centre → topic hubs → ideas", () => {
	const nodes = [
		{ id: "a1", cluster: "algebra" }, { id: "a2", cluster: "algebra" }, { id: "a3", cluster: "algebra" }, { id: "a4", cluster: "algebra" },
		{ id: "b1", cluster: "biology" }, { id: "b2", cluster: "biology" },
		{ id: "arg_1", cluster: null }, { id: "loose", cluster: null },
	];
	const edges = [
		{ from: "a1", to: "a2" }, { from: "a1", to: "a3" },
		{ from: "a2", to: "b1" }, // cross-topic: an interconnection, never a branch
		{ from: "b1", to: "arg_1" }, { from: "b2", to: "arg_1" }, // a junction joins b1 and b2
	];
	const t = buildKnowledgeTree(nodes, edges);
	const at = (id: string) => t.ids.indexOf(id);
	const parentOf = (id: string) => t.ids[t.parent[at(id)]!];

	it("appends one hub per topic, then the centre", () => {
		assert.deepEqual(t.ids.slice(nodes.length), [hubId("algebra"), hubId("biology"), ROOT_ID]);
		assert.equal(t.kind[at(ROOT_ID)], NODE_ROOT);
		assert.equal(t.kind[at(hubId("algebra"))], NODE_HUB);
		assert.equal(t.kind[at("arg_1")], NODE_JUNCTION);
		assert.equal(t.kind[at("a1")], NODE_IDEA);
	});

	it("hangs hubs from the centre, ideas from their topic's hub, single-link leaves as twigs", () => {
		assert.equal(parentOf(hubId("algebra")), ROOT_ID);
		assert.equal(parentOf("a1"), hubId("algebra"));
		assert.equal(parentOf("a2"), "a1", "a single-link leaf is a twig on the idea it links to");
		assert.equal(parentOf("a3"), "a1");
		assert.equal(parentOf("a4"), hubId("algebra"), "an unlinked idea hangs straight off its hub");
		assert.equal(parentOf("b1"), hubId("biology"), "a mutual pair is two spokes, not a chain");
		assert.equal(parentOf("b2"), hubId("biology"));
		assert.equal(parentOf("loose"), ROOT_ID, "an ungrouped idea hangs off the centre");
		assert.equal(t.parent[at("arg_1")], -1, "junctions are not tree nodes");
	});

	it("never makes a cross-topic link a branch, and lists it as an interconnection", () => {
		assert.equal(parentOf("b1"), hubId("biology"));
		assert.ok(t.cross.some(([a, b]) => [t.ids[a], t.ids[b]].sort().join() === "a2,b1"));
	});

	it("caps twigs at three per idea, so a hub-like idea's leaves become spokes", () => {
		const star = buildKnowledgeTree(
			Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, cluster: "s" })),
			Array.from({ length: 7 }, (_, i) => ({ from: "s0", to: `s${i + 1}` })),
		);
		const twigs = star.ids.filter((_, i) => star.ids[star.parent[i]!] === "s0");
		assert.equal(twigs.length, 3);
	});
});

describe("direction helpers", () => {
	it("fibonacciSphere spreads directions evenly; small counts use the exact optimum", () => {
		const pts = fibonacciSphere(12);
		for (const p of pts) assert.ok(Math.abs(Math.hypot(...p) - 1) < 1e-9);
		let minGap = Infinity;
		for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) minGap = Math.min(minGap, dist(pts[i]!, pts[j]!));
		assert.ok(minGap > 0.6);
		const two = fibonacciSphere(2);
		assert.ok(Math.abs(dist(two[0]!, two[1]!) - 2) < 1e-9, "two topics sit on opposite sides");
	});

	it("coneDirections stays inside the cone; one child continues straight", () => {
		const axis: [number, number, number] = [0, 0, 1];
		assert.deepEqual(coneDirections(axis, 0.5, 1), [[0, 0, 1]]);
		for (const d of coneDirections(axis, 0.5, 9)) assert.ok(Math.acos(d[2]) <= 0.5 + 1e-9);
	});

	it("placeTopics puts the most interconnected topics next to each other", () => {
		const sizes = new Map([["a", 10], ["b", 9], ["c", 8], ["d", 7], ["e", 6], ["f", 5]]);
		const dirs = placeTopics(sizes, new Map([["a|f", 20]]));
		const angle = (x: string, y: string) => { const p = dirs.get(x)!, q = dirs.get(y)!; return Math.acos(p[0] * q[0] + p[1] * q[1] + p[2] * q[2]); };
		for (const other of ["b", "c", "d", "e"]) assert.ok(angle("a", "f") <= angle("a", other) + 1e-9, `f is a's nearest (vs ${other})`);
	});

	it("ballRadius grows with the cube root of a topic's ideas", () => {
		assert.ok(ballRadius(400) > ballRadius(50));
		assert.ok(Math.abs(ballRadius(8 * 50) / ballRadius(50) - 2) < 1e-9);
	});

	it("placeBalls: two linked topics sit close, and Knowledge is off the line between them (3D, not flat)", () => {
		const R = ballRadius(30);
		const c = placeBalls(new Map([["a", R], ["b", R]]), new Map([["a|b", 12]]));
		const a = c.get("a")!, b = c.get("b")!;
		const gap = dist(a, b) - 2 * R;
		assert.ok(gap > 0 && gap < LAYOUT_LINK_DISTANCE * 1.6, `gap ${gap.toFixed(0)}`);
		// Knowledge (the origin) is well off the segment a–b.
		const ux = (b[0] - a[0]) / dist(a, b), uy = (b[1] - a[1]) / dist(a, b), uz = (b[2] - a[2]) / dist(a, b);
		const t = -(a[0] * ux + a[1] * uy + a[2] * uz);
		const foot = [a[0] + ux * t, a[1] + uy * t, a[2] + uz * t];
		assert.ok(Math.hypot(...foot) > R * 2, "Knowledge sits off the line");
	});

	it("placeBalls: unlinked topics keep a wider berth than linked ones, and none overlap", () => {
		const r = new Map([["a", 60], ["b", 60], ["c", 60], ["d", 60], ["e", 60]]);
		const c = placeBalls(r, new Map([["a|b", 8]]));
		const d = (x: string, y: string) => dist(c.get(x)!, c.get(y)!);
		assert.ok(d("a", "b") < d("a", "c") && d("a", "b") < d("c", "d"));
		const keys = [...r.keys()];
		for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) assert.ok(d(keys[i]!, keys[j]!) > 120, `${keys[i]}–${keys[j]} overlap`);
		for (const k of keys) assert.ok(Math.hypot(...c.get(k)!) > 60, `${k} clear of Knowledge`);
	});
});

describe("Layout3D: a hive of topic balls around Knowledge", () => {
	const groups = ["algebra", "biology", "chemistry"];
	const nodes = groups.flatMap((g) => Array.from({ length: 24 }, (_, i) => ({ id: `${g}-${i}`, x: 0, y: 0, cluster: g })));
	const pairs = [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [2, 6], [2, 7], [4, 8], [8, 9], [10, 11], [12, 13], [12, 14]];
	const edges = groups.flatMap((g) => pairs.map(([a, b]) => ({ from: `${g}-${a}`, to: `${g}-${b}` })));
	const cross = [{ from: "algebra-20", to: "biology-20" }, { from: "algebra-21", to: "biology-21" }, { from: "algebra-22", to: "biology-22" }];
	const layout = new Layout3D();
	layout.setGraph(nodes, [...edges, ...cross]);
	layout.settle(900);
	const posOf = (id: string): [number, number, number] => { const i = layout.indexOf(id); return [layout.pos[i * 3]!, layout.pos[i * 3 + 1]!, layout.pos[i * 3 + 2]!]; };

	it("settles with Knowledge exactly at the centre", () => {
		assert.ok(layout.settled);
		assert.deepEqual(posOf(ROOT_ID), [0, 0, 0]);
	});

	it("makes each topic a compact ball around its hub", () => {
		const R = ballRadius(24);
		for (const n of nodes) assert.ok(dist(posOf(n.id), posOf(hubId(n.cluster))) < R * 1.25 + LAYOUT_LINK_DISTANCE * 0.4, `${n.id} inside its ball`);
	});

	it("keeps the balls far from Knowledge and clear of each other", () => {
		const R = ballRadius(24);
		for (const g of groups) assert.ok(Math.hypot(...posOf(hubId(g))) > R * 1.5, `${g} ball clear of the centre`);
		for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) {
			assert.ok(dist(posOf(hubId(groups[a]!)), posOf(hubId(groups[b]!))) > R * 2.2, `${groups[a]} and ${groups[b]} don't overlap`);
		}
	});

	it("keeps every edge inside a topic short: only Knowledge → hub spokes are long", () => {
		const R = ballRadius(24);
		for (let i = 0; i < layout.count; i++) {
			const p = layout.parent[i]!;
			if (p < 0 || layout.kind[i] === NODE_HUB) continue;
			assert.ok(dist(posOf(layout.ids[i]!), posOf(layout.ids[p]!)) < R * 1.25, `${layout.ids[i]} → ${layout.ids[p]} is short`);
		}
	});

	it("puts linked topics side by side and turns linked ideas toward each other", () => {
		const hubs = (a: string, b: string) => dist(posOf(hubId(a)), posOf(hubId(b)));
		// Three topics form an exact triangle (all pairs equally far), so this holds within rounding;
		// placeTopics above covers the neighbour rule with more topics.
		assert.ok(hubs("algebra", "biology") <= hubs("algebra", "chemistry") * 1.02);
		const mean = cross.reduce((t, e) => t + dist(posOf(e.from), posOf(e.to)), 0) / cross.length;
		assert.ok(mean < hubs("algebra", "biology"), "linked ideas sit on the facing sides of their balls");
	});

	it("keeps existing positions when the graph grows", () => {
		const before = posOf("biology-3");
		layout.setGraph([...nodes, { id: "biology-new", x: 0, y: 0, cluster: "biology" }], [...edges, ...cross, { from: "biology-3", to: "biology-new" }]);
		assert.deepEqual(posOf("biology-3"), before);
		assert.ok(layout.alpha < 0.6);
	});
});

describe("renderer helpers", () => {
	it("pickNearest3D prefers the nearer-to-camera node on ties and skips hidden nodes", () => {
		const screen = [
			{ x: 10, y: 10, r: 5, depth: 200, visible: true },
			{ x: 10, y: 10, r: 5, depth: 100, visible: true },
			{ x: 50, y: 50, r: 5, depth: 1, visible: false },
		];
		assert.equal(pickNearest3D(screen, 11, 10), 1);
		assert.equal(pickNearest3D(screen, 50, 50), -1);
	});

	it("fitDistance frames a larger sphere from farther away", () => {
		assert.ok(fitDistance(200, 50, 1.6) > fitDistance(100, 50, 1.6));
	});

	it("placeLabels keeps the highest priority and drops overlaps", () => {
		const placed = placeLabels([
			{ id: "a", x: 0, y: 0, w: 40, h: 12, priority: 1 },
			{ id: "b", x: 5, y: 0, w: 40, h: 12, priority: 2 },
			{ id: "c", x: 200, y: 0, w: 40, h: 12, priority: 0 },
		], 10);
		assert.deepEqual(placed.map((p) => p.id), ["b", "c"]);
	});
});

describe("Round 5: un-centred clusters, focus path and adaptive framing", () => {
	const build = () => {
		const nodes = [
			{ id: "t1", x: 0, y: 0, cluster: "algebra", parent: hubId("algebra") },
			{ id: "i1", x: 0, y: 0, cluster: "algebra", parent: "t1" },
			{ id: "i2", x: 0, y: 0, cluster: "algebra", parent: "t1" },
		];
		const edges = [{ from: "i1", to: "i2" }];
		const tree = buildKnowledgeTree(nodes, edges);
		const children: number[][] = tree.ids.map(() => []);
		for (let i = 0; i < tree.ids.length; i++) { const p = tree.parent[i]!; if (p >= 0) children[p]!.push(i); }
		const adjacency: Set<number>[] = tree.ids.map(() => new Set());
		for (const e of edges) {
			const a = tree.ids.indexOf(e.from), b = tree.ids.indexOf(e.to);
			adjacency[a]!.add(b); adjacency[b]!.add(a);
		}
		return { nodes, edges, tree, children, adjacency };
	};

	it("Study hover lights the whole path back to the centre, not just the node's own links", () => {
		const { tree, children, adjacency } = build();
		const idea = tree.ids.indexOf("i1"), topic = tree.ids.indexOf("t1"), hub = tree.ids.indexOf(hubId("algebra")), root = tree.ids.indexOf(ROOT_ID);
		const lit = focusSet(tree, children, adjacency, idea, true);
		for (const i of [idea, topic, hub, root]) assert.ok(lit.has(i), `lights index ${i}`);
		assert.ok(!focusSet(tree, children, adjacency, idea, false).has(root), "non-Study stops at the parent");
	});

	it("adaptive framing covers a whole subject, a topic with its ideas, or an idea with neighbours", () => {
		const { tree, children, adjacency } = build();
		const opts = { layout: tree, children, adjacency, topicIds: new Set(["t1"]), study: true };
		const hub = tree.ids.indexOf(hubId("algebra")), topic = tree.ids.indexOf("t1"), idea = tree.ids.indexOf("i1"), neighbour = tree.ids.indexOf("i2");
		assert.deepEqual(new Set(focusGroup({ ...opts, focus: hub })), new Set([hub, topic, idea, neighbour]));
		assert.deepEqual(new Set(focusGroup({ ...opts, focus: topic })), new Set([topic, idea, neighbour]));
		assert.deepEqual(new Set(focusGroup({ ...opts, focus: idea })), new Set([idea, neighbour]));
	});

	it("with the centre hidden each subject becomes its own centre, its clusters placed apart by field", () => {
		const nodes = ["alpha", "beta"].flatMap((g) => [
			{ id: `${g}-topic`, x: 0, y: 0, cluster: g, parent: hubId(g) },
			{ id: `${g}-idea`, x: 0, y: 0, cluster: g, parent: `${g}-topic` },
		]);
		const anchors = new Map([["alpha", [1, 0, 0] as const], ["beta", [0, 1, 0] as const]]);
		const layout = new Layout3D();
		layout.setGraph(nodes, [], anchors);
		assert.equal(layout.setCentred(false), true);
		assert.equal(layout.setCentred(false), false, "a repeat toggle is a no-op");
		layout.settle(900);
		const pos = (id: string): [number, number, number] => { const i = layout.indexOf(id); return [layout.pos[i * 3]!, layout.pos[i * 3 + 1]!, layout.pos[i * 3 + 2]!]; };
		const a = pos(hubId("alpha")), b = pos(hubId("beta"));
		assert.ok(dist(a, b) > LAYOUT_LINK_DISTANCE * 2, "subject clusters sit apart");
		assert.ok(dist(pos("alpha-topic"), a) < dist(pos("alpha-topic"), b), "topics stay near their own subject");
		assert.ok(dist(pos("beta-idea"), b) < dist(pos("beta-idea"), a), "ideas stay near their subject");
	});
});
