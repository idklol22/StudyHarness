/**
 * GET  /api/study/notes?subjectId=…[&topicId=…][&notebookId=…]  — a notebook (default: the newest) and the scope's list
 *      of notebooks {notebook, notebookId, notebooks}. A notebook holds at most 32 pages; a scope can have several.
 * POST /api/study/notes                          — one action per request:
 *   {action:"generate", subjectId, topicId?, pages? (8–32), title?, coverage?: [{materialId, from, to}] (≤ 32 source pages),
 *     chats?: string[], knowledge?: boolean, lesson?}  a NEW notebook summarising
 *                                                         the scope's files and chats; every other action takes notebookId?
 *   {action:"stroke", subjectId, topicId?, pageId, stroke}  the learner draws (pen / highlighter)
 *   {action:"undo", …, pageId} · {action:"sticky", …, pageId, x, y, text} · {action:"remove-sticky", …, pageId, id}
 *   {action:"edit", …, elementId, text?, items?}            reword an agent element (the old text is kept in its history)
 * The learner's ink is stored beside the agent's pages and is never changed by "generate" or "edit".
 */
import { StudyInputError, chatsInScope, checkedNotesScope, editNote, effectiveSettings, generateNotes, learnerInk, notebooksOf, readNotebook, resolveEngine, subjectNotebooks, updateGraphNow } from "@/src/server";

export const dynamic = "force-dynamic";
const LIMIT = 2 * 1024 * 1024;

/** Cap the pre-notes graph pass: notes ALWAYS proceed, even on timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Graph update timed out")), ms);
		promise.then(
			(value) => { clearTimeout(timer); resolve(value); },
			(error) => { clearTimeout(timer); reject(error); },
		);
	});
}

const fail = (error: unknown) => {
	const status = error instanceof StudyInputError ? 400 : 500;
	return Response.json({ error: error instanceof Error ? error.message : "Notes failed." }, { status });
};
const scopeOf = (v: { subjectId?: unknown; topicId?: unknown; notebookId?: unknown }) => {
	if (typeof v.subjectId !== "string") throw new StudyInputError("subjectId is required.");
	return checkedNotesScope({ subjectId: v.subjectId, ...(typeof v.topicId === "string" && v.topicId ? { topicId: v.topicId } : {}), ...(typeof v.notebookId === "string" && v.notebookId ? { notebookId: v.notebookId } : {}) });
};
/** The notebook plus the scope's notebook list, so the viewer can show tabs. */
const view = (scope: ReturnType<typeof scopeOf>, notebook = readNotebook(scope)) => {
	const notebooks = notebooksOf(scope);
	return { notebook, notebookId: scope.notebookId ?? notebooks.at(-1)?.id ?? null, notebooks };
};

export function GET(request: Request) {
	try {
		const q = new URL(request.url).searchParams;
		// ?view=coverage&subjectId=…: every notebook of the subject and its topics with the file pages each covers.
		if (q.get("view") === "coverage") return Response.json({ notebooks: subjectNotebooks(String(q.get("subjectId") ?? "")) });
		return Response.json(view(scopeOf({ subjectId: q.get("subjectId") ?? undefined, topicId: q.get("topicId") ?? undefined, notebookId: q.get("notebookId") ?? undefined })));
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
				const { subjectId, topicId } = scope;
				// G1: fold the scope's chats into the graph BEFORE writing notes —
				// best-effort, capped at 60s, and never a reason to fail notes.
				if (effectiveSettings().graph.enabled) {
					try {
						await withTimeout(
							updateGraphNow({ chatIds: chatsInScope({ subjectId, ...(topicId ? { topicId } : {}) }).map((c) => c.id) }),
							60_000,
						);
					} catch (error) {
						console.error("[graph] update before Create notes failed; notes will proceed:", error);
					}
				}
				const { notebook, notebookId, added } = await generateNotes({ subjectId, ...(topicId ? { topicId } : {}) }, typeof raw.lesson === "string" ? raw.lesson.slice(-12000) : "", { engineFor: resolveEngine, signal: request.signal }, {
					pages: Number(raw.pages) || undefined,
					title: typeof raw.title === "string" ? raw.title : undefined,
					coverage: Array.isArray(raw.coverage) ? raw.coverage.flatMap((c: unknown) => { const r = (c ?? {}) as Record<string, unknown>; return typeof r.materialId === "string" ? [{ materialId: r.materialId, from: Number(r.from), to: Number(r.to) }] : []; }) : undefined,
					chats: Array.isArray(raw.chats) ? raw.chats.filter((c: unknown): c is string => typeof c === "string") : undefined,
					knowledge: typeof raw.knowledge === "boolean" ? raw.knowledge : undefined,
				});
				return Response.json({ ...view({ ...scope, notebookId }, notebook), added });
			}
			case "stroke": return Response.json(view(scope, await learnerInk(scope, { kind: "stroke", pageId: String(raw.pageId), stroke: raw.stroke })));
			case "undo": return Response.json(view(scope, await learnerInk(scope, { kind: "undo", pageId: String(raw.pageId) })));
			case "sticky": return Response.json(view(scope, await learnerInk(scope, { kind: "sticky", pageId: String(raw.pageId), x: Number(raw.x), y: Number(raw.y), text: String(raw.text ?? "") })));
			case "remove-sticky": return Response.json(view(scope, await learnerInk(scope, { kind: "remove-sticky", pageId: String(raw.pageId), id: String(raw.id) })));
			case "edit": return Response.json(view(scope, await editNote(scope, String(raw.elementId), { text: raw.text, items: raw.items })));
			default: return Response.json({ error: "Unknown action." }, { status: 400 });
		}
	} catch (error) {
		// Input mistakes (unknown element, empty text, nothing to add) are the caller's; surface them as 400.
		const message = error instanceof Error ? error.message : "Notes failed.";
		return Response.json({ error: message }, { status: /models|configured/i.test(message) ? 503 : 400 });
	}
}
