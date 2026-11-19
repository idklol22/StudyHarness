/**
 * Ideas and topic suggestions (owner 2026-11-19).
 *  - An IDEA is a key idea of a topic (or of the subject as a whole), linked to the files (with pages) and chats
 *    that cover it. The Subjects map shows subject → topics → ideas; clicking an idea lists its files and chats.
 *  - A SUGGESTION is the 1–2 broad topics proposed for a file added to a subject. Accepting creates the topic (or
 *    reuses a matching one) and moves the file there; with two topics the one stored file is referenced from both,
 *    each with its page range.
 * Pure: the service persists the Library.
 */
import { addMaterial, checkScope, createTopic, moveMaterial, subjectOf, topicOf, type Idea, type Library, type Material, type SuggestedTopic, type Suggestion } from "./model.ts";

export const MAX_IDEAS = 12;
export const MAX_SUGGESTED_TOPICS = 2;

const key = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export interface IncomingIdea { name: string; summary?: string; file?: { materialId: string; pages?: string }; chat?: string }

/**
 * Fold new ideas into a list: same name (ignoring case/punctuation) → one idea whose links union and whose summary
 * is kept (or filled when empty); new names append. Capped at MAX_IDEAS (the oldest, most linked stay).
 */
export function mergeIdeas(existing: readonly Idea[], incoming: readonly IncomingIdea[], makeId: () => string = () => newId("idea")): Idea[] {
	const out = existing.map((i) => ({ ...i, files: [...i.files], chats: [...i.chats] }));
	for (const raw of incoming) {
		const name = clip(raw.name, 60);
		if (!name) continue;
		let idea = out.find((i) => key(i.name) === key(name));
		if (!idea) {
			if (out.length >= MAX_IDEAS) continue;
			idea = { id: makeId(), name, summary: clip(raw.summary, 240), files: [], chats: [] };
			out.push(idea);
		} else if (!idea.summary && raw.summary) idea.summary = clip(raw.summary, 240);
		if (raw.file && !idea.files.some((f) => f.materialId === raw.file!.materialId)) idea.files.push({ materialId: raw.file.materialId, ...(raw.file.pages ? { pages: clip(raw.file.pages, 40) } : {}) });
		if (raw.chat && !idea.chats.includes(raw.chat)) idea.chats.push(raw.chat);
	}
	return out;
}

/** Replace the ideas of a topic or of the subject itself. */
export function setIdeas(lib: Library, target: { subjectId: string; topicId?: string }, ideas: Idea[]): Library {
	if (target.topicId) {
		if (!topicOf(lib, target.topicId)) throw new Error("That topic no longer exists.");
		return { ...lib, topics: lib.topics.map((t) => (t.id === target.topicId ? { ...t, ideas } : t)) };
	}
	if (!subjectOf(lib, target.subjectId)) throw new Error("That subject no longer exists.");
	return { ...lib, subjects: lib.subjects.map((s) => (s.id === target.subjectId ? { ...s, ideas } : s)) };
}

export const ideasOf = (lib: Library, target: { subjectId: string; topicId?: string }): Idea[] =>
	(target.topicId ? topicOf(lib, target.topicId)?.ideas : subjectOf(lib, target.subjectId)?.ideas) ?? [];

/** Record suggestions for a file (replacing any earlier ones for it). Bounded to MAX_SUGGESTED_TOPICS topics. */
export function addSuggestion(lib: Library, materialId: string, topics: readonly SuggestedTopic[], at = new Date().toISOString(), id = newId("sug")): { library: Library; suggestion: Suggestion | null } {
	const material = lib.materials.find((m) => m.id === materialId);
	if (!material) throw new Error("That file no longer exists.");
	const clean = topics.slice(0, MAX_SUGGESTED_TOPICS).flatMap((t): SuggestedTopic[] => {
		const name = clip(t.name, 80);
		if (!name) return [];
		const existing = t.topicId && topicOf(lib, t.topicId)?.subjectId === material.scope.subjectId ? t.topicId : undefined;
		const from = Math.max(1, Math.min(material.pageCount, Math.round(t.pages?.from ?? 1)));
		const to = Math.max(from, Math.min(material.pageCount, Math.round(t.pages?.to ?? material.pageCount)));
		return [{ name, ...(existing ? { topicId: existing } : {}), pages: { from, to }, summary: clip(t.summary, 600), ideas: (t.ideas ?? []).slice(0, 8).map((i) => ({ name: clip(i.name, 60), summary: clip(i.summary, 240), ...(i.pages ? { pages: clip(i.pages, 40) } : {}) })).filter((i) => i.name) }];
	});
	const rest = (lib.suggestions ?? []).filter((s) => s.materialId !== materialId);
	if (!clean.length) return { library: { ...lib, suggestions: rest }, suggestion: null };
	const suggestion: Suggestion = { id, materialId, createdAt: at, topics: clean };
	return { library: { ...lib, suggestions: [...rest, suggestion] }, suggestion };
}

export function dismissSuggestion(lib: Library, id: string): Library {
	if (!(lib.suggestions ?? []).some((s) => s.id === id)) throw new Error("That suggestion is gone.");
	return { ...lib, suggestions: (lib.suggestions ?? []).filter((s) => s.id !== id) };
}

export interface Accepted { library: Library; topics: Array<{ topicId: string; material: Material; suggested: SuggestedTopic; created: boolean }> }

/**
 * Accept a suggestion: each suggested topic is created (or the matching one reused, or one with the same name).
 * One topic → the file moves into it. Two topics → the file is referenced from both (one stored copy), each with
 * its page range. The topics get the suggested ideas linked to the file. `edits` (by index) are the learner's changes:
 * a new name (or just a string), an existing topic to use instead, and the edited idea list.
 */
export interface SuggestionEdit { name?: string; topicId?: string; ideas?: Array<{ name: string; summary?: string; pages?: string }> }
export function acceptSuggestion(lib: Library, id: string, edits: Readonly<Record<number, string | SuggestionEdit>> = {}): Accepted {
	const suggestion = (lib.suggestions ?? []).find((s) => s.id === id);
	if (!suggestion) throw new Error("That suggestion is gone.");
	const source = lib.materials.find((m) => m.id === suggestion.materialId);
	if (!source) throw new Error("That file no longer exists.");
	const subjectId = source.scope.subjectId;
	let next: Library = { ...lib, suggestions: (lib.suggestions ?? []).filter((s) => s.id !== id) };
	const out: Accepted["topics"] = [];
	suggestion.topics.forEach((suggested, index) => {
		const raw = edits[index];
		const edit: SuggestionEdit = typeof raw === "string" ? { name: raw } : raw ?? {};
		const wanted = clip(edit.name, 80) || suggested.name;
		const chosen = edit.topicId && topicOf(next, edit.topicId)?.subjectId === subjectId ? edit.topicId : undefined;
		let topicId = chosen ?? (clip(edit.name, 80) ? undefined : suggested.topicId && topicOf(next, suggested.topicId) ? suggested.topicId : undefined);
		let created = false;
		if (!topicId) { const r = createTopic(next, subjectId, wanted); next = r.library; topicId = r.topic.id; created = r.created; }
		const scope = checkScope(next, { subjectId, topicId });
		const whole = suggestion.topics.length === 1;
		const pages = whole ? undefined : suggested.pages;
		let material: Material;
		if (index === 0) {
			// The original reference moves (it may merge into an identical file already in the topic).
			next = moveMaterial(next, source.id, scope);
			material = next.materials.find((m) => m.sha256 === source.sha256 && m.scope.topicId === topicId)!;
			if (pages) next = { ...next, materials: next.materials.map((m) => (m.id === material.id ? { ...m, pages } : m)) };
		} else {
			const r = addMaterial(next, { sha256: source.sha256, fileName: source.fileName, pageCount: source.pageCount, bytes: source.bytes, scope, ...(source.kind ? { kind: source.kind } : {}) });
			next = r.library;
			material = r.material;
			if (pages) next = { ...next, materials: next.materials.map((m) => (m.id === material.id ? { ...m, pages } : m)) };
		}
		material = next.materials.find((m) => m.id === material.id)!;
		const ideas = edit.ideas ?? suggested.ideas;
		next = setIdeas(next, scope, mergeIdeas(ideasOf(next, scope), ideas.map((i) => ({ name: i.name, summary: i.summary, file: { materialId: material.id, pages: i.pages } }))));
		out.push({ topicId, material, suggested, created });
	});
	return { library: next, topics: out };
}

/** Drop links to files that no longer exist and suggestions for them (run after any library change). */
export function tidyLibrary(lib: Library): Library {
	const files = new Set(lib.materials.map((m) => m.id));
	const prune = (ideas?: Idea[]) => ideas?.map((i) => ({ ...i, files: i.files.filter((f) => files.has(f.materialId)) }));
	const suggestions = (lib.suggestions ?? []).filter((s) => files.has(s.materialId) && lib.materials.find((m) => m.id === s.materialId)!.scope.topicId === undefined);
	const changed = suggestions.length !== (lib.suggestions ?? []).length
		|| lib.topics.some((t) => t.ideas?.some((i) => i.files.some((f) => !files.has(f.materialId))))
		|| lib.subjects.some((s) => s.ideas?.some((i) => i.files.some((f) => !files.has(f.materialId))));
	if (!changed) return lib;
	return {
		...lib,
		subjects: lib.subjects.map((s) => (s.ideas ? { ...s, ideas: prune(s.ideas) } : s)),
		topics: lib.topics.map((t) => (t.ideas ? { ...t, ideas: prune(t.ideas) } : t)),
		suggestions,
	};
}

/** Suggestions waiting in a subject, newest last. */
export const suggestionsIn = (lib: Library, subjectId: string): Suggestion[] =>
	(lib.suggestions ?? []).filter((s) => lib.materials.find((m) => m.id === s.materialId)?.scope.subjectId === subjectId);

// ── the learner's own edits ─────────────────────────────────────────────────────────────────────────────────────

type Target = { subjectId: string; topicId?: string };

/** Add an idea by hand (merged with an existing one of the same name). */
export function addIdea(lib: Library, target: Target, idea: { name: string; summary?: string }): Library {
	if (!clip(idea.name, 60)) throw new Error("An idea needs a name.");
	return setIdeas(lib, target, mergeIdeas(ideasOf(lib, target), [{ name: idea.name, summary: idea.summary }]));
}

/** Rename an idea or change its summary. */
export function editIdea(lib: Library, target: Target, id: string, patch: { name?: string; summary?: string }): Library {
	const ideas = ideasOf(lib, target);
	if (!ideas.some((i) => i.id === id)) throw new Error("That idea no longer exists.");
	const name = patch.name === undefined ? undefined : clip(patch.name, 60);
	if (name === "") throw new Error("An idea needs a name.");
	if (name && ideas.some((i) => i.id !== id && key(i.name) === key(name))) throw new Error("Another idea already has that name.");
	return setIdeas(lib, target, ideas.map((i) => (i.id === id ? { ...i, ...(name ? { name } : {}), ...(patch.summary !== undefined ? { summary: clip(patch.summary, 240) } : {}) } : i)));
}

export function removeIdea(lib: Library, target: Target, id: string): Library {
	const ideas = ideasOf(lib, target);
	if (!ideas.some((i) => i.id === id)) throw new Error("That idea no longer exists.");
	return setIdeas(lib, target, ideas.filter((i) => i.id !== id));
}

/**
 * Put a file into a topic chosen by the learner (an existing topic, or a new one by name). Its pending suggestion
 * goes; the file's ideas are then found for that topic in the background.
 */
export function assignMaterial(lib: Library, materialId: string, to: { topicId?: string; newTopicName?: string }): { library: Library; topicId: string; material: Material } {
	const source = lib.materials.find((m) => m.id === materialId);
	if (!source) throw new Error("That file no longer exists.");
	let next: Library = { ...lib, suggestions: (lib.suggestions ?? []).filter((s) => s.materialId !== materialId) };
	let topicId = to.topicId && topicOf(next, to.topicId)?.subjectId === source.scope.subjectId ? to.topicId : undefined;
	if (!topicId) {
		if (!clip(to.newTopicName, 80)) throw new Error("Choose a topic or type a new topic name.");
		const r = createTopic(next, source.scope.subjectId, to.newTopicName);
		next = r.library; topicId = r.topic.id;
	}
	next = moveMaterial(next, materialId, { subjectId: source.scope.subjectId, topicId });
	const material = next.materials.find((m) => m.sha256 === source.sha256 && m.scope.topicId === topicId)!;
	return { library: next, topicId, material };
}
