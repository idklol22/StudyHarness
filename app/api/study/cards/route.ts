/**
 * GET  /api/study/cards?subjectId=…[&topicId=…] — {cards, groups}: a topic's cards, or a subject's (all topics, labelled).
 * POST /api/study/cards — the learner's changes: {action:"add", subjectId, topicId?, q, a} · {action:"edit", …, id, q?, a?} · {action:"remove", …, id}
 * Ratings and scheduling are recorded in practice chats (study_practice_rate), never here.
 */
import { changeCards, checkedNotesScope, readCards } from "@/src/server";

export const dynamic = "force-dynamic";

const scopeOf = (v: { subjectId?: unknown; topicId?: unknown }) => {
	if (typeof v.subjectId !== "string") throw new Error("subjectId is required.");
	return checkedNotesScope({ subjectId: v.subjectId, ...(typeof v.topicId === "string" && v.topicId ? { topicId: v.topicId } : {}) });
};
const bad = (error: unknown) => Response.json({ error: error instanceof Error ? error.message : "Bad request." }, { status: 400 });

export function GET(request: Request) {
	try { const q = new URL(request.url).searchParams; return Response.json(readCards(scopeOf({ subjectId: q.get("subjectId") ?? undefined, topicId: q.get("topicId") ?? undefined }))); }
	catch (error) { return bad(error); }
}

export async function POST(request: Request) {
	try {
		if (Number(request.headers.get("content-length")) > 64 * 1024) throw new Error("That request is too large.");
		const raw = await request.json() as Record<string, any>;
		const scope = scopeOf(raw);
		switch (raw.action) {
			case "add": return Response.json(changeCards(scope, { kind: "add", q: raw.q, a: raw.a, topicId: typeof raw.cardTopicId === "string" ? raw.cardTopicId : undefined }));
			case "edit": return Response.json(changeCards(scope, { kind: "edit", id: String(raw.id), q: raw.q, a: raw.a }));
			case "remove": return Response.json(changeCards(scope, { kind: "remove", id: String(raw.id) }));
			default: return Response.json({ error: "Unknown action." }, { status: 400 });
		}
	} catch (error) { return bad(error); }
}
