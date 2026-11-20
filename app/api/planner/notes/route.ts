/**
 * POST /api/planner/notes — hand a planner task's notes to Study as a Markdown TEXT material.
 * Body: { externalId, subjectId, topicId?, title, date (YYYY-MM-DD), markdown, finished }.
 * Repeated hand-offs of the same externalId update that task's material instead of adding another.
 */
import { emit } from "@/src/core";
import { PlannerNoteInputError, plannerCorsHeaders, plannerNoteMap, plannerPreflight, StudyInputError, study, upsertPlannerNote, validatePlannerNote } from "@/src/server";

export const dynamic = "force-dynamic";

const METHODS = "POST, OPTIONS";

export function OPTIONS(request: Request) {
	return plannerPreflight(request, METHODS);
}

export async function POST(request: Request) {
	const headers = plannerCorsHeaders(request, METHODS);
	let raw: unknown;
	try { raw = await request.json(); }
	catch { return Response.json({ error: "Send a JSON object." }, { status: 400, headers }); }
	try {
		const note = validatePlannerNote(raw);
		const { materialId } = await upsertPlannerNote(note, { study, map: plannerNoteMap });
		emit("sources-changed", {}); // the same event the materials route announces; pages refetch the library
		return Response.json({ materialId }, { headers });
	} catch (error) {
		if (error instanceof PlannerNoteInputError || error instanceof StudyInputError) return Response.json({ error: error.message }, { status: 400, headers });
		console.error("[planner] note hand-off failed:", error);
		return Response.json({ error: "Could not save the note." }, { status: 500, headers });
	}
}
