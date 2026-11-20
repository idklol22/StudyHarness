/**
 * GET /api/planner/subjects — the planner's subject/topic picker, read from the Study library.
 * Colours reuse the same helper as the in-app subject picker, as a CSS colour string.
 */
import { subjectColor, subjectColorCss } from "@/src/core";
import { plannerCorsHeaders, plannerPreflight, study } from "@/src/server";

export const dynamic = "force-dynamic";

const METHODS = "GET, OPTIONS";

export function GET(request: Request) {
	const { subjects, topics } = study.library();
	return Response.json({
		subjects: subjects.map((subject) => ({
			id: subject.id,
			name: subject.name,
			color: subjectColorCss(subjectColor(subjects, subject.id)),
			topics: topics.filter((topic) => topic.subjectId === subject.id).map((topic) => ({ id: topic.id, name: topic.name })),
		})),
	}, { headers: plannerCorsHeaders(request, METHODS) });
}

export function OPTIONS(request: Request) {
	return plannerPreflight(request, METHODS);
}
