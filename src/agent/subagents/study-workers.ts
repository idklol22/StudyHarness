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

// ── note-taker: plan blocks, then mark figures ──────────────────────────────────────────────────────────────────

import type { Block, Mark } from "../../core/study/notes.ts";

const MARKER_PROMPT = `You annotate ONE page image the way a student marks up a slide with a pen.
Given what the note is about, submit 1–4 marks over the part of the page that matters. Coordinates are fractions of the image (0 = left/top, 1 = right/bottom).
Kinds: circle (x,y = top-left, w,h = size), highlight and underline (x,y,w,h), bracket (x,y,w,h), arrow (x,y = the tip pointing at the thing, fromX,fromY = the tail, away from it), label (x,y position, label = a short phrase, at most 6 words).
Prefer a circle or highlight on the key formula or part, an arrow to a short label. Mark only what is visible. If nothing on the page is worth marking, submit no marks.`;
const markerSchema = Type.Object({
	marks: Type.Array(Type.Object({
		kind: Type.Union([Type.Literal("circle"), Type.Literal("arrow"), Type.Literal("underline"), Type.Literal("highlight"), Type.Literal("bracket"), Type.Literal("label")]),
		x: Type.Number(), y: Type.Number(), w: Type.Optional(Type.Number()), h: Type.Optional(Type.Number()),
		fromX: Type.Optional(Type.Number()), fromY: Type.Optional(Type.Number()), label: Type.Optional(Type.String()),
	})),
});

/** A vision look at one page: where would a student circle, underline or point? */
export async function markFigure(image: PageImage, focus: string, env: WorkerEnv): Promise<Mark[]> {
	const content = [
		{ type: "image", data: image.data, mimeType: image.mimeType },
		{ type: "text", text: `The note is about: ${focus || "the main idea on this page"}. Submit the marks.` },
	];
	const messages = [{ role: "user", content, timestamp: Date.now() }] as unknown as AgentMessage[];
	const out = await runSubmitAgent<{ marks: Mark[] }>({
		role: "pdfReader", toolName: "submit_marks", toolDescription: "Submit the marks for this page.", parameters: markerSchema,
		fill: (i) => ({ marks: i.marks ?? [] }), systemPrompt: MARKER_PROMPT, messages, engine: env.engine, signal: env.signal, chatId: env.chatId,
		onStep: (usage, model) => env.onUsage?.(usage, model), neverSubmitted: "The page marker did not submit.",
	});
	return out.marks;
}

const NOTE_PROMPT = `You write the class notes a diligent student would hand-write on an iPad while learning this topic: short, visual, in their own words.
You are given the topic's context, what the course material contains (page summaries and figures worth showing), what the notes already say, and the lesson so far.
Submit ONLY the blocks to ADD (never repeat what the notes already say). Block types:
- heading: a section title.
- text: one or two short sentences.
- bullets: 2–6 very short points.
- box: kind definition | exam | revisit | mistake | idea, optional title, short text. Use sparingly.
- sticky: a tiny margin note (a hint, a warning, "exam favourite!"); at most 12 words.
- steps: a worked example from the lesson, one short step per line, with the numbers.
- figure: a page of the material to screenshot: materialId, page, and "focus" = what on that page the note is about (a few words). Prefer a figure whenever the material has a diagram, plot, formula or worked example for the point.
Write like notes, not like an essay. Keep the whole submission under about 14 blocks. Never invent facts that are not in the context, material or lesson.`;
const noteSchema = Type.Object({
	blocks: Type.Array(Type.Object({
		type: Type.Union([Type.Literal("heading"), Type.Literal("text"), Type.Literal("bullets"), Type.Literal("box"), Type.Literal("sticky"), Type.Literal("steps"), Type.Literal("figure")]),
		text: Type.Optional(Type.String()), items: Type.Optional(Type.Array(Type.String())), steps: Type.Optional(Type.Array(Type.String())),
		kind: Type.Optional(Type.String()), title: Type.Optional(Type.String()),
		materialId: Type.Optional(Type.String()), page: Type.Optional(Type.Integer({ minimum: 1 })), focus: Type.Optional(Type.String()), caption: Type.Optional(Type.String()),
	})),
	summary: Type.Optional(Type.String()),
});

export interface PlannedBlock { block: Block; focus?: string }
export interface NotePlan { blocks: PlannedBlock[]; summary: string }

/** Plan the next blocks of the notes. Figures come back without marks (see markFigure) and with a placeholder aspect. */
export async function planNotes(input: { name: string; context: string; materials: string; outline: string; lesson: string }, env: WorkerEnv): Promise<NotePlan> {
	const out = await runSubmitAgent<{ blocks: any[]; summary?: string }>({
		role: "extractor", toolName: "submit_blocks", toolDescription: "Submit the note blocks to add.", parameters: noteSchema,
		fill: (i) => ({ blocks: i.blocks ?? [], summary: i.summary }), systemPrompt: NOTE_PROMPT,
		prompt: `Topic: ${input.name}\n\n# Context\n${input.context || "(none)"}\n\n# Material\n${input.materials || "(none)"}\n\n# Notes so far\n${input.outline}\n\n# The lesson so far\n${input.lesson || "(no lesson yet — write notes from the material)"}`,
		engine: env.engine, signal: env.signal, chatId: env.chatId, onStep: (usage, model) => env.onUsage?.(usage, model), neverSubmitted: "The note-taker did not submit.",
		validate: (v) => (v.blocks.length ? null : "Submit at least one block."),
	});
	const blocks: PlannedBlock[] = out.blocks.flatMap((b): PlannedBlock[] => {
		const t = b.type;
		if (t === "figure") return b.materialId && b.page ? [{ block: { type: "figure", materialId: b.materialId, page: b.page, aspect: 0.75, caption: b.caption }, focus: b.focus }] : [];
		if (t === "bullets") return b.items?.length ? [{ block: { type: "bullets", items: b.items } }] : [];
		if (t === "steps") return b.steps?.length ? [{ block: { type: "steps", title: b.title, steps: b.steps } }] : [];
		if (t === "box") return b.text ? [{ block: { type: "box", kind: b.kind ?? "idea", title: b.title, text: b.text } }] : [];
		return b.text ? [{ block: { type: t, text: b.text } as Block }] : [];
	});
	return { blocks, summary: out.summary ?? `Notes on ${input.name}` };
}
