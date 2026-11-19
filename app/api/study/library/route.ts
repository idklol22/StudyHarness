/**
 * GET  /api/study/library  — subjects, topics and material references.
 * POST /api/study/library  — one action per request (operation-based, so unrelated edits are never overwritten):
 *   {action:"create-subject", name}            → {subject}   (an existing name returns it: create-on-the-spot is idempotent)
 *   {action:"create-topic", subjectId, name}   → {topic}
 *   {action:"rename-subject", id, name} · {action:"rename-topic", id, name}
 *   {action:"delete-subject", id} · {action:"delete-topic", id}     (cascade; unreferenced stored PDFs are removed)
 *   {action:"remove-material", id} · {action:"move-material", id, subjectId, topicId?}
 */
import { StudyInputError, readOrganizationAction, study } from "@/src/server";

export const dynamic = "force-dynamic";

export function GET() {
	return Response.json({ library: study.library() });
}

const text = (v: unknown, label: string): string => {
	if (typeof v !== "string") throw new StudyInputError(`${label} is required.`);
	return v;
};

export async function POST(request: Request) {
	let raw: Record<string, unknown>;
	try { raw = (await readOrganizationAction(request)) as Record<string, unknown>; }
	catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Bad request." }, { status: 400 }); }
	try {
		switch (raw.action) {
			case "create-subject": return Response.json({ subject: study.createSubject(raw.name), library: study.library() });
			case "create-topic": return Response.json({ topic: study.createTopic(text(raw.subjectId, "subjectId"), raw.name), library: study.library() });
			case "rename-subject": study.renameSubject(text(raw.id, "id"), raw.name); break;
			case "rename-topic": study.renameTopic(text(raw.id, "id"), raw.name); break;
			case "delete-subject": study.deleteSubject(text(raw.id, "id")); break;
			case "delete-topic": study.deleteTopic(text(raw.id, "id")); break;
			case "remove-material": study.removeMaterial(text(raw.id, "id")); break;
			case "move-material":
				study.moveMaterial(text(raw.id, "id"), { subjectId: text(raw.subjectId, "subjectId"), ...(typeof raw.topicId === "string" ? { topicId: raw.topicId } : {}) });
				break;
			default: return Response.json({ error: "Unknown action." }, { status: 400 });
		}
		return Response.json({ library: study.library() });
	} catch (error) {
		if (error instanceof StudyInputError) return Response.json({ error: error.message }, { status: 400 });
		console.error("[study] library action failed:", error);
		return Response.json({ error: "Could not change the library." }, { status: 500 });
	}
}
