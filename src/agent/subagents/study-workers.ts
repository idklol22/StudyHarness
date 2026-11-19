/**
 * Study workers (Phase D): two small single-submit agents.
 *  - readPages   (vision model): looks at page images once and returns what is on them, for the material memory.
 *  - keepContext (cheap model): folds new knowledge into a topic/subject's bounded context document.
 * Both go through runSubmitAgent, so a malformed submit is retried by the model, not by the caller.
 */
import { Type } from "typebox";
import type { Usage } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { PiEngine } from "../models.ts";
import { runSubmitAgent } from "./submit-agent.ts";

export const CONTEXT_CHAR_CAP = 6000;

export interface WorkerEnv {
	engine: PiEngine | undefined;
	signal?: AbortSignal;
	onUsage?: (usage: Usage, model: string) => void;
	chatId?: string;
}

export interface PageImage { page: number; data: string; mimeType: string }
export interface PageRead {
	pages: Array<{ n: number; text: string }>;
	summary: string;
	concepts: string[];
	toc: Array<{ title: string; page: number }>;
	figures: Array<{ page: number; caption: string }>;
}

const READER_PROMPT = `You read pages of study material (slides, notes, textbook pages) once, so nobody has to read them again.
For the pages shown, submit:
- pages: for EACH page its number and the text worth remembering (headings, definitions, formulas, the point of each figure) — faithful, compact, at most ~1500 characters per page;
- summary: 2–4 sentences on what these pages teach;
- concepts: the named ideas introduced (short titles);
- toc: any table-of-contents entries visible (title and the PRINTED page number), else empty;
- figures: the diagrams, plots or worked examples worth showing a learner later (page and a one-line caption).
Report only what is on the pages. Never invent content.`;

const readerSchema = Type.Object({
	pages: Type.Array(Type.Object({ n: Type.Integer({ minimum: 1 }), text: Type.String() })),
	summary: Type.String(),
	concepts: Type.Optional(Type.Array(Type.String())),
	toc: Type.Optional(Type.Array(Type.Object({ title: Type.String(), page: Type.Integer({ minimum: 1 }) }))),
	figures: Type.Optional(Type.Array(Type.Object({ page: Type.Integer({ minimum: 1 }), caption: Type.String() }))),
});

/** Read a few page images (a batch of ≤ 8) and return what to remember. */
export async function readPages(images: readonly PageImage[], hint: string, env: WorkerEnv): Promise<PageRead> {
	const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
	for (const img of images) {
		content.push({ type: "text", text: `Page ${img.page}:` });
		content.push({ type: "image", data: img.data, mimeType: img.mimeType });
	}
	content.push({ type: "text", text: `${hint ? `Context: ${hint}\n` : ""}Submit your reading of pages ${images.map((i) => i.page).join(", ")}.` });
	const messages = [{ role: "user", content, timestamp: Date.now() }] as unknown as AgentMessage[];
	const read = await runSubmitAgent<PageRead>({
		role: "pdfReader",
		toolName: "submit_pages",
		toolDescription: "Submit what the pages say.",
		parameters: readerSchema,
		fill: (i) => ({ pages: i.pages, summary: i.summary, concepts: i.concepts ?? [], toc: i.toc ?? [], figures: i.figures ?? [] }),
		systemPrompt: READER_PROMPT,
		messages,
		engine: env.engine,
		signal: env.signal,
		chatId: env.chatId,
		onStep: (usage, model) => env.onUsage?.(usage, model),
		neverSubmitted: "The page reader did not submit.",
		validate: (v) => (v.pages.length ? null : "Include the text of every page shown."),
	});
	return read;
}

const KEEPER_PROMPT = `You maintain the context document of one study topic or subject: the running memory a tutor reads before every session.
Merge the new information into the current document and submit the whole updated document. Keep it under ${CONTEXT_CHAR_CAP} characters; drop least-useful detail first.
Use these short sections, only where there is something to say:
## Covered — what has been taught or read, one line each
## Key ideas — definitions, results, formulas worth keeping
## Where in the material — "idea → file, page"
## Learner — what they know, struggle with, misconceptions, goals
Never invent facts. Keep what is still true; correct what the new information contradicts.`;

const keeperSchema = Type.Object({ context: Type.String() });

export async function keepContext(input: { name: string; level: "topic" | "subject"; current: string; update: string }, env: WorkerEnv): Promise<string> {
	const out = await runSubmitAgent<{ context: string }>({
		role: "extractor",
		toolName: "submit_context",
		toolDescription: "Submit the full updated context document.",
		parameters: keeperSchema,
		fill: (i) => ({ context: String(i.context ?? "") }),
		systemPrompt: KEEPER_PROMPT,
		prompt: `The ${input.level} is "${input.name}".\n\n# Current document\n${input.current.trim() || "(empty)"}\n\n# New information\n${input.update.trim()}`,
		engine: env.engine,
		signal: env.signal,
		chatId: env.chatId,
		onStep: (usage, model) => env.onUsage?.(usage, model),
		neverSubmitted: "The context keeper did not submit.",
		validate: (v) => (v.context.trim() ? null : "The document cannot be empty."),
	});
	return out.context.trim().slice(0, CONTEXT_CHAR_CAP);
}
