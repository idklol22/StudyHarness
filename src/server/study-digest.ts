/**
 * What was said in the chats of a subject or topic, boiled down for "Create notes" and the like.
 * A topic covers the chats placed in that topic; a subject covers every chat in it, topics' included.
 */
import type { ChatRecord } from "../core/contracts.ts";
import { placementIncludesTopic, placementScopeLabel, subjectOf, type StudyScope } from "../core/study/model.ts";
import { stores } from "./stores.ts";
import { study } from "./study-runtime.ts";

const MIN_PER_CHAT = 1200;

/** Learner and tutor text only (no tool calls, thinking or results), one line per turn. */
export function chatLines(record: Pick<ChatRecord, "messages">): string[] {
	return record.messages.flatMap((m) => {
		const role = (m as { role?: string }).role;
		if (role !== "user" && role !== "assistant") return [];
		const content = (m as { content?: unknown }).content;
		const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c && (c as { type?: string }).type === "text" ? String((c as { text?: string }).text ?? "") : "")).join(" ") : "";
		const clean = text.replace(/\s+/g, " ").trim();
		return clean ? [`${role === "user" ? "Learner" : "Tutor"}: ${clean}`] : [];
	});
}

/** Chats that belong to the scope, oldest first. */
export function chatsInScope(scope: StudyScope): ChatRecord[] {
	return stores.chatStore.listChats()
		.filter((c) => c.placement && c.placement.subjectId === scope.subjectId && (!scope.topicId || placementIncludesTopic(c.placement, scope.topicId)))
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
		.flatMap((c) => { const record = stores.chatStore.getChat(c.id); return record ? [record] : []; });
}

/**
 * The scope's conversations as text within `budget` characters. Each chat gets an equal share (at least
 * ~1.2k) and keeps its most recent part when it is longer. Labels name the topic so a subject's digest
 * can be grouped by topic.
 */
export function scopeChatDigest(scope: StudyScope, budget = 16000, only?: ReadonlySet<string>): { text: string; chats: number } {
	const lib = study.library();
	if (!subjectOf(lib, scope.subjectId)) return { text: "", chats: 0 };
	const records = chatsInScope(scope).filter((r) => !only || only.has(r.id)).map((r) => ({ record: r, lines: chatLines(r) })).filter((r) => r.lines.length);
	if (!records.length) return { text: "", chats: 0 };
	const share = Math.max(MIN_PER_CHAT, Math.floor(budget / records.length));
	const parts = records.map(({ record, lines }) => {
		const place = record.placement ? placementScopeLabel(lib, record.placement) : "";
		const body = lines.join("\n");
		const cut = body.length > share ? "…" + body.slice(body.length - share) : body;
		return `## Chat: ${record.title}${place ? ` (${place})` : ""}\n${cut}`;
	});
	return { text: parts.join("\n\n"), chats: records.length };
}
