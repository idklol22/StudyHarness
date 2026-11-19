/**
 * The one knowledge graph (owner 2026-11-19): a 3D globe where every subject is a bigger node spoked to the centre,
 * subjects span out topics and topics span out ideas. Related subjects (same or neighbouring field, shared ideas)
 * sit near each other. This turns the Study map into what the 3D renderer draws. Pure.
 */
import { FIELDS, guessField, isField, type Field } from "./fields.ts";
import type { StudyMap } from "./map.ts";

export interface KnowledgeGraphData {
	/** Topics and ideas (subjects are the groups' hubs). */
	nodes: Array<{ id: string; label: string; kind: "topic" | "idea"; subjectId: string; href?: string }>;
	/** Tree branches (topic → idea) and interconnections (the same idea in two subjects). */
	edges: Array<{ from: string; to: string }>;
	/** Explicit tree parent: an idea's topic (topics and subject-wide ideas hang off their subject's hub). */
	parents: Record<string, string>;
	/** One group per subject: its hub is the subject node. */
	clusters: Array<{ id: string; label: string; members: string[] }>;
	/** Each subject's preferred direction from the centre (its field). */
	anchors: Record<string, [number, number, number]>;
}

const key = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Subjects round the globe: in field order (related fields are neighbours in FIELDS), evenly spread all the way
 * round the centre, with a bigger gap between subjects of unrelated fields than between subjects of one field.
 */
/** k points spread evenly over the sphere (exact for 1–4, a Fibonacci lattice beyond), deterministic. */
function evenSphere(k: number): Array<[number, number, number]> {
	if (k <= 1) return [[0.35, 0.5, 0.79]];
	if (k === 2) return [[1, 0, 0], [-1, 0, 0]];
	if (k === 3) return [0, 1, 2].map((i) => [Math.cos((i * 2 * Math.PI) / 3) * 0.94, (i - 1) * 0.34, Math.sin((i * 2 * Math.PI) / 3) * 0.94]).map((v) => { const l = Math.hypot(v[0]!, v[1]!, v[2]!); return [v[0]! / l, v[1]! / l, v[2]! / l] as [number, number, number]; });
	if (k === 4) { const c = 1 / Math.sqrt(3); return [[c, c, c], [c, -c, -c], [-c, c, -c], [-c, -c, c]]; }
	const golden = Math.PI * (3 - Math.sqrt(5));
	return Array.from({ length: k }, (_, i) => { const y = 1 - (2 * (i + 0.5)) / k, r = Math.sqrt(Math.max(0, 1 - y * y)), t = golden * i; return [Math.cos(t) * r, y, Math.sin(t) * r] as [number, number, number]; });
}

export function subjectDirections(subjects: ReadonlyArray<{ id: string; name: string; field?: string }>): Record<string, [number, number, number]> {
	const fieldOf = (s: { name: string; field?: string }): Field | undefined => (isField(s.field) ? s.field : guessField(s.name));
	const rank = (f: Field | undefined) => (f ? FIELDS.indexOf(f) : FIELDS.length);
	const order = [...subjects].sort((a, b) => rank(fieldOf(a)) - rank(fieldOf(b)) || a.name.localeCompare(b.name));
	const gap = (a: Field | undefined, b: Field | undefined) => {
		if (a && a === b) return 1;
		if (!a || !b) return 3;
		const d = Math.abs(FIELDS.indexOf(a) - FIELDS.indexOf(b));
		return 1 + Math.min(d, FIELDS.length - d);
	};
	const steps = order.map((s, i) => gap(fieldOf(s), fieldOf(order[(i + 1) % order.length]!)));
	// Points spread evenly over the WHOLE sphere (one per step, so unrelated fields leave empty points between them),
	// visited as a nearest-neighbour walk: consecutive subjects (same or neighbouring field) land next to each other,
	// and the walk uses every direction, not just a band.
	const total = order.length > 1 ? steps.reduce((x, y) => x + y, 0) : 1;
	const points = evenSphere(total);
	const used = new Set<number>();
	const out: Record<string, [number, number, number]> = {};
	let at = 0;
	used.add(0);
	order.forEach((s, i) => {
		out[s.id] = points[at]!;
		for (let k = 0; k < (steps[i] ?? 1) && used.size < points.length; k++) {
			let best = -1, bestD = Infinity;
			points.forEach((p, j) => { if (used.has(j)) return; const d = Math.hypot(p[0] - points[at]![0], p[1] - points[at]![1], p[2] - points[at]![2]); if (d < bestD) { bestD = d; best = j; } });
			if (best < 0) break;
			used.add(best); at = best;
		}
	});
	return out;
}

export function knowledgeGraph(map: StudyMap): KnowledgeGraphData {
	const out: KnowledgeGraphData = { nodes: [], edges: [], parents: {}, clusters: [], anchors: {} };
	const byIdea = new Map<string, Array<{ id: string; subjectId: string }>>();
	for (const s of map.subjects) {
		const members: string[] = [];
		for (const t of s.topics) {
			out.nodes.push({ id: t.id, label: t.name, kind: "topic", subjectId: s.id, href: t.href });
			members.push(t.id);
			for (const i of t.ideas) {
				out.nodes.push({ id: i.id, label: i.name, kind: "idea", subjectId: s.id });
				out.edges.push({ from: t.id, to: i.id });
				out.parents[i.id] = t.id;
				members.push(i.id);
				byIdea.set(key(i.name), [...(byIdea.get(key(i.name)) ?? []), { id: i.id, subjectId: s.id }]);
			}
		}
		for (const i of s.ideas) {
			out.nodes.push({ id: i.id, label: i.name, kind: "idea", subjectId: s.id });
			members.push(i.id);
			byIdea.set(key(i.name), [...(byIdea.get(key(i.name)) ?? []), { id: i.id, subjectId: s.id }]);
		}
		out.clusters.push({ id: s.id, label: s.name, members });
	}
	// The same idea in two subjects: an interconnection (it also pulls the two subjects together).
	for (const list of byIdea.values()) {
		for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
			if (list[a]!.subjectId !== list[b]!.subjectId) out.edges.push({ from: list[a]!.id, to: list[b]!.id });
		}
	}
	out.anchors = subjectDirections(map.subjects);
	return out;
}
