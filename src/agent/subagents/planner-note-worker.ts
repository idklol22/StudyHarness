/**
 * Planner note absorption worker: one text call that returns the course knowledge and the dated items of a
 * student's planner note. Goes through runSubmitAgent, so a schema-invalid submit is retried by the model.
 */
import { Type } from "typebox";
import { runSubmitAgent } from "./submit-agent.ts";
import type { WorkerEnv } from "./study-workers.ts";

const ABSORB_PROMPT = `You absorb one student's class note, written in a planner app, into their study assistant.
Submit:
- knowledge: concise Markdown of the course facts worth remembering for future study chats (definitions, formulas, mechanisms, numbers, examples). Keep the useful remarks of the student. No fluff, no greeting, no restating of deadlines; an empty string if the note teaches nothing.
- items: every assignment, exam, quiz, lab or other dated obligation the note announces, each with title (short, e.g. "Lab assignment"), kind (assignment|exam|quiz|other), date as YYYY-MM-DD, optional time as 24 h HH:MM, and optional syllabus (what it covers, in the words of the student).
Resolve relative dates ("tomorrow", "Friday", "on the 29th") against the NOTE DATE given below: a bare day of the month means that day of the note's month, or of the next month if it has already passed. Only include an item when its date is clear; never invent one.`;

const absorbSchema = Type.Object({
	knowledge: Type.String(),
	items: Type.Array(Type.Object({
		title: Type.String(),
		kind: Type.String(),
		date: Type.String(),
		time: Type.Optional(Type.String()),
		syllabus: Type.Optional(Type.String()),
	})),
});

/** Returns the raw submitted object; the caller validates it with normalizeAbsorbed. */
export async function absorbNote(input: { title: string; date: string; weekday: string; markdown: string }, env: WorkerEnv): Promise<unknown> {
	return await runSubmitAgent<{ knowledge: string; items: unknown[] }>({
		role: "extractor",
		toolName: "submit_note",
		toolDescription: "Submit the knowledge and dated items found in the note.",
		parameters: absorbSchema,
		fill: (i) => ({ knowledge: String(i.knowledge ?? ""), items: Array.isArray(i.items) ? i.items : [] }),
		systemPrompt: ABSORB_PROMPT,
		prompt: `NOTE DATE: ${input.date} (${input.weekday})\nNOTE TITLE: ${input.title}\n\n# Note\n${input.markdown}`,
		engine: env.engine,
		signal: env.signal,
		chatId: env.chatId,
		onStep: (usage, model) => env.onUsage?.(usage, model),
		neverSubmitted: "The note reader did not submit.",
	});
}
