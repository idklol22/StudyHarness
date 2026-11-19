/**
 * What the chat agent is told when a chat lives in a subject or topic (Study overhaul, Phase D).
 * Pure: builds the instruction block from the placement, the layered context and the material list.
 * It is added AFTER the built-in teacher/prober/practice prompt, never replacing it.
 */
import { contextScopes, materialsIn, subjectOf, topicOf, type ChatPlacement, type Library } from "./model.ts";

/** Tool names this module adds (reserved so plugins cannot shadow them). */
export const STUDY_TOOL_NAMES = ["study_context", "study_material", "study_cards", "study_practice_next", "study_practice_rate"] as const;

const LAYERS = `Where to look, in this order — stop at the first layer that answers:
1. The topic context and subject context shown above (already in front of you; never re-fetch them).
2. study_context with a query: searches the material memory (contents, page-range summaries, stored page text).
3. study_material to read specific pages you have not read: it returns what is on them and remembers it.
Never read the same pages twice and never read a whole long document front to back: jump through the contents, read a few pages around the target, move on.`;

const SCRATCH = `This learner chose to START FROM SCRATCH. Do not probe and do not quiz them to find their level: assume a blank slate unless they say otherwise. Teach lesson-first:
- There is no probe assessment in the transcript; that is expected. Plan from the materials and the learner's stated goal.
- Use the materials' contents and summaries to scope a short plan (plan_init), then take the parts one at a time.
- For each part: explain it plainly, point at the figure or slide that shows it, give one small worked example, then ask one light check question before moving on.
- Keep steps short; follow where they are lost or curious. Their answers update what you assume; do not announce a level.`;

const CHECK = `This learner chose to CHECK WHAT THEY KNOW FIRST: run the normal probe, then teach from what it shows. Use the materials to choose what to probe.`;

const PRACTICE = `This is a PRACTICE chat. Draw practice from the topic's materials and the learner's flashcards (study_practice_next, then study_practice_rate with their honest 1–4 rating: 1 again, 2 hard, 3 good, 4 easy). Use cards for recall and the usual problems for application.`;

const CARDS = `Flashcards: when the learner gets something right for the first time, or a definition/fact is worth keeping, add a card with study_cards (one idea per card, question and answer short). Do not add cards the learner did not need.`;

/** A topic chat sees its own materials, then the subject's; a subject chat sees the subject's. */
export function visibleMaterials(library: Library, placement: ChatPlacement) {
	return [
		...(placement.topicId ? materialsIn(library, { subjectId: placement.subjectId, topicId: placement.topicId }) : []),
		...materialsIn(library, { subjectId: placement.subjectId }),
	];
}

export interface DoctrineInput {
	library: Library;
	placement: ChatPlacement;
	kind: "teach" | "practice";
	/** Cheap per-material read state, e.g. "read 12 of 80 pages". */
	readState?: (materialId: string) => string;
}

export function studyInstructions({ library, placement, kind, readState }: DoctrineInput): string {
	const subject = subjectOf(library, placement.subjectId);
	if (!subject) return "";
	const topic = placement.topicId ? topicOf(library, placement.topicId) : undefined;
	const out: string[] = [`# Study context\nThis chat belongs to the subject "${subject.name}"${topic ? `, topic "${topic.name}"` : " (subject-wide)"}.`];
	for (const layer of contextScopes(library, placement)) {
		out.push(layer.context.trim() ? `## ${layer.level === "topic" ? "Topic" : "Subject"} context — ${layer.name}\n${layer.context.trim()}` : `## ${layer.level === "topic" ? "Topic" : "Subject"} context — ${layer.name}\n(Nothing recorded yet.)`);
	}
	const materials = visibleMaterials(library, placement);
	out.push(materials.length
		? "## Materials\n" + materials.map((m) => `- ${m.fileName} — ${m.pageCount} pages${readState ? `, ${readState(m.id)}` : ""} [id ${m.id}]`).join("\n")
		: "## Materials\nNone uploaded yet. Teach from what you know and what the learner says; they can add slides or notes any time.");
	out.push(LAYERS);
	out.push(kind === "practice" ? PRACTICE : placement.startMode === "scratch" ? SCRATCH : CHECK);
	out.push(CARDS);
	return out.join("\n\n");
}
