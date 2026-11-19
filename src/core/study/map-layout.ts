/**
 * Deterministic layout of the Study map: every subject is a hub at the centre of its own cluster; topics (and
 * the subject's own ideas) ring around it, and each topic's ideas fan out beyond the topic.
 * Clusters sit on a ring with related subjects next to each other (one subject alone sits at the centre).
 * Pure: same map in, same positions out.
 */
import type { MapLink, StudyMap } from "./map.ts";

export type MapNodeKind = "subject" | "topic" | "idea";
export interface MapNode { id: string; kind: MapNodeKind; label: string; x: number; y: number; r: number; subjectId: string; href: string; /** An idea's topic. */ parentId?: string }
export interface MapEdge { from: string; to: string; subjectId: string }
export interface MapLayout {
	nodes: MapNode[];
	edges: MapEdge[];
	links: MapLink[];
	/** Everything fits in [0, w] × [0, h]. */
	w: number;
	h: number;
}

export const SUBJECT_R = 34;
export const TOPIC_R = 18;
export const LEAF_R = 7;
const BRANCH_SPACING = 64; // arc length per branch on the subject's ring
const MIN_RING = 130;
const CLUSTER_GAP = 70;
const MARGIN = 80;

interface Cluster { subjectId: string; nodes: MapNode[]; edges: MapEdge[]; radius: number }

const IDEA_GAP = 44; // minimum distance between neighbouring ideas of one fan
const FAN_SPREAD = 1.5; // the widest a topic's fan of ideas may open (radians)
const FIRST_ROW = 66;
const ROW_STEP = 42;

/** A topic's ideas as rows of a fan: each row holds as many ideas as fit with IDEA_GAP between them. */
function fanRows(count: number): Array<{ dist: number; n: number; spread: number }> {
	const rows: Array<{ dist: number; n: number; spread: number }> = [];
	let left = count;
	for (let r = 0; left > 0; r++) {
		const dist = FIRST_ROW + r * ROW_STEP;
		const capacity = Math.max(1, Math.floor((FAN_SPREAD * dist) / IDEA_GAP) + 1);
		const n = Math.min(left, capacity);
		rows.push({ dist, n, spread: n === 1 ? 0 : ((n - 1) * IDEA_GAP) / dist });
		left -= n;
	}
	return rows;
}

function layoutCluster(subject: StudyMap["subjects"][number]): Cluster {
	const nodes: MapNode[] = [{ id: subject.id, kind: "subject", label: subject.name, x: 0, y: 0, r: SUBJECT_R, subjectId: subject.id, href: subject.href }];
	const edges: MapEdge[] = [];
	const branches = [
		...subject.topics.map((t) => ({ kind: "topic" as const, id: t.id, label: t.name, href: t.href, items: t.ideas.map((i) => ({ id: i.id, label: i.name })) })),
		...subject.ideas.map((i) => ({ kind: "idea" as const, id: i.id, label: i.name, href: "", items: [] as Array<{ id: string; label: string }> })),
	];
	// Each branch claims a wedge as wide as its fan of ideas (plus label room), so neighbouring fans never meet.
	const fans = branches.map((b) => fanRows(b.items.length));
	const widths = fans.map((rows) => Math.max(BRANCH_SPACING, ...rows.map((r) => 2 * r.dist * Math.sin(Math.min(Math.PI / 2, r.spread / 2)) + 70)));
	const total = widths.reduce((a, b) => a + b, 0);
	const ring = Math.max(MIN_RING, total / (2 * Math.PI));
	let extent = branches.length ? ring + TOPIC_R : SUBJECT_R;
	let before = 0;
	branches.forEach((branch, k) => {
		const theta = -Math.PI / 2 + (2 * Math.PI * (before + widths[k]! / 2)) / Math.max(total, 1);
		before += widths[k]!;
		const bx = Math.cos(theta) * ring, by = Math.sin(theta) * ring;
		nodes.push({ id: branch.id, kind: branch.kind, label: branch.label, x: bx, y: by, r: branch.kind === "topic" ? TOPIC_R : LEAF_R + 2, subjectId: subject.id, href: branch.href });
		edges.push({ from: subject.id, to: branch.id, subjectId: subject.id });
		let j = 0;
		for (const row of fans[k]!) {
			for (let i = 0; i < row.n; i++, j++) {
				const item = branch.items[j]!;
				const phi = row.n === 1 ? theta : theta - row.spread / 2 + (row.spread * i) / (row.n - 1);
				const x = bx + Math.cos(phi) * row.dist, y = by + Math.sin(phi) * row.dist;
				nodes.push({ id: item.id, kind: "idea", label: item.label, x, y, r: LEAF_R, subjectId: subject.id, href: "", parentId: branch.id });
				edges.push({ from: branch.id, to: item.id, subjectId: subject.id });
				extent = Math.max(extent, Math.hypot(x, y) + LEAF_R);
			}
		}
	});
	return { subjectId: subject.id, nodes, edges, radius: extent + 50 /* label room */ };
}

/** Subjects in ring order: a greedy walk that always steps to the most related unvisited subject. */
function ringOrder(ids: string[], links: readonly MapLink[]): string[] {
	if (ids.length < 3) return ids;
	const weight = (a: string, b: string) => links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))?.weight ?? 0;
	const total = (id: string) => links.reduce((sum, l) => sum + (l.a === id || l.b === id ? l.weight : 0), 0);
	const left = [...ids].sort((a, b) => total(b) - total(a) || a.localeCompare(b));
	const order = [left.shift()!];
	while (left.length) {
		const last = order.at(-1)!;
		left.sort((a, b) => weight(last, b) - weight(last, a) || total(b) - total(a) || a.localeCompare(b));
		order.push(left.shift()!);
	}
	return order;
}

export function layoutStudyMap(map: StudyMap): MapLayout {
	if (!map.subjects.length) return { nodes: [], edges: [], links: [], w: 0, h: 0 };
	const clusters = new Map(map.subjects.map((s) => [s.id, layoutCluster(s)]));
	const order = ringOrder(map.subjects.map((s) => s.id), map.links);
	const centres = new Map<string, { x: number; y: number }>();
	if (order.length === 1) centres.set(order[0]!, { x: 0, y: 0 });
	else if (order.length === 2) {
		const d = clusters.get(order[0]!)!.radius + clusters.get(order[1]!)!.radius + CLUSTER_GAP;
		centres.set(order[0]!, { x: -d / 2, y: 0 });
		centres.set(order[1]!, { x: d / 2, y: 0 });
	} else {
		const n = order.length;
		let R = 0;
		for (let i = 0; i < n; i++) {
			const need = clusters.get(order[i]!)!.radius + clusters.get(order[(i + 1) % n]!)!.radius + CLUSTER_GAP;
			R = Math.max(R, need / (2 * Math.sin(Math.PI / n)));
		}
		order.forEach((id, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; centres.set(id, { x: Math.cos(a) * R, y: Math.sin(a) * R }); });
	}
	const nodes: MapNode[] = [], edges: MapEdge[] = [];
	for (const [id, c] of clusters) {
		const at = centres.get(id)!;
		for (const n of c.nodes) nodes.push({ ...n, x: n.x + at.x, y: n.y + at.y });
		edges.push(...c.edges);
	}
	const minX = Math.min(...nodes.map((n) => n.x - n.r)) - MARGIN, minY = Math.min(...nodes.map((n) => n.y - n.r)) - MARGIN;
	const maxX = Math.max(...nodes.map((n) => n.x + n.r)) + MARGIN, maxY = Math.max(...nodes.map((n) => n.y + n.r)) + MARGIN;
	return { nodes: nodes.map((n) => ({ ...n, x: n.x - minX, y: n.y - minY })), edges, links: map.links, w: maxX - minX, h: maxY - minY };
}
