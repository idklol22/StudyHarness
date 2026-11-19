/**
 * The knowledge TREE layout for the 3D graph (pure: no DOM, no three.js).
 *
 * Owner, 2026-11-18: "everything connected to a central node; if a node references other nodes it's
 * a tree going from the central node out to them — expanding trees, with interconnections", then:
 * "fill the entire space around the centre, like a sphere, and minimise the interconnecting edges".
 *
 *   centre (ROOT_ID) → one hub per topic group (cluster: chat session, imported file or Study
 *   notebook) → that topic's ideas, expanding outward along their links.
 *
 * The graph store has no hierarchy yet, so the tree is DERIVED here (see buildKnowledgeTree): ideas
 * hang from their topic's hub; single-link leaves are twigs on the idea they link to. Links that are
 * not tree branches are "interconnections". When Study
 * notebooks give the store a real hierarchy (subject → notebook → concept), it replaces this
 * derivation without changing the renderer.
 *
 * Geometry — a hive of topic balls (owner, 2026-11-18, with an Obsidian "brain atlas" reference):
 *   - every topic is a dense BALL of its ideas; its hub sits at the ball's centre and its ideas fill
 *     the ball around it, so the edges inside a topic are all short;
 *   - the balls float in 3D around Knowledge (placeBalls): topics that share interconnections sit
 *     close, with a small gap, dissimilar ones further apart, and Knowledge is never on a straight line
 *     between them; the long spokes are only Knowledge → topic hub;
 *   - an idea linked to just one other idea of its topic is a short twig on that idea (at most three
 *     per idea);
 *   - ideas that link to another topic take the side of their ball that faces it; interconnections
 *     act as weak springs, while a guardrail keeps every idea inside its own ball.
 * Positions relax toward those targets with short-range repulsion, and existing positions are kept
 * when the graph changes, so new ideas grow into their branch instead of reshuffling everything.
 */

export interface Layout3DNode {
	id: string;
	/** Persisted 2D layout position (unused by the tree; kept for API parity). */
	x: number;
	y: number;
	cluster: string | null;
	/** Explicit tree parent (Study: an idea's topic). When any node has one, the tree is taken as given, not derived. */
	parent?: string;
}

export interface Layout3DEdge { from: string; to: string }

export const LAYOUT_LINK_DISTANCE = 40;
/** The virtual centre every topic hangs from. */
export const ROOT_ID = "__lh_root__";
/** The virtual hub of one topic group. */
export const hubId = (cluster: string): string => `__lh_hub__:${cluster}`;
export const isVirtualId = (id: string): boolean => id === ROOT_ID || id.startsWith("__lh_hub__:");
const isImpId = (id: string): boolean => id.startsWith("arg_");

export const NODE_IDEA = 0;
export const NODE_JUNCTION = 1;
export const NODE_HUB = 2;
export const NODE_ROOT = 3;

/** Short twigs one idea may carry; more single-link leaves become spokes of the topic. */
const MAX_TWIGS = 3;
/** The anchor key for ideas with no topic (they share one region of their own). */
const LOOSE = "";

const MIN_ALPHA = 0.004;
const ALPHA_DECAY = 0.982;
const VELOCITY_DECAY = 0.6;
const FULL_PAIRS_LIMIT = 700;
const SAMPLE_PER_NODE = 90;
const TARGET_PULL = 0.22;
const LINK_PULL = 0.08;
const BALL_GUARD = 0.5;
/** The guardrail engages a little outside the ball's radius. */
const BALL_SLACK = 1.12;

/** Small deterministic hash in [0, 1): stable seeding without Math.random. */
export function hash01(text: string): number {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
	return ((h >>> 0) % 100000) / 100000;
}

/** Radius of one topic's ball of k ideas: about 0.9 link-lengths between neighbouring ideas. */
export function ballRadius(k: number): number {
	return LAYOUT_LINK_DISTANCE * Math.max(0.6, 0.55 * Math.cbrt(Math.max(k, 1)));
}

/** Ball centres, relative to Knowledge at the origin (owner, 2026-11-18: "interconnected topics closer in
 *  the third dimension, never polar opposites of the centre, not flat").
 *
 *  A small deterministic simulation over the balls alone: topics that share interconnections are pulled
 *  together until only a small gap remains (the more links, the smaller), unlinked topics keep a wider
 *  berth, and no two balls ever overlap. Knowledge is then placed so the picture is truly 3D: with up to
 *  three topics it sits OFF the line/plane the balls form (two topics and Knowledge make a triangle, never
 *  a straight line); with more, the balls are kept clear of their middle and Knowledge sits there.
 *  `weights` maps "a|b" (sorted) to the number of interconnections between topics. */
export function placeBalls(radii: ReadonlyMap<string, number>, weights: ReadonlyMap<string, number> = new Map(), anchors: ReadonlyMap<string, readonly [number, number, number]> = new Map()): Map<string, [number, number, number]> {
	const L = LAYOUT_LINK_DISTANCE;
	const keys = [...radii.keys()].sort((a, b) => (radii.get(b)! - radii.get(a)!) || (a < b ? -1 : 1));
	const k = keys.length, out = new Map<string, [number, number, number]>();
	if (!k) return out;
	const R = keys.map((key) => radii.get(key)!), maxR = Math.max(...R);
	const w = (a: number, b: number) => { const x = keys[a]!, y = keys[b]!; return weights.get(x < y ? `${x}|${y}` : `${y}|${x}`) ?? 0; };
	// Seed: an even spread (linked topics already neighbours), tilted off any axis so nothing starts flat.
	const sizes = new Map(keys.map((key, i) => [key, R[i]!]));
	const seed = placeTopics(sizes, weights);
	// Field-anchored (Study) balls sit closer in, so a subject's own branches stay readable at the fitted zoom.
	const spread = anchors.size ? maxR * 1.7 + L * 1.4 : maxR * 3 + L * 2;
	const tilt = (v: readonly number[]): [number, number, number] => [v[0]! * 0.94 + v[1]! * 0.2, v[1]! * 0.94 - v[0]! * 0.2 + v[2]! * 0.27, v[2]! * 0.96 - v[1]! * 0.27];
	// A ball with an anchor (Study: the subject's field) starts on, and is pulled toward, its anchor's direction.
	const A = keys.map((key) => anchors.get(key));
	const P = keys.map((key, i) => (A[i] ? (A[i]!.map((x, j) => x * spread + (hash01(key + j) - 0.5) * L) as [number, number, number]) : (tilt(seed.get(key)!).map((x) => x * spread) as [number, number, number])));
	const many = k >= 4;
	for (let it = 0; it < 500; it++) {
		const F = P.map(() => [0, 0, 0]);
		for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) {
			const dx = P[b]![0] - P[a]![0], dy = P[b]![1] - P[a]![1], dz = P[b]![2] - P[a]![2];
			const d = Math.hypot(dx, dy, dz) + 1e-6, links = w(a, b);
			const touch = R[a]! + R[b]! + L * 0.8;
			const rest = links > 0 ? R[a]! + R[b]! + L * (0.9 + 2.4 / (1 + links)) : R[a]! + R[b]! + L * 3.5;
			let f = 0;
			if (links > 0) f = (d - rest) * 0.06; // linked: settle at the small gap
			else if (d < rest) f = (d - rest) * 0.06; // unlinked: only keep a berth
			if (d < touch) f += (d - touch) * 0.3; // never overlap
			const ux = dx / d, uy = dy / d, uz = dz / d;
			F[a]![0]! += ux * f; F[a]![1]! += uy * f; F[a]![2]! += uz * f;
			F[b]![0]! -= ux * f; F[b]![1]! -= uy * f; F[b]![2]! -= uz * f;
		}
		let cx = 0, cy = 0, cz = 0;
		for (const p of P) { cx += p[0]; cy += p[1]; cz += p[2]; }
		cx /= k; cy /= k; cz /= k;
		for (let a = 0; a < k; a++) {
			// Gentle compaction toward the middle; with many topics, keep the middle clear for Knowledge.
			F[a]![0]! -= (P[a]![0] - cx) * 0.01; F[a]![1]! -= (P[a]![1] - cy) * 0.01; F[a]![2]! -= (P[a]![2] - cz) * 0.01;
			if (many) {
				const dx = P[a]![0] - cx, dy = P[a]![1] - cy, dz = P[a]![2] - cz, d = Math.hypot(dx, dy, dz) + 1e-6, clear = R[a]! + L * 2.5;
				if (d < clear) { const f = (clear - d) * 0.2; F[a]![0]! += (dx / d) * f; F[a]![1]! += (dy / d) * f; F[a]![2]! += (dz / d) * f; }
			}
		}
		for (let a = 0; a < k; a++) {
			const anchor = A[a];
			if (!anchor) continue;
			const d = Math.max(Math.hypot(P[a]![0], P[a]![1], P[a]![2]), spread * 0.8);
			for (let j = 0; j < 3; j++) F[a]![j]! += (anchor[j]! * d - P[a]![j]!) * 0.05;
		}
		for (let a = 0; a < k; a++) { const p = P[a]!, q = F[a]!; p[0] += q[0]!; p[1] += q[1]!; p[2] += q[2]!; }
	}
	// Study: balls placed by their fields already surround the centre, which stays at the origin.
	if (anchors.size) { keys.forEach((key, i) => out.set(key, [P[i]![0], P[i]![1], P[i]![2]])); return out; }
	// Where Knowledge goes.
	let cx = 0, cy = 0, cz = 0;
	for (const p of P) { cx += p[0]; cy += p[1]; cz += p[2]; }
	cx /= k; cy /= k; cz /= k;
	let knowledge: [number, number, number] = [cx, cy, cz];
	if (!many) {
		// Off the balls' line / plane, "above" them where possible.
		let nx = 0, ny = 1, nz = 0;
		if (k === 2) {
			const ux = P[1]![0] - P[0]![0], uy = P[1]![1] - P[0]![1], uz = P[1]![2] - P[0]![2], ul = Math.hypot(ux, uy, uz) || 1;
			const dot = uy / ul; nx = -dot * ux / ul; ny = 1 - dot * uy / ul; nz = -dot * uz / ul;
		} else if (k === 3) {
			const ax = P[1]![0] - P[0]![0], ay = P[1]![1] - P[0]![1], az = P[1]![2] - P[0]![2];
			const bx = P[2]![0] - P[0]![0], by = P[2]![1] - P[0]![1], bz = P[2]![2] - P[0]![2];
			nx = ay * bz - az * by; ny = az * bx - ax * bz; nz = ax * by - ay * bx;
			if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
		}
		const nl = Math.hypot(nx, ny, nz) || 1;
		const lift = Math.max(maxR * 2.4, L * 4);
		knowledge = [cx + (nx / nl) * lift, cy + (ny / nl) * lift, cz + (nz / nl) * lift];
	}
	keys.forEach((key, i) => out.set(key, [P[i]![0] - knowledge[0], P[i]![1] - knowledge[1], P[i]![2] - knowledge[2]]));
	return out;
}

/** k points spread evenly over the unit sphere. Deterministic. Small counts use the exact optimum
 *  (2: opposite sides, 3: a triangle around the equator, 4: a tetrahedron); more use a Fibonacci lattice. */
export function fibonacciSphere(k: number): Array<[number, number, number]> {
	const out: Array<[number, number, number]> = [];
	if (k <= 0) return out;
	if (k === 1) return [[0, 0, 1]];
	if (k === 2) return [[1, 0, 0], [-1, 0, 0]];
	if (k === 3) return [0, 1, 2].map((i) => [Math.cos((i * 2 * Math.PI) / 3), 0, Math.sin((i * 2 * Math.PI) / 3)]);
	if (k === 4) { const c = 1 / Math.sqrt(3); return [[c, c, c], [c, -c, -c], [-c, c, -c], [-c, -c, c]]; }
	const golden = Math.PI * (3 - Math.sqrt(5));
	for (let i = 0; i < k; i++) {
		const y = 1 - (2 * (i + 0.5)) / k;
		const r = Math.sqrt(Math.max(0, 1 - y * y));
		const t = golden * i;
		out.push([Math.cos(t) * r, y, Math.sin(t) * r]);
	}
	return out;
}

/** k unit directions spread evenly inside the cone of half-angle `w` around unit `axis`. One child
 *  continues straight along the axis, so a chain reads as a straight branch. */
export function coneDirections(axis: readonly [number, number, number], w: number, k: number): Array<[number, number, number]> {
	if (k <= 0) return [];
	if (k === 1) return [[axis[0], axis[1], axis[2]]];
	const [ax, ay, az] = axis;
	const helper: [number, number, number] = Math.abs(ax) < 0.9 ? [1, 0, 0] : [0, 1, 0];
	let ux = helper[1] * az - helper[2] * ay, uy = helper[2] * ax - helper[0] * az, uz = helper[0] * ay - helper[1] * ax;
	const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
	const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
	const golden = Math.PI * (3 - Math.sqrt(5)), cosW = Math.cos(w), out: Array<[number, number, number]> = [];
	for (let i = 0; i < k; i++) {
		const z = 1 - (1 - cosW) * ((i + 0.5) / k);
		const r = Math.sqrt(Math.max(0, 1 - z * z)), t = golden * i;
		const a = Math.cos(t) * r, b = Math.sin(t) * r;
		out.push([a * ux + b * vx + z * ax, a * uy + b * vy + z * ay, a * uz + b * vz + z * az]);
	}
	return out;
}

const angleBetween = (a: readonly number[], b: readonly number[]) =>
	Math.acos(Math.max(-1, Math.min(1, a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!)));

/** One region direction per topic. Directions come from an even lattice; the biggest topic takes the
 *  first, then each next topic is the one most interconnected with those already placed, taking the
 *  free direction that minimises its link-weighted angle to them — so linked topics are neighbours.
 *  Deterministic. `weights` maps "a|b" (sorted) to the number of interconnections between topics. */
export function placeTopics(sizes: ReadonlyMap<string, number>, weights: ReadonlyMap<string, number> = new Map()): Map<string, [number, number, number]> {
	const topics = [...sizes.keys()].sort((a, b) => (sizes.get(b)! - sizes.get(a)!) || (a < b ? -1 : 1));
	const dirs = fibonacciSphere(topics.length);
	const w = (a: string, b: string) => weights.get(a < b ? `${a}|${b}` : `${b}|${a}`) ?? 0;
	const out = new Map<string, [number, number, number]>();
	const free = new Set(dirs.map((_, i) => i));
	const left = new Set(topics);
	while (left.size) {
		let pick = "", best = -1;
		for (const t of topics) {
			if (!left.has(t)) continue;
			const score = [...out.keys()].reduce((s, p) => s + w(t, p), 0);
			if (score > best) { best = score; pick = t; }
		}
		let slot = -1, cost = Infinity;
		for (const i of free) {
			const c = [...out].reduce((s, [p, d]) => s + w(pick, p) * angleBetween(dirs[i]!, d), 0);
			if (c < cost - 1e-9) { cost = c; slot = i; }
		}
		out.set(pick, dirs[slot]!);
		free.delete(slot); left.delete(pick);
	}
	return out;
}

export interface KnowledgeTree {
	/** Every node id: the input nodes in order, then the hubs, then the root. */
	ids: string[];
	kind: number[];
	/** Tree parent per index (-1 for the root and for junctions). */
	parent: number[];
	depth: number[];
	/** The topic group each index belongs to (hubs: their own group; root/ungrouped/junctions: null). */
	group: (string | null)[];
	/** Idea ↔ idea links (junctions contracted) that are NOT tree branches. */
	cross: Array<[number, number]>;
}

/** Derive the centre → topic → idea tree (see the module doc). Pure and deterministic. */
export function buildKnowledgeTree(nodes: readonly { id: string; cluster: string | null; parent?: string }[], edges: readonly Layout3DEdge[]): KnowledgeTree {
	const ids = nodes.map((n) => n.id);
	const group: (string | null)[] = nodes.map((n) => (isImpId(n.id) ? null : n.cluster));
	const kind: number[] = nodes.map((n) => (isImpId(n.id) ? NODE_JUNCTION : NODE_IDEA));
	const index = new Map(ids.map((id, i) => [id, i]));
	// Idea ↔ idea adjacency, junctions contracted (a junction links all of its ideas).
	const adj: Set<number>[] = ids.map(() => new Set());
	const junctionMembers = new Map<number, number[]>();
	for (const e of edges) {
		const a = index.get(e.from), b = index.get(e.to);
		if (a === undefined || b === undefined || a === b) continue;
		const ja = kind[a] === NODE_JUNCTION, jb = kind[b] === NODE_JUNCTION;
		if (!ja && !jb) { adj[a]!.add(b); adj[b]!.add(a); }
		else if (ja && !jb) junctionMembers.set(a, [...(junctionMembers.get(a) ?? []), b]);
		else if (jb && !ja) junctionMembers.set(b, [...(junctionMembers.get(b) ?? []), a]);
	}
	for (const members of junctionMembers.values()) for (const a of members) for (const b of members) if (a !== b) adj[a]!.add(b);

	const groups = [...new Set(group.filter((g): g is string => g !== null))].sort();
	const hubIndex = new Map<string, number>();
	for (const g of groups) { hubIndex.set(g, ids.length); ids.push(hubId(g)); kind.push(NODE_HUB); group.push(g); }
	const root = ids.length; ids.push(ROOT_ID); kind.push(NODE_ROOT); group.push(null);

	const parent = ids.map(() => -1), depth = ids.map(() => 0);
	for (const h of hubIndex.values()) { parent[h] = root; depth[h] = 1; }
	const byGroup = new Map<string | null, number[]>();
	for (let i = 0; i < nodes.length; i++) if (kind[i] === NODE_IDEA) byGroup.set(group[i]!, [...(byGroup.get(group[i]!) ?? []), i]);
	// Owner, 2026-11-18: no long edges, keep the round shape. Every idea hangs straight off its
	// topic's hub (one spoke each, all about the same length); an idea linked to exactly ONE other
	// idea of its topic, which itself has other links there, sits as a short twig on that idea.
	// Everything else is an interconnection (shown on hover / selection only).
	const explicit = nodes.some((n) => n.parent !== undefined);
	for (const [g, members] of byGroup) {
		const top = g === null ? root : hubIndex.get(g)!;
		if (explicit) {
			// Study: the tree is given (subject hub → topic → idea).
			for (const i of members) { const p = nodes[i]!.parent !== undefined ? index.get(nodes[i]!.parent!) : undefined; parent[i] = p !== undefined && p !== i ? p : top; }
			for (const i of members) depth[i] = parent[i] === top ? depth[top]! + 1 : depth[top]! + 2;
			continue;
		}
		const inTopic = (i: number) => [...adj[i]!].filter((j) => kind[j] === NODE_IDEA && group[j] === g);
		const twigCount = new Map<number, number>();
		for (const i of [...members].sort((a, b) => (ids[a]! < ids[b]! ? -1 : 1))) {
			const near = inTopic(i);
			const host = near.length === 1 && inTopic(near[0]!).length >= 2 ? near[0]! : -1;
			// At most MAX_TWIGS per idea: a hub-like idea's many leaves become spokes that fill the region.
			if (host >= 0 && (twigCount.get(host) ?? 0) < MAX_TWIGS) { parent[i] = host; twigCount.set(host, (twigCount.get(host) ?? 0) + 1); }
			else parent[i] = top;
		}
		for (const i of members) depth[i] = parent[i] === top ? depth[top]! + 1 : depth[top]! + 2;
	}
	const cross: Array<[number, number]> = [];
	for (let a = 0; a < nodes.length; a++) for (const b of adj[a]!) if (a < b && parent[a] !== b && parent[b] !== a) cross.push([a, b]);
	return { ids, kind, parent, depth, group, cross };
}

export class Layout3D {
	ids: string[] = [];
	kind: number[] = [];
	parent: number[] = [];
	depth: number[] = [];
	group: (string | null)[] = [];
	/** x, y, z per node, packed. */
	pos = new Float32Array(0);
	/** The outer extent of the hive (cluster distance + the biggest ball). */
	radius = LAYOUT_LINK_DISTANCE * 4;
	private vel = new Float32Array(0);
	private target = new Float32Array(0);
	/** Per node: its topic ball's centre and the guardrail radius (NaN = unguarded). */
	private ballCentre = new Float32Array(0);
	private ballLimit: number[] = [];
	/** Twigs: their offset from their idea, so they follow the idea wherever it settles. */
	private twigOffset = new Float32Array(0);
	private isTwig: boolean[] = [];
	private cross: Array<[number, number]> = [];
	private index = new Map<string, number>();
	private junctions = new Map<number, number[]>();
	alpha = 0;
	private rng = 1;

	get count(): number { return this.ids.length; }
	indexOf(id: string): number { return this.index.get(id) ?? -1; }
	get settled(): boolean { return this.alpha < MIN_ALPHA; }

	private random(): number { this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0; return this.rng / 4294967296; }

	/** Replace the graph. Existing nodes keep their position; new ones start at their branch target. */
	/** Study: each group's preferred direction from the centre (its field). */
	private anchors: ReadonlyMap<string, readonly [number, number, number]> = new Map();

	setGraph(nodes: Layout3DNode[], edges: Layout3DEdge[], anchors: ReadonlyMap<string, readonly [number, number, number]> = new Map()): void {
		this.anchors = anchors;
		const previous = new Map<string, [number, number, number]>();
		for (let i = 0; i < this.ids.length; i++) previous.set(this.ids[i]!, [this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!]);
		const tree = buildKnowledgeTree(nodes, edges);
		Object.assign(this, { ids: tree.ids, kind: tree.kind, parent: tree.parent, depth: tree.depth, group: tree.group, cross: tree.cross });
		const n = this.ids.length;
		this.index = new Map(this.ids.map((id, i) => [id, i]));
		this.junctions = new Map();
		for (const e of edges) {
			const a = this.index.get(e.from), b = this.index.get(e.to);
			if (a === undefined || b === undefined) continue;
			if (this.kind[a] === NODE_JUNCTION && this.kind[b] !== NODE_JUNCTION) this.junctions.set(a, [...(this.junctions.get(a) ?? []), b]);
			if (this.kind[b] === NODE_JUNCTION && this.kind[a] !== NODE_JUNCTION) this.junctions.set(b, [...(this.junctions.get(b) ?? []), a]);
		}
		this.computeTargets();
		this.pos = new Float32Array(n * 3);
		this.vel = new Float32Array(n * 3);
		let fresh = 0;
		for (let i = 0; i < n; i++) {
			if (this.kind[i] === NODE_ROOT) continue; // the centre stays exactly at the origin
			const old = previous.get(this.ids[i]!);
			if (old) { this.pos.set(old, i * 3); continue; }
			fresh++;
			const id = this.ids[i]!, j = LAYOUT_LINK_DISTANCE * 0.25;
			this.pos[i * 3] = this.target[i * 3]! + (hash01(id + "x") - 0.5) * j;
			this.pos[i * 3 + 1] = this.target[i * 3 + 1]! + (hash01(id + "y") - 0.5) * j;
			this.pos[i * 3 + 2] = this.target[i * 3 + 2]! + (hash01(id + "z") - 0.5) * j;
		}
		this.placeJunctions();
		this.alpha = previous.size === 0 ? 1 : Math.min(0.6, 0.08 + (fresh / Math.max(n, 1)) * 2);
	}

	/** The topic an index is anchored to (ungrouped ideas share the LOOSE region). */
	private regionKey(i: number): string | null {
		if (this.kind[i] === NODE_ROOT || this.kind[i] === NODE_JUNCTION) return null;
		return this.group[i] ?? LOOSE;
	}

	/** Branch targets: each topic a ball of ideas around its hub, the balls far out around Knowledge. */
	private computeTargets(): void {
		const n = this.ids.length, L = LAYOUT_LINK_DISTANCE;
		this.target = new Float32Array(n * 3);
		this.ballCentre = new Float32Array(n * 3);
		this.ballLimit = new Array<number>(n).fill(Number.NaN);
		this.twigOffset = new Float32Array(n * 3);
		this.isTwig = new Array<boolean>(n).fill(false);
		const children: number[][] = this.ids.map(() => []);
		let root = -1;
		for (let i = 0; i < n; i++) {
			if (this.kind[i] === NODE_ROOT) root = i;
			const p = this.parent[i]!;
			if (p >= 0) children[p]!.push(i);
		}
		if (root < 0) return;
		for (const c of children) c.sort((a, b) => (children[b]!.length - children[a]!.length) || (this.ids[a]! < this.ids[b]! ? -1 : 1));

		// Topics: ball sizes from their idea counts; neighbours by shared interconnections.
		const ideas = new Map<string, number>();
		for (let i = 0; i < n; i++) if (this.kind[i] === NODE_IDEA) { const k = this.regionKey(i)!; ideas.set(k, (ideas.get(k) ?? 0) + 1); }
		const weights = new Map<string, number>();
		for (const [a, b] of this.cross) {
			const ka = this.regionKey(a), kb = this.regionKey(b);
			if (ka === null || kb === null || ka === kb) continue;
			const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
			weights.set(key, (weights.get(key) ?? 0) + 1);
		}
		const ball = new Map([...ideas].map(([k, c]) => [k, ballRadius(c)]));
		const centres = placeBalls(ball, weights, this.anchors);
		this.radius = Math.max(L * 4, ...[...centres].map(([k, c]) => Math.hypot(...c) + ball.get(k)!));
		const centre = (k: string): [number, number, number] => centres.get(k)!;
		const setTarget = (i: number, p: readonly number[]) => { this.target[i * 3] = p[0]!; this.target[i * 3 + 1] = p[1]!; this.target[i * 3 + 2] = p[2]!; };
		const guard = (i: number, k: string, extra = 0) => {
			const c = centre(k);
			this.ballCentre[i * 3] = c[0]; this.ballCentre[i * 3 + 1] = c[1]; this.ballCentre[i * 3 + 2] = c[2];
			this.ballLimit[i] = ball.get(k)! * BALL_SLACK + extra;
		};

		// Which way each idea would like to lean: toward the topics it (or its twigs) link to.
		const pref = new Float32Array(n * 3);
		for (const [a, b] of this.cross) {
			const ka = this.regionKey(a), kb = this.regionKey(b);
			if (ka === null || kb === null || ka === kb) continue;
			// Toward the linked ball: the direction from this ball's centre to the other's.
			const ca = centre(ka), cb = centre(kb), d = Math.hypot(cb[0] - ca[0], cb[1] - ca[1], cb[2] - ca[2]) || 1;
			for (let k = 0; k < 3; k++) { const u = (cb[k]! - ca[k]!) / d; pref[a * 3 + k]! += u; pref[b * 3 + k]! -= u; }
		}
		for (let i = 0; i < n; i++) if (this.isTwigCandidate(i)) { const p = this.parent[i]!; for (let k = 0; k < 3; k++) pref[p * 3 + k]! += pref[i * 3 + k]!; }

		// Slots filling a ball evenly (directions from the lattice, radii by volume), outermost first.
		const ballSlots = (k: number, R: number): Array<[number, number, number]> => {
			const d = fibonacciSphere(k);
			return d.map((u, j) => { const r = R * Math.cbrt((j + 0.5) / k); return [u[0] * r, u[1] * r, u[2] * r] as [number, number, number]; })
				.sort((a, b) => Math.hypot(...b) - Math.hypot(...a));
		};
		/** Ideas with the strongest lean take the slot reaching furthest toward their lean. */
		const assign = (members: number[], slots: Array<[number, number, number]>): Array<[number, number, number]> => {
			const out = new Array<[number, number, number]>(members.length), free = new Set(slots.map((_, j) => j));
			const lean = (c: number) => Math.hypot(pref[c * 3]!, pref[c * 3 + 1]!, pref[c * 3 + 2]!);
			const order = members.map((c, j) => ({ c, j })).sort((x, y) => lean(y.c) - lean(x.c) || x.j - y.j);
			for (const { c, j } of order) {
				let slot = -1;
				if (lean(c) > 1e-9) {
					let best = -Infinity;
					for (const f of free) { const p = slots[f]!, dot = p[0] * pref[c * 3]! + p[1] * pref[c * 3 + 1]! + p[2] * pref[c * 3 + 2]!; if (dot > best) { best = dot; slot = f; } }
				} else slot = [...free].pop()!; // no lean: the innermost free slot, leaving the surface to linked ideas
				out[j] = slots[slot]!; free.delete(slot);
			}
			return out;
		};
		const twigStep = L * 0.35;
		const fillBall = (key: string, members: number[]) => {
			const c = centre(key), R = ball.get(key)!;
			const slots = assign(members, ballSlots(members.length, R));
			members.forEach((m, j) => {
				const o = slots[j]!;
				setTarget(m, [c[0] + o[0], c[1] + o[1], c[2] + o[2]]); guard(m, key);
				const twigs = children[m]!;
				if (!twigs.length) return;
				// Twigs: just outside their idea, pointing away from the ball's centre.
				const len = Math.hypot(...o);
				const out: [number, number, number] = len > 1e-6 ? [o[0] / len, o[1] / len, o[2] / len] : (() => { const c = centre(key), l = Math.hypot(...c) || 1; return [c[0] / l, c[1] / l, c[2] / l] as [number, number, number]; })();
				// Many children (a Study topic's ideas) open a wider cone further out, so they never bunch up.
				const step = twigs.length > 3 ? L * (0.62 + 0.05 * Math.min(twigs.length, 12)) : twigStep;
				const cone = twigs.length === 1 ? 0 : twigs.length > 3 ? Math.min(1.25, 0.55 + 0.07 * twigs.length) : 0.7;
				coneDirections(out, cone, twigs.length).forEach((td, t) => {
					const tw = twigs[t]!;
					this.isTwig[tw] = true;
					for (let k = 0; k < 3; k++) this.twigOffset[tw * 3 + k] = td[k]! * step;
					setTarget(tw, [c[0] + o[0] + td[0] * step, c[1] + o[1] + td[1] * step, c[2] + o[2] + td[2] * step]);
					guard(tw, key, step);
				});
			});
		};
		const loose: number[] = [];
		for (const top of children[root]!) {
			if (this.kind[top] !== NODE_HUB) { loose.push(top); continue; }
			const key = this.group[top]!;
			setTarget(top, centre(key)); guard(top, key);
			fillBall(key, children[top]!);
		}
		if (loose.length) fillBall(LOOSE, loose);
	}

	/** True when this idea's tree parent is another idea (it is a twig). */
	private isTwigCandidate(i: number): boolean {
		const p = this.parent[i]!;
		return p >= 0 && this.kind[i] === NODE_IDEA && this.kind[p] === NODE_IDEA;
	}

	/** Junctions are invisible geometry: they sit at the centroid of the ideas they join. */
	private placeJunctions(): void {
		for (const [j, members] of this.junctions) {
			let x = 0, y = 0, z = 0;
			for (const m of members) { x += this.pos[m * 3]!; y += this.pos[m * 3 + 1]!; z += this.pos[m * 3 + 2]!; }
			const k = Math.max(members.length, 1);
			this.pos[j * 3] = x / k; this.pos[j * 3 + 1] = y / k; this.pos[j * 3 + 2] = z / k;
		}
	}

	/** Advance the simulation. Returns true while nodes are still moving. */
	tick(steps = 1): boolean {
		for (let s = 0; s < steps && !this.settled; s++) this.step();
		return !this.settled;
	}

	private step(): void {
		const n = this.count, pos = this.pos, vel = this.vel, alpha = this.alpha, L = LAYOUT_LINK_DISTANCE;
		const fx = new Float32Array(n * 3);
		const moves = (i: number) => this.kind[i] === NODE_IDEA || this.kind[i] === NODE_HUB;
		// Short-range repulsion: keeps neighbours from overlapping, never stretches a branch.
		const repulse = (i: number, j: number) => {
			if (!moves(i) || !moves(j)) return;
			if (this.parent[i] === j || this.parent[j] === i) return; // a twig sits close to its idea by design
			let dx = pos[i * 3]! - pos[j * 3]!, dy = pos[i * 3 + 1]! - pos[j * 3 + 1]!, dz = pos[i * 3 + 2]! - pos[j * 3 + 2]!;
			let d2 = dx * dx + dy * dy + dz * dz;
			if (d2 > (L * 0.8) ** 2) return;
			if (d2 < 1e-4) { dx = this.random() - 0.5; dy = this.random() - 0.5; dz = this.random() - 0.5; d2 = dx * dx + dy * dy + dz * dz + 1e-3; }
			const f = (L * L * 0.08) / (d2 + 30) * alpha;
			const inv = 1 / Math.sqrt(d2);
			fx[i * 3]! += dx * inv * f; fx[i * 3 + 1]! += dy * inv * f; fx[i * 3 + 2]! += dz * inv * f;
			fx[j * 3]! -= dx * inv * f; fx[j * 3 + 1]! -= dy * inv * f; fx[j * 3 + 2]! -= dz * inv * f;
		};
		if (n <= FULL_PAIRS_LIMIT) { for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) repulse(i, j); }
		else for (let i = 0; i < n; i++) for (let k = 0; k < SAMPLE_PER_NODE; k++) { const j = Math.floor(this.random() * n); if (j !== i) repulse(i, j); }
		// Interconnections: weak springs, so linked ideas drift toward each other (toward the shared border).
		for (const [a, b] of this.cross) {
			if (!moves(a) || !moves(b)) continue;
			const dx = pos[b * 3]! - pos[a * 3]!, dy = pos[b * 3 + 1]! - pos[a * 3 + 1]!, dz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
			const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
			if (d <= L) continue;
			const f = ((d - L) / d) * LINK_PULL * alpha;
			fx[a * 3]! += dx * f; fx[a * 3 + 1]! += dy * f; fx[a * 3 + 2]! += dz * f;
			fx[b * 3]! -= dx * f; fx[b * 3 + 1]! -= dy * f; fx[b * 3 + 2]! -= dz * f;
		}
		for (let i = 0; i < n; i++) {
			if (!moves(i)) continue;
			// The tree: pulled to the branch target.
			// Twigs are held firmly next to their idea (wherever it is); spokes to their branch target.
			if (this.isTwig[i]) {
				const p = this.parent[i]!;
				for (let k = 0; k < 3; k++) fx[i * 3 + k]! += (pos[p * 3 + k]! + this.twigOffset[i * 3 + k]! - pos[i * 3 + k]!) * TARGET_PULL * 3 * alpha;
			} else for (let k = 0; k < 3; k++) fx[i * 3 + k]! += (this.target[i * 3 + k]! - pos[i * 3 + k]!) * TARGET_PULL * alpha;
			// The guardrail: back inside the topic's ball when links drag an idea out of it.
			const limit = this.ballLimit[i]!;
			if (Number.isNaN(limit)) continue;
			const bx = pos[i * 3]! - this.ballCentre[i * 3]!, by = pos[i * 3 + 1]! - this.ballCentre[i * 3 + 1]!, bz = pos[i * 3 + 2]! - this.ballCentre[i * 3 + 2]!;
			const d = Math.hypot(bx, by, bz);
			if (d <= limit) continue;
			const pull = (BALL_GUARD * (d - limit) / d) * alpha;
			fx[i * 3]! -= bx * pull; fx[i * 3 + 1]! -= by * pull; fx[i * 3 + 2]! -= bz * pull;
		}
		for (let i = 0; i < n; i++) {
			if (!moves(i)) continue;
			for (let k = 0; k < 3; k++) { const c = i * 3 + k; vel[c] = (vel[c]! + fx[c]!) * VELOCITY_DECAY; pos[c]! += vel[c]!; }
		}
		this.placeJunctions();
		this.alpha *= ALPHA_DECAY;
	}

	/** Run to rest synchronously (reduced motion, tests). Bounded. */
	settle(maxSteps = 700): void { for (let i = 0; i < maxSteps && !this.settled; i++) this.step(); }

	/** Centre and radius of the bounding sphere of the given node indices (all when omitted). */
	bounds(indices?: Iterable<number>): { cx: number; cy: number; cz: number; radius: number } {
		const list = indices ? [...indices] : this.ids.map((_, i) => i);
		if (!list.length) return { cx: 0, cy: 0, cz: 0, radius: LAYOUT_LINK_DISTANCE };
		let cx = 0, cy = 0, cz = 0;
		for (const i of list) { cx += this.pos[i * 3]!; cy += this.pos[i * 3 + 1]!; cz += this.pos[i * 3 + 2]!; }
		cx /= list.length; cy /= list.length; cz /= list.length;
		let r = 0;
		for (const i of list) r = Math.max(r, Math.hypot(this.pos[i * 3]! - cx, this.pos[i * 3 + 1]! - cy, this.pos[i * 3 + 2]! - cz));
		return { cx, cy, cz, radius: Math.max(r, LAYOUT_LINK_DISTANCE * 0.5) };
	}
}

// ─── Pure helpers used by the renderer (kept here so they are testable without WebGL) ───

/** The node nearest the pointer within each node's own pick radius, preferring the nearer-to-camera node on ties. */
export function pickNearest3D(
	screen: ReadonlyArray<{ x: number; y: number; r: number; depth: number; visible: boolean }>,
	px: number, py: number, pad = 6,
): number {
	let best = -1, bestScore = Infinity;
	for (let i = 0; i < screen.length; i++) {
		const s = screen[i]!; if (!s.visible) continue;
		const d = Math.hypot(s.x - px, s.y - py), reach = Math.max(10, s.r + pad);
		if (d > reach) continue;
		const score = d + s.depth * 0.001; // nearer-to-camera wins a tie
		if (score < bestScore) { bestScore = score; best = i; }
	}
	return best;
}

/** Camera distance that frames a sphere of this radius with a margin. */
export function fitDistance(radius: number, fovDegrees: number, aspect: number, margin = 1.18): number {
	const v = (fovDegrees * Math.PI) / 360;
	const h = Math.atan(Math.tan(v) * Math.max(aspect, 0.3));
	return (radius * margin) / Math.sin(Math.min(v, h));
}

export interface LabelCandidate { id: string; x: number; y: number; w: number; h: number; priority: number }
/** Greedy label placement: highest priority first, skipping any label that would overlap one already placed. */
export function placeLabels(candidates: LabelCandidate[], limit: number): LabelCandidate[] {
	const placed: LabelCandidate[] = [];
	for (const c of [...candidates].sort((a, b) => b.priority - a.priority)) {
		if (placed.length >= limit) break;
		const clash = placed.some((p) => Math.abs(p.x - c.x) < (p.w + c.w) / 2 + 3 && Math.abs(p.y - c.y) < (p.h + c.h) / 2 + 1);
		if (!clash) placed.push(c);
	}
	return placed;
}
