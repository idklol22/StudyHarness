/**
 * GET  /api/study/notes?subjectId=…[&topicId=…]  — the scope's notebook (pages, elements, the learner's ink).
 * POST /api/study/notes                          — one action per request:
 *   {action:"generate", subjectId, topicId?, lesson?}      the note-taker adds blocks from context + material (+ lesson)
 *   {action:"stroke", subjectId, topicId?, pageId, stroke}  the learner draws (pen / highlighter)
 *   {action:"undo", …, pageId} · {action:"sticky", …, pageId, x, y, text} · {action:"remove-sticky", …, pageId, id}
 *   {action:"edit", …, elementId, text?, items?}            reword an agent element (the old text is kept in its history)
 * The learner's ink is stored beside the agent's pages and is never changed by "generate" or "edit".
 */
import { StudyInputError, checkedNotesScope, editNote, generateNotes, learnerInk, readNotebook, resolveEngine } from "@/src/server";

export const dynamic = "force-dynamic";
const LIMIT = 2 * 1024 * 1024;

const fail = (error: unknown) => {
	const status = error instanceof StudyInputError ? 400 : 500;
	return Response.json({ error: error instanceof Error ? error.message : "Notes failed." }, { status });
};
const scopeOf = (v: { subjectId?: unknown; topicId?: unknown }) => {
	if (typeof v.subjectId !== "string") throw new StudyInputError("subjectId is required.");
	return checkedNotesScope({ subjectId: v.subjectId, ...(typeof v.topicId === "string" && v.topicId ? { topicId: v.topicId } : {}) });
};

export function GET(request: Request) {
	try {
		const q = new URL(request.url).searchParams;
		return Response.json({ notebook: readNotebook(scopeOf({ subjectId: q.get("subjectId") ?? undefined, topicId: q.get("topicId") ?? undefined })) });
	} catch (error) { return fail(error); }
}

export async function POST(request: Request) {
	let raw: Record<string, any>;
	try {
		if (Number(request.headers.get("content-length")) > LIMIT) throw new StudyInputError("That request is too large.");
		raw = await request.json();
		if (!raw || typeof raw !== "object") throw new Error("bad");
	} catch (error) { return error instanceof StudyInputError ? fail(error) : Response.json({ error: "Send a JSON object." }, { status: 400 }); }
	try {
		const scope = scopeOf(raw);
		switch (raw.action) {
			case "generate": {
				const { notebook, added } = await generateNotes(scope, typeof raw.lesson === "string" ? raw.lesson.slice(-12000) : "", { engineFor: resolveEngine, signal: request.signal });
				return Response.json({ notebook, added });
			}
			case "stroke": return Response.json({ notebook: await learnerInk(scope, { kind: "stroke", pageId: String(raw.pageId), stroke: raw.stroke }) });
			case "undo": return Response.json({ notebook: await learnerInk(scope, { kind: "undo", pageId: String(raw.pageId) }) });
			case "sticky": return Response.json({ notebook: await learnerInk(scope, { kind: "sticky", pageId: String(raw.pageId), x: Number(raw.x), y: Number(raw.y), text: String(raw.text ?? "") }) });
			case "remove-sticky": return Response.json({ notebook: await learnerInk(scope, { kind: "remove-sticky", pageId: String(raw.pageId), id: String(raw.id) }) });
			case "edit": return Response.json({ notebook: await editNote(scope, String(raw.elementId), { text: raw.text, items: raw.items }) });
			default: return Response.json({ error: "Unknown action." }, { status: 400 });
		}
	} catch (error) {
		// Input mistakes (unknown element, empty text, nothing to add) are the caller's; surface them as 400.
		const message = error instanceof Error ? error.message : "Notes failed.";
		return Response.json({ error: message }, { status: /models|configured/i.test(message) ? 503 : 400 });
	}
}
