/**
 * The Study map (owner 2026-11-19): the home graph shows each SUBJECT as a hub, its TOPICS around it, and the key
 * IDEAS each topic covers beyond that (ideas of the subject as a whole hang off the subject). Files and chats are not
 * nodes: clicking an idea lists the files (with pages) and chats about it. Subjects whose ideas overlap are linked.
 *
 * Pure: `buildStudyMap` folds the library (topics, ideas, materials), chat titles and the idea graph's provenance;
 * layout lives in map-layout.ts.
 */
import type { Idea, Library } from "./model.ts";
import { topicsOf } from "./model.ts";

export interface MapIdea {
	id: string;
	name: string;
	summary: string;
	files: Array<{ materialId: string; label: string; pages?: string; href: string }>;
	chats: Array<{ id: string; title: string; href: string }>;
}
export interface MapTopic { id: string; name: string; href: string; ideas: MapIdea[] }
export interface MapSubject {
	id: string;
	name: string;
	href: string;
	topics: MapTopic[];
	/** Ideas of the subject as a whole (from subject-wide files and chats). */
	ideas: MapIdea[];
}
/** Two subjects that share ideas (same idea name, or overlapping idea-graph propositions). */
export interface MapLink { a: string; b: string; weight: number; ideas: string[] }
export interface StudyMap { subjects: MapSubject[]; links: MapLink[] }

export interface MapInput {
	library: Library;
	chats: ReadonlyArray<{ id: string; title: string; placement?: { subjectId: string; topicId?: string } }>;
	graph?: {
		propositions: ReadonlyArray<{ id: string; name: string }>;
		logicalEdges: ReadonlyArray<{ from: string; to: string }>;
		nodeSessions: Readonly<Record<string, string[]>>;
		nodeScope?: Readonly<Record<string, { subjectId: string; topicId?: string }>>;
	};
}

const IDEAS_SHOWN = 8;
const key = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function buildStudyMap({ library, chats, graph }: MapInput): StudyMap {
	const titles = new Map(chats.map((c) => [c.id, c.title]));
	const placementOf = new Map(chats.flatMap((c) => (c.placement ? [[c.id, c.placement] as const] : [])));
	const material = new Map(library.materials.map((m) => [m.id, m]));
	const toMap = (subjectId: string, ideas: readonly Idea[] = []): MapIdea[] => ideas.map((i) => ({
		id: i.id,
		name: i.name,
		summary: i.summary,
		files: i.files.flatMap((f) => {
			const m = material.get(f.materialId);
			if (!m) return [];
			return [{ materialId: m.id, label: m.fileName, ...(f.pages ? { pages: f.pages } : m.pages ? { pages: `${m.pages.from}-${m.pages.to}` } : {}), href: `/subjects/${subjectId}${m.scope.topicId ? `/${m.scope.topicId}` : ""}` }];
		}),
		chats: i.chats.flatMap((id) => (titles.has(id) ? [{ id, title: titles.get(id)!, href: `/chat/${id}` }] : [])),
	}));
	const subjects: MapSubject[] = [...library.subjects].sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({
		id: s.id,
		name: s.name,
		href: `/subjects/${s.id}`,
		topics: topicsOf(library, s.id).map((t) => ({ id: t.id, name: t.name, href: `/subjects/${s.id}/${t.id}`, ideas: toMap(s.id, t.ideas) })),
		ideas: toMap(s.id, s.ideas),
	}));
	const known = new Set(subjects.map((s) => s.id));

	const pairs = new Map<string, MapLink>();
	const bump = (x: string, y: string, ...names: string[]) => {
		if (x === y) return;
		const [a, b] = x < y ? [x, y] : [y, x];
		const link = pairs.get(`${a}|${b}`) ?? { a, b, weight: 0, ideas: [] };
		link.weight++;
		for (const n of names) if (n && !link.ideas.includes(n) && link.ideas.length < IDEAS_SHOWN) link.ideas.push(n);
		pairs.set(`${a}|${b}`, link);
	};
	// 1. The same idea in two subjects.
	const bySubject = new Map(subjects.map((s) => [s.id, new Map([...s.ideas, ...s.topics.flatMap((t) => t.ideas)].map((i) => [key(i.name), i.name]))]));
	const ids = [...bySubject.keys()];
	for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
		for (const [k, name] of bySubject.get(ids[i]!)!) if (bySubject.get(ids[j]!)!.has(k)) bump(ids[i]!, ids[j]!, name);
	}
	// 2. Idea-graph propositions that came up in chats of more than one subject, or reasoning steps between them.
	if (graph) {
		const names = new Map(graph.propositions.map((p) => [p.id, p.name]));
		const subjectsOf = new Map<string, Set<string>>();
		for (const p of graph.propositions) {
			const set = new Set<string>();
			for (const chatId of graph.nodeSessions[p.id] ?? []) { const s = placementOf.get(chatId)?.subjectId; if (s && known.has(s)) set.add(s); }
			const born = graph.nodeScope?.[p.id]?.subjectId;
			if (born && known.has(born)) set.add(born);
			if (set.size) subjectsOf.set(p.id, set);
		}
		for (const [id, set] of subjectsOf) {
			const list = [...set].sort();
			for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) bump(list[i]!, list[j]!, names.get(id) ?? "");
		}
		for (const e of graph.logicalEdges) {
			const from = subjectsOf.get(e.from), to = subjectsOf.get(e.to);
			if (!from || !to || [...from].some((s) => to.has(s))) continue;
			for (const a of from) for (const b of to) bump(a, b, names.get(e.from) ?? "", names.get(e.to) ?? "");
		}
	}
	return { subjects, links: [...pairs.values()].sort((x, y) => y.weight - x.weight || x.a.localeCompare(y.a) || x.b.localeCompare(y.b)) };
}

/** Find an idea anywhere on the map by id (for the idea card). */
export function findMapIdea(map: StudyMap, id: string): { idea: MapIdea; subject: MapSubject; topic?: MapTopic } | undefined {
	for (const subject of map.subjects) {
		const own = subject.ideas.find((i) => i.id === id);
		if (own) return { idea: own, subject };
		for (const topic of subject.topics) { const idea = topic.ideas.find((i) => i.id === id); if (idea) return { idea, subject, topic }; }
	}
	return undefined;
}
