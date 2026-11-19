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

import type { Block } from "../../core/study/notes.ts";
import type { MarkPick } from "../../core/study/text-boxes.ts";
import { DIAGRAM_GUIDE, diagramFromFlat } from "../../core/study/diagram.ts";

const MARKER_PROMPT = `You mark up ONE page of course material the way a student does with a pen, but sparingly: only what the learner needs to look at for the point given. You see the page's text.
Submit at most 2 picks (usually 1). Each pick is a QUOTE copied exactly from the page text (3–10 consecutive words, or a whole formula/term), a kind, and an optional short label (at most 5 words):
- circle: the key term, formula or value;
- highlight: a phrase or definition to reread;
- underline: a short statement;
- arrow: points at the quoted words, with a label explaining it.
If nothing on the page matches the point, submit no picks.`;
const markerSchema = Type.Object({
	picks: Type.Array(Type.Object({
		quote: Type.String({ description: "Words copied exactly from the page text." }),
		kind: Type.Union([Type.Literal("circle"), Type.Literal("highlight"), Type.Literal("underline"), Type.Literal("arrow")]),
		label: Type.Optional(Type.String()),
	})),
});

/**
 * Which words on a page to mark for a point (the learner's difficulty). Code then places the marks exactly on those
 * words from the PDF's own text layout (core/study/text-boxes.ts), so marks never drift. No text → no picks.
 */
export async function markFigure(pageText: string, focus: string, env: WorkerEnv): Promise<MarkPick[]> {
	if (!pageText.trim() || !focus.trim()) return [];
	const out = await runSubmitAgent<{ picks: MarkPick[] }>({
		role: "extractor", toolName: "submit_picks", toolDescription: "Submit the words to mark.", parameters: markerSchema,
		fill: (i) => ({ picks: i.picks ?? [] }), systemPrompt: MARKER_PROMPT,
		prompt: `The point to mark: ${focus}\n\nPage text:\n${pageText.slice(0, 6000)}`,
		engine: env.engine, signal: env.signal, chatId: env.chatId,
		onStep: (usage, model) => env.onUsage?.(usage, model), neverSubmitted: "The page marker did not submit.",
	});
	return out.picks.slice(0, 2);
}

const NOTE_PROMPT = `You write the class notes a diligent student would hand-write on an iPad while learning this topic: clear, visual and complete, in their own words.
You are given the topic's context, what the course material contains (page summaries and figures worth showing), what the notes already say, and the lesson so far.
Submit ONLY the blocks to ADD (never repeat what the notes already say). Block types:
- heading: a section title.
- text: one or two short sentences.
- bullets: 2–6 very short points.
- box: kind definition | exam | revisit | mistake | idea, optional title, short text. Use sparingly.
- sticky: a tiny margin note (a hint, a warning, "exam favourite!"); at most 12 words.
- steps: a worked example from the lesson, one short step per line, with the numbers.
- figure: a page of the material to screenshot: materialId, page, optional caption. Prefer a figure whenever the material has a diagram, plot, formula or worked example for the point. Give "focus" ONLY for something the conversations show the learner found hard or got wrong (it gets marked with a pen); otherwise leave focus out — clean screenshots are the norm.
- math: a displayed equation — latex (LaTeX, no $ signs) and optional text saying what it means.
${DIAGRAM_GUIDE}
MATHS IS ALWAYS LaTeX: every formula, symbol and variable, in every block, is written in LaTeX — inline as $...$ inside text, bullets, boxes, steps and stickies (e.g. "$T(n) = 2T(n/2) + O(n)$", "each $x_i$"), a key equation as a math block. Never plain-text maths like T(n)=2T(n/2)+O(n) or x^2.
Quality bar: the notes must be DESCRIPTIVE and cover the basic content properly. For every concept in the material: a heading, a plain-language explanation in 2–4 sentences ("text"), the key points as bullets, a definition box for each important term, and a worked example ("steps") where the source has one. Add a flowchart for every process, algorithm, protocol or lifecycle, and a mind map for every group of related ideas (for a whole file or chapter: one mind map of its structure first). Use stickies for tips and exam warnings. Be faithful and specific (names, numbers, formulas from the source) rather than vague. Keep any single text block under about 60 words. Never invent facts that are not in the context, material or lesson.`;
const noteSchema = Type.Object({
	blocks: Type.Array(Type.Object({
		type: Type.Union([Type.Literal("heading"), Type.Literal("text"), Type.Literal("bullets"), Type.Literal("box"), Type.Literal("sticky"), Type.Literal("steps"), Type.Literal("figure"), Type.Literal("diagram"), Type.Literal("math")]),
		latex: Type.Optional(Type.String({ description: "math: the equation in LaTeX, without $ signs" })),
		diagramKind: Type.Optional(Type.Union([Type.Literal("flow"), Type.Literal("mind")])),
		nodes: Type.Optional(Type.Array(Type.Object({ id: Type.String(), text: Type.String(), decision: Type.Optional(Type.Boolean()) }))),
		edges: Type.Optional(Type.Array(Type.Object({ from: Type.String(), to: Type.String(), label: Type.Optional(Type.String()) }))),
		center: Type.Optional(Type.String()),
		branches: Type.Optional(Type.Array(Type.Object({ text: Type.String(), children: Type.Optional(Type.Array(Type.String())) }))),
		text: Type.Optional(Type.String()), items: Type.Optional(Type.Array(Type.String())), steps: Type.Optional(Type.Array(Type.String())),
		kind: Type.Optional(Type.String()), title: Type.Optional(Type.String()),
		materialId: Type.Optional(Type.String()), page: Type.Optional(Type.Integer({ minimum: 1 })), focus: Type.Optional(Type.String()), caption: Type.Optional(Type.String()),
	})),
	summary: Type.Optional(Type.String()),
});

export interface PlannedBlock { block: Block; focus?: string }
export interface NotePlan { blocks: PlannedBlock[]; summary: string }

/** Plan the next blocks of the notes. Figures come back without marks (see markFigure) and with a placeholder aspect. */
export async function planNotes(input: { name: string; context: string; materials: string; outline: string; lesson: string; /** What this pass should cover and how much (appended to the system prompt). */ instruction?: string }, env: WorkerEnv): Promise<NotePlan> {
	const out = await runSubmitAgent<{ blocks: any[]; summary?: string }>({
		role: "extractor", toolName: "submit_blocks", toolDescription: "Submit the note blocks to add.", parameters: noteSchema,
		fill: (i) => ({ blocks: i.blocks ?? [], summary: i.summary }), systemPrompt: input.instruction ? `${NOTE_PROMPT}
${input.instruction}` : NOTE_PROMPT,
		prompt: `Topic: ${input.name}\n\n# Context\n${input.context || "(none)"}\n\n# Material\n${input.materials || "(none)"}\n\n# Notes so far\n${input.outline}\n\n# The lesson so far\n${input.lesson || "(no lesson yet — write notes from the material)"}`,
		engine: env.engine, signal: env.signal, chatId: env.chatId, onStep: (usage, model) => env.onUsage?.(usage, model), neverSubmitted: "The note-taker did not submit.",
		validate: (v) => (v.blocks.length ? null : "Submit at least one block."),
	});
	const blocks: PlannedBlock[] = out.blocks.flatMap((b): PlannedBlock[] => {
		const t = b.type;
		if (t === "math") return b.latex ? [{ block: { type: "math", latex: b.latex, text: b.text } }] : [];
		if (t === "diagram") return [{ block: { type: "diagram", title: b.title, diagram: diagramFromFlat(b) } }];
		if (t === "figure") return b.materialId && b.page ? [{ block: { type: "figure", materialId: b.materialId, page: b.page, aspect: 0.75, caption: b.caption }, focus: b.focus }] : [];
		if (t === "bullets") return b.items?.length ? [{ block: { type: "bullets", items: b.items } }] : [];
		if (t === "steps") return b.steps?.length ? [{ block: { type: "steps", title: b.title, steps: b.steps } }] : [];
		if (t === "box") return b.text ? [{ block: { type: "box", kind: b.kind ?? "idea", title: b.title, text: b.text } }] : [];
		return b.text ? [{ block: { type: t, text: b.text } as Block }] : [];
	});
	return { blocks, summary: out.summary ?? `Notes on ${input.name}` };
}

// ── chat titles ─────────────────────────────────────────────────────────────────────────────────────────────────

const TITLE_PROMPT = `You name chats the way ChatGPT does. Given the start of a study chat (what the learner sent, any files they attached, and the tutor's first reply), write a short title that says what the chat is ABOUT.
Rules: 3 to 7 words; name the actual subject matter (the concepts, the lecture topic), never the act of chatting ("Notes for today", "Help me", "Question"); Title Case or sentence case, no quotes, no trailing period, no emoji.
Examples: "Virtual Memory and Page Replacement", "TCP Congestion Control Basics", "Condition Variables vs Locks".`;
const titleSchema = Type.Object({ title: Type.String() });

/** A descriptive title for a chat from its opening exchange. Returns "" when no model is available. */
export async function titleChat(input: { opening: string; reply: string; files: readonly string[]; place: string }, env: WorkerEnv): Promise<string> {
	const out = await runSubmitAgent<{ title: string }>({
		role: "extractor", toolName: "submit_title", toolDescription: "Submit the chat title.", parameters: titleSchema,
		fill: (i) => ({ title: String(i.title ?? "") }), systemPrompt: TITLE_PROMPT,
		prompt: `Where it lives: ${input.place}\nFiles attached: ${input.files.join(", ") || "none"}\n\nLearner: ${input.opening.slice(0, 1200)}\n\nTutor: ${input.reply.slice(0, 1500)}`,
		engine: env.engine, signal: env.signal, chatId: env.chatId, onStep: (usage, model) => env.onUsage?.(usage, model), neverSubmitted: "The titler did not submit.",
		validate: (v) => (v.title.trim() ? null : "Submit a title."),
	});
	return out.title.replace(/["“”]/g, "").replace(/\s+/g, " ").trim().replace(/[.。]+$/, "").slice(0, 72);
}

// ── topics and ideas from a file ────────────────────────────────────────────────────────────────────────────────

const TOPICS_PROMPT = `You organise a learner's course material into TOPICS and IDEAS. You get an outline of one file (every page's headings and opening words) and the subject's existing topics.
A TOPIC is a unit a course would teach as a whole and a learner would name a folder after: "Dynamic programming", "Virtual memory", "TCP congestion control". It is never a sub-technique, a single definition or a slide title: memoization and tabulation are IDEAS inside "Dynamic programming", not topics.
Rules:
- Submit 1 topic, or 2 only when the file clearly has two major, separate parts (e.g. a deck that covers paging AND concurrency). Never more than 2. Prefer fewer, broader topics.
- When an existing topic fits, use it (give its id) instead of inventing a near-duplicate.
- Each topic: name (2–4 words), the PDF page range it spans (from/to), a 2–3 sentence summary of what it teaches, and 3–8 ideas: the key concepts, techniques, results or algorithms it covers, each with a one-line meaning and the pages where it appears (e.g. "12-15").
- Name things the way the material does. Never invent content that is not in the outline.`;
const topicsSchema = Type.Object({
	topics: Type.Array(Type.Object({
		name: Type.String(),
		existingTopicId: Type.Optional(Type.String()),
		from: Type.Integer({ minimum: 1 }),
		to: Type.Integer({ minimum: 1 }),
		summary: Type.String(),
		ideas: Type.Array(Type.Object({ name: Type.String(), summary: Type.String(), pages: Type.Optional(Type.String()) })),
	})),
});

export interface TopicProposal { name: string; existingTopicId?: string; from: number; to: number; summary: string; ideas: Array<{ name: string; summary: string; pages?: string }> }

/** Propose the 1–2 broad topics a file covers, with their key ideas. `intoTopic` = the file already belongs to that topic: just its ideas. */
export async function suggestTopics(input: { fileName: string; pageCount: number; outline: string; existing: ReadonlyArray<{ id: string; name: string; context: string }>; intoTopic?: string }, env: WorkerEnv): Promise<TopicProposal[]> {
	const existing = input.existing.length ? input.existing.map((t) => `- ${t.name} [id ${t.id}]${t.context ? `: ${t.context.slice(0, 200).replace(/\s+/g, " ")}` : ""}`).join("\n") : "(none yet)";
	const task = input.intoTopic
		? `This file was added to the topic "${input.intoTopic}". Submit exactly ONE topic with that name, its page range and the ideas this file contributes to it.`
		: "Submit the 1–2 topics this file covers.";
	const out = await runSubmitAgent<{ topics: TopicProposal[] }>({
		role: "extractor", toolName: "submit_topics", toolDescription: "Submit the topics and their ideas.", parameters: topicsSchema,
		fill: (i) => ({ topics: i.topics ?? [] }), systemPrompt: TOPICS_PROMPT,
		prompt: `File: ${input.fileName} (${input.pageCount} pages)\n\nExisting topics in this subject:\n${existing}\n\n${task}\n\nOutline:\n${input.outline}`,
		engine: env.engine, signal: env.signal, chatId: env.chatId, onStep: (usage, model) => env.onUsage?.(usage, model), neverSubmitted: "The topic finder did not submit.",
		validate: (v) => (!v.topics.length ? "Submit at least one topic." : v.topics.length > 2 ? "At most 2 topics: merge them into broader ones." : v.topics.some((t) => !t.ideas.length) ? "Give every topic its ideas." : null),
	});
	return out.topics.slice(0, input.intoTopic ? 1 : 2);
}

const IDEAS_PROMPT = `You keep the list of key IDEAS of a study topic. Given the ideas already listed and a recent exchange from a tutoring chat, submit the ideas this exchange actually worked on (at most 4): reuse an existing idea's exact name when it is the same idea; add a new one only for a genuinely new concept, technique or result (not a sub-detail, not a question). Each with a one-line meaning. Submit none if the exchange was small talk or logistics.`;
const ideasSchema = Type.Object({ ideas: Type.Array(Type.Object({ name: Type.String(), summary: Type.String() })) });

export async function keepIdeas(input: { scopeName: string; existing: ReadonlyArray<{ name: string; summary: string }>; exchange: string }, env: WorkerEnv): Promise<Array<{ name: string; summary: string }>> {
	const out = await runSubmitAgent<{ ideas: Array<{ name: string; summary: string }> }>({
		role: "extractor", toolName: "submit_ideas", toolDescription: "Submit the ideas this exchange worked on.", parameters: ideasSchema,
		fill: (i) => ({ ideas: i.ideas ?? [] }), systemPrompt: IDEAS_PROMPT,
		prompt: `Topic: ${input.scopeName}\n\nIdeas already listed:\n${input.existing.map((i) => `- ${i.name}: ${i.summary}`).join("\n") || "(none)"}\n\nExchange:\n${input.exchange.slice(-4000)}`,
		engine: env.engine, signal: env.signal, chatId: env.chatId, onStep: (usage, model) => env.onUsage?.(usage, model), neverSubmitted: "The idea keeper did not submit.",
	});
	return out.ideas.slice(0, 4);
}

// ── a subject's broad field (places related subjects near each other in the 3D graph) ───────────────────────────

const FIELD_PROMPT = `You file a school or university subject under ONE broad field. Answer with the field whose subjects it is most related to.`;

export async function fieldOf(subject: string, fields: readonly string[], env: WorkerEnv): Promise<string> {
	const schema = Type.Object({ field: Type.Union(fields.map((f) => Type.Literal(f))) });
	const out = await runSubmitAgent<{ field: string }>({
		role: "extractor", toolName: "submit_field", toolDescription: "Submit the field.", parameters: schema,
		fill: (i) => ({ field: String(i.field ?? "") }), systemPrompt: FIELD_PROMPT,
		prompt: `Subject: ${subject}
Fields: ${fields.join(", ")}`,
		engine: env.engine, signal: env.signal, chatId: env.chatId, onStep: (usage, model) => env.onUsage?.(usage, model), neverSubmitted: "The field classifier did not submit.",
	});
	return out.field;
}
