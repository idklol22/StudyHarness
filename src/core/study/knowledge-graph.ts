/**
 * The one knowledge graph (owner 2026-11-19): a 3D globe where every subject is a bigger node spoked to the centre,
 * subjects span out topics and topics span out ideas. Related subjects (same or neighbouring field, shared ideas)
 * sit near each other. This turns the Study map into what the 3D renderer draws. Pure.
 */
import { fieldDirection, guessField, isField } from "./fields.ts";
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

function nudge(base: readonly [number, number, number], k: number): [number, number, number] {
	if (k === 0) return [base[0], base[1], base[2]];
	// Subjects of one field spread on a small circle around the field's direction.
	const helper: [number, number, number] = Math.abs(base[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
	let ux = base[1] * helper[2] - base[2] * helper[1], uy = base[2] * helper[0] - base[0] * helper[2], uz = base[0] * helper[1] - base[1] * helper[0];
	const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
	const vx = base[1] * uz - base[2] * uy, vy = base[2] * ux - base[0] * uz, vz = base[0] * uy - base[1] * ux;
	const a = k * 2.399, r = 0.28 * Math.ceil(k / 6);
	const x = base[0] + (ux * Math.cos(a) + vx * Math.sin(a)) * r, y = base[1] + (uy * Math.cos(a) + vy * Math.sin(a)) * r, z = base[2] + (uz * Math.cos(a) + vz * Math.sin(a)) * r;
	const l = Math.hypot(x, y, z) || 1;
	return [x / l, y / l, z / l];
}

export function knowledgeGraph(map: StudyMap): KnowledgeGraphData {
	const out: KnowledgeGraphData = { nodes: [], edges: [], parents: {}, clusters: [], anchors: {} };
	const perField = new Map<string, number>();
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
		// A subject with nothing in it yet still shows (its hub needs one member): a "no topics yet" stub opening its page.
		if (!members.length) { const stub = `${s.id}:empty`; out.nodes.push({ id: stub, label: "No topics yet", kind: "topic", subjectId: s.id, href: s.href }); members.push(stub); }
		out.clusters.push({ id: s.id, label: s.name, members });
		const field = isField(s.field) ? s.field : guessField(s.name);
		if (field) {
			const k = perField.get(field) ?? 0;
			perField.set(field, k + 1);
			out.anchors[s.id] = nudge(fieldDirection(field), k);
		}
	}
	// The same idea in two subjects: an interconnection (it also pulls the two subjects together).
	for (const list of byIdea.values()) {
		for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
			if (list[a]!.subjectId !== list[b]!.subjectId) out.edges.push({ from: list[a]!.id, to: list[b]!.id });
		}
	}
	return out;
}
