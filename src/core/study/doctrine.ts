/**
 * What the chat agent is told when a chat lives in a subject or topic (Study overhaul, Phase D).
 * Pure: builds the instruction block from the placement, the layered context and the material list.
 * It is added AFTER the built-in teacher/prober/practice prompt, never replacing it.
 */
import { contextScopes, materialsIn, materialsUnder, materialTopicName, relatedContexts, subjectOf, topicOf, type ChatPlacement, type Library } from "./model.ts";

/** Tool names this module adds (reserved so plugins cannot shadow them). */
export const STUDY_TOOL_NAMES = ["study_context", "study_material", "show_figure", "study_cards", "study_notes", "study_practice_next", "study_practice_rate", "save_chat_notes"] as const;

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

const FILES_ONLY = `HANDING OVER FILES IS NOT A QUESTION. Files attached in a chat are saved to the subject/topic automatically. When the learner's message is mostly files, or says things like "these are today's notes / the slides / my class material", they are just giving you material:
- Do NOT start teaching, probing, quizzing, or planning a lesson, and do NOT ask what to do with them, what order to teach in, or what their level is.
- Reply briefly: say what you received and that it is saved to the subject/topic, then give a compact overview of what is in it (3–5 bullets: the main topics or lectures, anything notable).
- Close with ONE short line of optional next steps (for example: teach it, make class notes, make flashcards — or nothing, it is simply kept), then stop and wait. They can also just keep adding files or ask anything.
Only teach or ask questions when the learner asks you to, or sends a question or goal of their own along with the files.`;

const PRACTICE =`This is a PRACTICE chat. Draw practice from the topic's materials and the learner's flashcards (study_practice_next, then study_practice_rate with their honest 1–4 rating: 1 again, 2 hard, 3 good, 4 easy). Use cards for recall and the usual problems for application.`;

const NOTES = `Notes: keep the learner's class notes as you teach with study_notes — after each part is taught, add a few short blocks (a heading, 2–4 bullets, a sticky for a warning, the worked steps you just did, and a figure block for the slide or diagram you used). Annotate sparingly: give a figure a focus (pen marks) only for what this learner struggled with or got wrong; ordinary figures are clean screenshots. Call study_notes outline first if unsure what is already there; edit, never repeat. Short, like a student's own notes.`;

const CARDS = `Flashcards: when the learner gets something right for the first time, or a definition/fact is worth keeping, add a card with study_cards (one idea per card, question and answer short). Do not add cards the learner did not need. Write any maths in cards and notes in LaTeX ($...$ inline, $$...$$ displayed), never as plain text.`;

/**
 * A topic chat sees its own files first, then the subject-wide ones, then the other topics' (a topic can draw
 * on what its neighbours hold). A subject chat sees every file in the subject, topics' included.
 */
export function visibleMaterials(library: Library, placement: ChatPlacement) {
	if (!placement.topicId) return materialsUnder(library, { subjectId: placement.subjectId });
	const own = materialsIn(library, { subjectId: placement.subjectId, topicId: placement.topicId });
	const wide = materialsIn(library, { subjectId: placement.subjectId });
	const seen = new Set([...own, ...wide].map((m) => m.id));
	return [...own, ...wide, ...materialsUnder(library, { subjectId: placement.subjectId }).filter((m) => !seen.has(m.id))];
}

export interface DoctrineInput {
	library: Library;
	placement: ChatPlacement;
	kind: "teach" | "practice";
	/** "plain" keeps only the subject/topic context + materials list. The teaching
	 *  blocks (layers, start mode, files, notes, cards, practice) stay out. */
	mode?: "teach" | "plain";
	/** Cheap per-material read state, e.g. "read 12 of 80 pages". */
	readState?: (materialId: string) => string;
}

export function studyInstructions({ library, placement, kind, mode = "teach", readState }: DoctrineInput): string {
	const subject = subjectOf(library, placement.subjectId);
	if (!subject) return "";
	const topic = placement.topicId ? topicOf(library, placement.topicId) : undefined;
	const out: string[] = [`# Study context\nThis chat belongs to the subject "${subject.name}"${topic ? `, topic "${topic.name}"` : " (subject-wide)"}.`];
	for (const layer of contextScopes(library, placement)) {
		out.push(layer.context.trim() ? `## ${layer.level === "topic" ? "Topic" : "Subject"} context — ${layer.name}\n${layer.context.trim()}` : `## ${layer.level === "topic" ? "Topic" : "Subject"} context — ${layer.name}\n(Nothing recorded yet.)`);
	}
	const related = relatedContexts(library, placement);
	if (related.length) out.push(`## ${topic ? "Related topics in this subject (background only; the chat's own topic comes first)" : "What each topic holds"}\n` + related.map((r) => `### ${r.name}\n${r.context}`).join("\n\n"));
	const materials = visibleMaterials(library, placement);
	out.push(materials.length
		? "## Materials\n" + materials.map((m) => `- ${m.fileName} — ${m.pageCount} ${m.kind === "text" ? "text pages" : "pages"}${materialTopicName(library, m) ? `, in topic "${materialTopicName(library, m)}"` : ""}${readState ? `, ${readState(m.id)}` : ""} [id ${m.id}]`).join("\n")
		: `## Materials\nNone uploaded yet. ${mode === "plain" ? "Answer" : "Teach"} from what you know and what the learner says; they can add slides or notes any time.`);
	// Plain study chats are ordinary Claude-style conversations: the library
	// listing above is useful context, but none of the teaching/assessment
	// doctrine applies (startMode is ignored for these chats).
	if (mode === "plain") return out.join("\n\n");
	out.push(LAYERS);
	out.push(kind === "practice" ? PRACTICE : placement.startMode === "scratch" ? SCRATCH : CHECK);
	if (kind !== "practice") out.push(FILES_ONLY);
	if (kind !== "practice") out.push(NOTES);
	out.push(CARDS);
	return out.join("\n\n");
}
