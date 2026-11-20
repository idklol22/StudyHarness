/**
 * Pure logic for the new-chat context picker: a chat lives in one subject and any number of its topics
 * (or the whole subject). No React, no fetch: the picker component and its tests both use these.
 */
import { checkPlacement, placementScopeLabel, selectedTopicIds, topicsOf, type ChatPlacement, type Library } from "@/src/core";

export type StartMode = "scratch" | "check";

export interface Choice {
	subjectId: string;
	/** [] = the whole subject. Several ids are allowed. */
	topicIds: string[];
	/** "" until a chat is placed; it then resolves to "scratch" ("check" is chosen only for probes/practice). */
	startMode: StartMode | "";
}

export const emptyChoice: Choice = { subjectId: "", topicIds: [], startMode: "" };

/** The placement to send with a new chat, or null while the choice is incomplete or stale. */
export function placementFromChoice(library: Library, choice: Choice, practice = false): ChatPlacement | null {
	if (!choice.subjectId) return null;
	const startMode: StartMode = practice ? "check" : choice.startMode || "scratch";
	try {
		return checkPlacement(library, { subjectId: choice.subjectId, topicIds: choice.topicIds, startMode });
	} catch { return null; }
}

/** Why Start is disabled, in the learner's words (empty when ready). */
export function missingPlacement(library: Library, choice: Choice, practice = false): string {
	if (!choice.subjectId) return "Choose a subject for this chat.";
	if (!library.subjects.some((s) => s.id === choice.subjectId)) return "That subject or topic no longer exists.";
	return placementFromChoice(library, choice, practice) ? "" : "That subject or topic no longer exists.";
}

/** A remembered subject/topics that still exist; the start mode is never remembered. Reads the old single-id shape. */
export function restoreChoice(library: Library, saved: unknown): Choice {
	const r = (saved ?? {}) as { subjectId?: unknown; topicIds?: unknown; topicId?: unknown };
	const subjectId = typeof r.subjectId === "string" && library.subjects.some((s) => s.id === r.subjectId) ? r.subjectId : "";
	const available = new Set(topicsOf(library, subjectId).map((t) => t.id));
	const raw = Array.isArray(r.topicIds) ? r.topicIds : typeof r.topicId === "string" ? [r.topicId] : [];
	const topicIds = subjectId ? [...new Set(raw.filter((id): id is string => typeof id === "string" && available.has(id)))] : [];
	return { subjectId, topicIds, startMode: "" };
}

/** Subject › Topic, Subject › 3 topics, or just Subject. */
export function placementLabel(library: Library, p: { subjectId: string; topicId?: string; topicIds?: string[] }): string {
	return placementScopeLabel(library, p);
}

export const LAST_CHOICE_KEY = "lh.study.last-placement.v1";

/** What the composer remembers (browser-only; safe on the server). The legacy shape still reads. */
export function lastChoice(): { subjectId: string; topicIds: string[] } {
	try {
		const r = JSON.parse(localStorage.getItem(LAST_CHOICE_KEY) ?? "null") as { subjectId?: unknown; topicIds?: unknown; topicId?: unknown } | null;
		const raw = Array.isArray(r?.topicIds) ? r.topicIds : typeof r?.topicId === "string" ? [r.topicId] : [];
		return {
			subjectId: typeof r?.subjectId === "string" ? r.subjectId : "",
			topicIds: [...new Set(raw.filter((id): id is string => typeof id === "string" && id.length > 0))],
		};
	} catch { return { subjectId: "", topicIds: [] }; }
}

/** Subjects for the picker: the last used one first, then name order. */
export function orderedSubjects(library: Library, lastSubjectId = "") {
	return [...library.subjects].sort((a, b) => (b.id === lastSubjectId ? 1 : 0) - (a.id === lastSubjectId ? 1 : 0) || a.name.localeCompare(b.name));
}

/** Topics of a subject: the last used one first, then the library's own order. */
export function orderedTopics(library: Library, subjectId: string, lastTopicId = "") {
	return [...topicsOf(library, subjectId)].sort((a, b) => (b.id === lastTopicId ? 1 : 0) - (a.id === lastTopicId ? 1 : 0) || a.order - b.order || a.name.localeCompare(b.name));
}

/** Case-insensitive substring search, shared by both picker columns and their tests. */
export function matchesQuery(value: string, query: string): boolean {
	return value.toLowerCase().includes(query.trim().toLowerCase());
}

/** The `@query` being typed at the END of the composer text, or null when no mention is open. */
export function mentionQuery(text: string): string | null {
	const m = /(?:^|\s)@([^\s@]*)$/.exec(text);
	return m ? m[1]! : null;
}

export interface MentionOption { key: string; subjectId: string; topicId: string; label: string }

/** Subjects and "Subject › Topic" entries matching the query (case-insensitive), capped for a small menu. */
export function mentionOptions(library: Library, query: string, limit = 8): MentionOption[] {
	const out: MentionOption[] = [];
	for (const s of orderedSubjects(library)) {
		const entries: MentionOption[] = [
			{ key: s.id, subjectId: s.id, topicId: "", label: s.name },
			...topicsOf(library, s.id).map((t) => ({ key: `${s.id}/${t.id}`, subjectId: s.id, topicId: t.id, label: `${s.name} › ${t.name}` })),
		];
		for (const e of entries) if (!query.trim() || matchesQuery(e.label, query)) out.push(e);
	}
	return out.slice(0, limit);
}

/** The text with the trailing `@query` removed (the placement now carries it). */
export function stripMention(text: string): string {
	return text.replace(/(^|\s)@[^\s@]*$/, "$1");
}

/** Topic names of a placement, for advice to the model and quiet summaries. */
export function placementTopicNames(library: Library, p: { subjectId: string; topicId?: string; topicIds?: string[] }): string[] {
	return selectedTopicIds(library, p).map((id) => library.topics.find((t) => t.id === id)!.name);
}
