import { getChat, stores, study } from "@/src/server";
import { checkPlacement } from "@/src/core/study/model";

/**
 * PUT /api/chats/:id/placement — file a session under a subject (optionally a topic of it), or clear it
 * ({placement: null}). Validated against the library; filing is not conversation activity (updatedAt stays).
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const body = (await req.json().catch(() => null)) as { placement?: unknown } | null;
	if (!body || !("placement" in body)) return Response.json({ error: "Expected {placement}." }, { status: 400 });
	let placement = null;
	if (body.placement !== null) {
		try { placement = checkPlacement(study.library(), body.placement); }
		catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid placement." }, { status: 400 }); }
	}
	const record = stores.chatStore.savePlacement(id, placement);
	if (!record) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json({ id, placement: record.placement ?? null });
}
