/**
 * GET /api/planner/notes/result?externalId= — what absorbing a Planner note produced.
 * { status: "none" | "pending" | "done" | "failed", items, deadlines }: items are the dated items the note announced,
 * deadlines the ones newly added to Study (the rest already existed).
 */
import { absorbResult, plannerCorsHeaders, plannerPreflight } from "@/src/server";

export const dynamic = "force-dynamic";

const METHODS = "GET, OPTIONS";

export function OPTIONS(request: Request) {
	return plannerPreflight(request, METHODS);
}

export function GET(request: Request) {
	const headers = plannerCorsHeaders(request, METHODS);
	const externalId = new URL(request.url).searchParams.get("externalId")?.trim();
	if (!externalId) return Response.json({ error: "externalId is required." }, { status: 400, headers });
	const state = absorbResult(externalId);
	if (!state) return Response.json({ status: "none", items: [], deadlines: [] }, { headers });
	return Response.json({ status: state.status, items: state.items, deadlines: state.deadlines, ...(state.error ? { error: state.error } : {}) }, { headers });
}
