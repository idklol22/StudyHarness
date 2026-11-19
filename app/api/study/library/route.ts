/**
 * GET  /api/study/library  — subjects, topics and material references.
 * POST /api/study/library  — one action per request (operation-based, so unrelated edits are never overwritten):
 *   {action:"create-subject", name}            → {subject}   (an existing name returns it: create-on-the-spot is idempotent)
 *   {action:"create-topic", subjectId, name}   → {topic}
 *   {action:"rename-subject", id, name} · {action:"rename-topic", id, name}
 *   {action:"delete-subject", id} · {action:"delete-topic", id}     (cascade; unreferenced stored PDFs are removed)
 *   {action:"remove-material", id} · {action:"move-material", id, subjectId, topicId?}
 *   {action:"accept-suggestion", id, renames?: {index: name}} · {action:"dismiss-suggestion", id}   (suggested topics for a file)
 *   {action:"assign-material", id, topicId? | newTopicName?}   (the learner picks the topic; ideas are then found for it)
 *   {action:"add-idea"|"edit-idea"|"remove-idea", subjectId, topicId?, id?, name?, summary?}
 *   {action:"understand-material", id}          (re-run the background understanding of a file: text, skim, topics/ideas)
 */
import { StudyInputError, classifySubject, readOrganizationAction, resolveEngine, seedAcceptedTopics, digestMaterial, study } from "@/src/server";

export const dynamic = "force-dynamic";

export function GET() {
	return Response.json({ library: study.library() });
}

const text = (v: unknown, label: string): string => {
	if (typeof v !== "string") throw new StudyInputError(`${label} is required.`);
	return v;
};

/** The learner's edits to a suggestion: {index: "new name" | {name?, topicId?, ideas?: [{name, summary?, pages?}]}}. */
function readEdits(source: unknown): Record<number, string | { name?: string; topicId?: string; ideas?: Array<{ name: string; summary?: string; pages?: string }> }> | undefined {
	if (!source || typeof source !== "object") return undefined;
	const str = (v: unknown) => (typeof v === "string" ? v : undefined);
	type Edit = string | { name?: string; topicId?: string; ideas?: Array<{ name: string; summary?: string; pages?: string }> };
	return Object.fromEntries(Object.entries(source as Record<string, unknown>).flatMap(([k, v]): Array<[number, Edit]> => {
		if (typeof v === "string") return v.trim() ? [[Number(k), v]] : [];
		if (!v || typeof v !== "object") return [];
		const e = v as Record<string, unknown>;
		const ideas = Array.isArray(e.ideas)
			? e.ideas.flatMap((i) => { const r = (i ?? {}) as Record<string, unknown>; const name = str(r.name)?.trim(); return name ? [{ name, ...(str(r.summary) ? { summary: str(r.summary) } : {}), ...(str(r.pages) ? { pages: str(r.pages) } : {}) }] : []; })
			: undefined;
		return [[Number(k), { ...(str(e.name)?.trim() ? { name: str(e.name) } : {}), ...(str(e.topicId) ? { topicId: str(e.topicId) } : {}), ...(ideas ? { ideas } : {}) }]];
	}));
}

export async function POST(request: Request) {
	let raw: Record<string, unknown>;
	try { raw = (await readOrganizationAction(request)) as Record<string, unknown>; }
	catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Bad request." }, { status: 400 }); }
	try {
		switch (raw.action) {
			case "create-subject": {
				const before = new Set(study.library().subjects.map((s) => s.id));
				const subject = study.createSubject(raw.name);
				// A new subject is filed under its broad field (places related subjects near each other in the 3D graph).
				if (!before.has(subject.id)) classifySubject(subject.id, { engineFor: resolveEngine });
				return Response.json({ subject, library: study.library() });
			}
			case "create-topic": return Response.json({ topic: study.createTopic(text(raw.subjectId, "subjectId"), raw.name), library: study.library() });
			case "rename-subject": study.renameSubject(text(raw.id, "id"), raw.name); break;
			case "rename-topic": study.renameTopic(text(raw.id, "id"), raw.name); break;
			case "delete-subject": study.deleteSubject(text(raw.id, "id")); break;
			case "delete-topic": study.deleteTopic(text(raw.id, "id")); break;
			case "remove-material": study.removeMaterial(text(raw.id, "id")); break;
			case "move-material":
				study.moveMaterial(text(raw.id, "id"), { subjectId: text(raw.subjectId, "subjectId"), ...(typeof raw.topicId === "string" ? { topicId: raw.topicId } : {}) });
				break;
			case "accept-suggestion": {
				// edits: {index: {name?, topicId?, ideas?: [{name, summary?, pages?}]}}; a plain string is a new name ("renames" is the older spelling).
				const accepted = study.acceptSuggestion(text(raw.id, "id"), readEdits(raw.edits ?? raw.renames));
				seedAcceptedTopics(accepted, { engineFor: resolveEngine });
				return Response.json({ topics: accepted.map((a) => a.topicId), library: study.library() });
			}
			case "dismiss-suggestion": study.dismissSuggestion(text(raw.id, "id")); break;
			case "assign-material": {
				const r = study.assignMaterial(text(raw.id, "id"), { ...(typeof raw.topicId === "string" && raw.topicId ? { topicId: raw.topicId } : {}), ...(typeof raw.newTopicName === "string" ? { newTopicName: raw.newTopicName } : {}) });
				// The file's ideas for that topic are found in the background (activity panel).
				digestMaterial(r.material.id, { engineFor: resolveEngine });
				return Response.json({ topicId: r.topicId, library: study.library() });
			}
			case "add-idea": case "edit-idea": case "remove-idea": {
				const target = { subjectId: text(raw.subjectId, "subjectId"), ...(typeof raw.topicId === "string" && raw.topicId ? { topicId: raw.topicId } : {}) };
				if (raw.action === "add-idea") study.addIdea(target, { name: String(raw.name ?? ""), ...(typeof raw.summary === "string" ? { summary: raw.summary } : {}) });
				else if (raw.action === "edit-idea") study.editIdea(target, text(raw.id, "id"), { ...(typeof raw.name === "string" ? { name: raw.name } : {}), ...(typeof raw.summary === "string" ? { summary: raw.summary } : {}) });
				else study.removeIdea(target, text(raw.id, "id"));
				break;
			}
			case "understand-material": digestMaterial(study.material(text(raw.id, "id")).id, { engineFor: resolveEngine }); break;
			default: return Response.json({ error: "Unknown action." }, { status: 400 });
		}
		return Response.json({ library: study.library() });
	} catch (error) {
		if (error instanceof StudyInputError) return Response.json({ error: error.message }, { status: 400 });
		console.error("[study] library action failed:", error);
		return Response.json({ error: "Could not change the library." }, { status: 500 });
	}
}
