/**
 * Pure logic for the new-chat placement picker (Study overhaul, owner 2026-11-19): a chat lives in a subject
 * or a topic of one. There is no upfront start-mode choice any more; a normal chat starts teaching.
 * No React, no fetch: the picker component and its tests both use these.
 */
import { checkPlacement, topicsOf, type ChatPlacement, type Library } from "@/src/core";

export type StartMode = "scratch" | "check";

export interface Choice {
	subjectId: string;
	/** "" = the whole subject. */
	topicId: string;
	/** "" until a chat is placed; it then resolves to "scratch" ("check" is chosen only for probes/practice). */
	startMode: StartMode | "";
}

export const emptyChoice: Choice = { subjectId: "", topicId: "", startMode: "" };

/** The placement to send with a new chat, or null while the choice is incomplete or stale. A practice chat
 *  needs no start mode (it quizzes), so it counts as "check". */
export function placementFromChoice(library: Library, choice: Choice, practice = false): ChatPlacement | null {
	if (!choice.subjectId) return null;
	const startMode = practice ? "check" : choice.startMode || "scratch";
	try {
		return checkPlacement(library, { subjectId: choice.subjectId, ...(choice.topicId ? { topicId: choice.topicId } : {}), startMode });
	} catch { return null; }
}

/** Why the Start button is disabled, in the learner's words (empty when ready). */
export function missingPlacement(library: Library, choice: Choice, practice = false): string {
	if (!choice.subjectId || !library.subjects.some((s) => s.id === choice.subjectId)) return "Choose a subject for this chat.";
	return placementFromChoice(library, choice, practice) ? "" : "That subject or topic no longer exists.";
}

/** A remembered subject/topic that still exists; the start mode is never remembered. */
export function restoreChoice(library: Library, saved: unknown): Choice {
	const r = (saved ?? {}) as Partial<Choice>;
	const subjectId = typeof r.subjectId === "string" && library.subjects.some((s) => s.id === r.subjectId) ? r.subjectId : "";
	const topicId = subjectId && typeof r.topicId === "string" && topicsOf(library, subjectId).some((t) => t.id === r.topicId) ? r.topicId : "";
	return { subjectId, topicId, startMode: "" };
}

/** Subject → topic label, e.g. "Machine Learning › Dynamic programming". */
export function placementLabel(library: Library, p: Pick<ChatPlacement, "subjectId" | "topicId">): string {
	const subject = library.subjects.find((s) => s.id === p.subjectId)?.name;
	const topic = p.topicId ? library.topics.find((t) => t.id === p.topicId)?.name : undefined;
	return [subject, topic].filter(Boolean).join(" › ");
}

export const LAST_CHOICE_KEY = "lh.study.last-placement.v1";

/** Subjects for the pills: the remembered (last used) one first, then newest first. */
export function orderedSubjects(library: Library, lastSubjectId = "") {
	return [...library.subjects].sort((a, b) => (b.id === lastSubjectId ? 1 : 0) - (a.id === lastSubjectId ? 1 : 0) || b.createdAt.localeCompare(a.createdAt));
}

/** Topics of a subject for the pills: the remembered topic first, then newest first. */
export function orderedTopics(library: Library, subjectId: string, lastTopicId = "") {
	return [...topicsOf(library, subjectId)].sort((a, b) => (b.id === lastTopicId ? 1 : 0) - (a.id === lastTopicId ? 1 : 0) || b.createdAt.localeCompare(a.createdAt));
}

/** The `@query` being typed at the END of the composer text, or null when no mention is open. */
export function mentionQuery(text: string): string | null {
	const m = /(?:^|\s)@([^\s@]*)$/.exec(text);
	return m ? m[1]! : null;
}

export interface MentionOption { key: string; subjectId: string; topicId: string; label: string }

/** Subjects and "Subject › Topic" entries matching the query (case-insensitive), capped for a small menu. */
export function mentionOptions(library: Library, query: string, limit = 8): MentionOption[] {
	const q = query.trim().toLowerCase();
	const out: MentionOption[] = [];
	for (const s of orderedSubjects(library)) {
		const entries: MentionOption[] = [
			{ key: s.id, subjectId: s.id, topicId: "", label: s.name },
			...topicsOf(library, s.id).map((t) => ({ key: `${s.id}/${t.id}`, subjectId: s.id, topicId: t.id, label: `${s.name} › ${t.name}` })),
		];
		for (const e of entries) if (!q || e.label.toLowerCase().includes(q)) out.push(e);
	}
	return out.slice(0, limit);
}

/** The text with the trailing `@query` removed (the placement now carries it). */
export function stripMention(text: string): string {
	return text.replace(/(^|\s)@[^\s@]*$/, "$1");
}
