/**
 * POST /api/graph/update — the manual "Refresh graph" front door (G1).
 * Runs the same coverage-driven pass as the daily scheduler, but awaits it
 * so the button can show "Updated N chats". No per-turn caller uses this.
 * An optional { chatId } narrows the pass; absent = every uncovered chat.
 */
import { effectiveSettings, updateGraphNow } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	if (!effectiveSettings().graph.enabled) {
		return Response.json({ error: "Graph extraction is off." }, { status: 403 });
	}
	let chatId: string | undefined;
	try {
		const text = await request.text();
		if (text.trim()) {
			const body = JSON.parse(text) as { chatId?: unknown };
			if (body.chatId !== undefined) {
				if (typeof body.chatId !== "string" || body.chatId === "") {
					return Response.json({ error: "chatId must be a non-empty string" }, { status: 400 });
				}
				chatId = body.chatId;
			}
		}
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}
	try {
		const result = await updateGraphNow(chatId ? { chatId } : {}, { background: false });
		return Response.json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Graph update failed.";
		return Response.json({ error: message }, { status: 500 });
	}
}
