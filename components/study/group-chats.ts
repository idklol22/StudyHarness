/**
 * Group the session list by the Study library (Study overhaul, owner 2026-11-19): Subject → Topic → chats,
 * plus a "Not filed" bucket for chats with no (or a stale) placement. Pure, so the sidebar tree and its
 * keyboard walk share one display order.
 */
import { topicsOf, type Library, type Subject, type Topic } from "@/src/core/study/model";

export interface ChatLike { id: string; updatedAt: string; placement?: { subjectId: string; topicId?: string } }

export interface TopicGroup<C> { topic: Topic; chats: C[] }
export interface SubjectGroup<C> {
	subject: Subject;
	/** Chats filed under the subject itself (no topic). */
	chats: C[];
	topics: Array<TopicGroup<C>>;
}
export interface Grouped<C> { subjects: Array<SubjectGroup<C>>; unfiled: C[] }

const newest = (a: ChatLike, b: ChatLike) => b.updatedAt.localeCompare(a.updatedAt);

/** Every subject (even an empty one) and every topic appears; chats sort newest first inside each bucket. */
export function groupChats<C extends ChatLike>(library: Library, chats: readonly C[]): Grouped<C> {
	const subjects = [...library.subjects].sort((a, b) => a.name.localeCompare(b.name)).map<SubjectGroup<C>>((subject) => ({
		subject,
		chats: [],
		topics: topicsOf(library, subject.id).map((topic) => ({ topic, chats: [] })),
	}));
	const bySubject = new Map(subjects.map((g) => [g.subject.id, g]));
	const unfiled: C[] = [];
	for (const chat of [...chats].sort(newest)) {
		const group = chat.placement ? bySubject.get(chat.placement.subjectId) : undefined;
		if (!group) { unfiled.push(chat); continue; }
		const topic = chat.placement?.topicId ? group.topics.find((t) => t.topic.id === chat.placement!.topicId) : undefined;
		if (chat.placement?.topicId && !topic) { unfiled.push(chat); continue; } // a deleted topic: never guess a home
		(topic ? topic.chats : group.chats).push(chat);
	}
	return { subjects, unfiled };
}

/** The tree's chats in display order (subject chats, then each topic's, then not filed): the keyboard-walk order. */
export function displayOrder<C extends ChatLike>(grouped: Grouped<C>): C[] {
	return [
		...grouped.subjects.flatMap((g) => [...g.chats, ...g.topics.flatMap((t) => t.chats)]),
		...grouped.unfiled,
	];
}
