/**
 * Pure logic for the new-chat placement picker (Study overhaul, owner 2026-11-19): a chat lives in a subject
 * or a topic of one, and every new chat asks how to start ("from scratch" or "check what I know first").
 * No React, no fetch: the picker component and its tests both use these.
 */
import { checkPlacement, topicsOf, type ChatPlacement, type Library } from "@/src/core";

export type StartMode = "scratch" | "check";

export interface Choice {
	subjectId: string;
	/** "" = the whole subject. */
	topicId: string;
	/** "" until the learner picks: the start mode is asked every time, never defaulted. */
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
