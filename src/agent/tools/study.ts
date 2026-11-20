/**
 * Study tools (Phase D). Core tools the chat agent gets when its chat lives in a subject or topic:
 *   study_context        search the material memory (contents / summaries / stored page text), or fetch stored pages
 *   study_material       read page ranges with the vision reader (once; remembered), optionally list materials
 *   show_figure          crop a figure/formula/table from a page into chat as an image card
 *   study_cards          add / edit / remove / list flashcards
 *   study_practice_next  the next flashcard to practise (due / progressive / all)
 *   study_practice_rate  record the learner's rating of the card just practised
 * The server supplies the ports (library, memory, vision reads, card storage); this file stays free of server imports.
 */
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute, type ImageFileResult } from "../tool-execute.ts";
import { addCards, editCard, groupSummaries, rateCard, removeCard, studyQueue, type Card, type CardSet, type StudyMode } from "../../core/study/cards.ts";
import { visibleMaterials } from "../../core/study/doctrine.ts";
import { diagramFromFlat } from "../../core/study/diagram.ts";
import { figureRegion, type FigureRegion } from "../../core/study/figures.ts";
import type { ShowFigureDetails } from "../../core/contracts.ts";
import type { ChatPlacement, Library } from "../../core/study/model.ts";
import { parseRange } from "../../core/study/material-memory.ts";
import type { TextRun } from "../../core/study/text-boxes.ts";

export interface StudyToolPorts {
	library(): Library;
	placement(): ChatPlacement;
	/** Memory lookup, formatted for the model (never a whole document). */
	lookup(materialId: string, input: { query?: string; pages?: number[] }): Promise<string>;
	/** Vision-read pages not yet read; returns a short account of what was added. */
	read(materialId: string, pages: number[]): Promise<string>;
	/** Text positions on one page (page fractions), for locating a quoted figure. */
	pageTextRuns(sha256: string, page: number): Promise<TextRun[]>;
	/** Crop a page region at crop resolution and save it as this chat's image snapshot. */
	figure(input: { sha256: string; page: number; region: FigureRegion }): Promise<{ data: string; mimeType: "image/png"; width: number; height: number; snapshotId: string }>;
	/** Every card set in this chat's reach (the topic's, or the subject's and all its topics'), keyed by owner id. */
	cards(): Array<{ key: string; group: string; set: CardSet }>;
	saveCards(key: string, set: CardSet): void;
	/** Where agent-added cards go (topic if the chat has one, else the subject). */
	ownCardKey(): { key: string; group: string };
	/** Notes (Phase E): place blocks, edit an element, or read the outline. */
	notes: {
		outline(): string;
		add(blocks: Array<{ block: import("../../core/study/notes.ts").Block; focus?: string }>, summary: string): Promise<string>;
		edit(id: string, patch: { text?: string; items?: string[]; caption?: string }): Promise<string>;
	};
	/** Plain-chat note export: write Markdown as a text material in the chat's placement. */
	saveChatNotes?: (title: string, markdown: string) => Promise<{
		id: string;
		title: string;
		subjectId: string;
		topicId?: string;
		subjectName: string;
		topicName?: string;
	}>;
	now?(): number;
}

const MAX_PAGES_PER_CALL = 24;

export function studyTools(ports: StudyToolPorts, mode: "teach" | "plain" = "teach"): Record<string, AgentTool<any>> {
	const now = () => ports.now?.() ?? Date.now();
	const material = (id: unknown) => {
		const list = visibleMaterials(ports.library(), ports.placement());
		if (list.length === 1 && !id) return list[0]!;
		const found = list.find((m) => m.id === id || m.fileName === id);
		if (!found) throw new Error(list.length ? `Unknown material. Use one of: ${list.map((m) => `${m.fileName} (id ${m.id})`).join("; ")}.` : "No material has been uploaded to this subject or topic yet.");
		return found;
	};
	const find = (cardId: string) => {
		for (const entry of ports.cards()) { const card = entry.set.cards.find((c) => c.id === cardId); if (card) return { entry, card }; }
		throw new Error("That card no longer exists.");
	};
	const show = (c: Card) => `[${c.id}] (${c.group}) Q: ${c.q}\n    A: ${c.a}`;

	const ContextSchema = Type.Object({
		material: Type.Optional(Type.String({ description: "Material id or file name. Optional when there is only one." })),
		query: Type.Optional(Type.String({ description: "What to look for, in a few words (a heading, concept, exercise). Omit for an overview." })),
		pages: Type.Optional(Type.String({ description: "Stored page text for these pages, e.g. '12-14, 20'. Only pages already read are stored." })),
	});
	const MaterialSchema = Type.Object({
		material: Type.Optional(Type.String({ description: "Material id or file name. Optional when there is only one." })),
		pages: Type.String({ description: "Pages to read with the vision reader, e.g. '1-12' or '30, 31'. Pages already read are skipped. For a long document read the first ~20 pages (contents, overview) before anything else." }),
	});
	const CardsSchema = Type.Object({
		action: Type.Union([Type.Literal("add"), Type.Literal("edit"), Type.Literal("remove"), Type.Literal("list")]),
		cards: Type.Optional(Type.Array(Type.Object({ q: Type.String(), a: Type.String(), page: Type.Optional(Type.Integer({ minimum: 1 })) }), { description: "For add: the new cards." })),
		id: Type.Optional(Type.String({ description: "For edit/remove: the card id." })),
		q: Type.Optional(Type.String()),
		a: Type.Optional(Type.String()),
	});
	const NotesSchema = Type.Object({
		action: Type.Union([Type.Literal("add"), Type.Literal("edit"), Type.Literal("outline")]),
		summary: Type.Optional(Type.String({ description: "One short line: what this addition covers." })),
		blocks: Type.Optional(Type.Array(Type.Object({
			type: Type.Union([Type.Literal("heading"), Type.Literal("text"), Type.Literal("bullets"), Type.Literal("box"), Type.Literal("sticky"), Type.Literal("steps"), Type.Literal("figure"), Type.Literal("diagram"), Type.Literal("math")]),
			latex: Type.Optional(Type.String({ description: "math: the equation in LaTeX, without $ signs" })),
			diagramKind: Type.Optional(Type.Union([Type.Literal("flow"), Type.Literal("mind")])),
			nodes: Type.Optional(Type.Array(Type.Object({ id: Type.String(), text: Type.String(), decision: Type.Optional(Type.Boolean()) }))),
			edges: Type.Optional(Type.Array(Type.Object({ from: Type.String(), to: Type.String(), label: Type.Optional(Type.String()) }))),
			center: Type.Optional(Type.String()),
			branches: Type.Optional(Type.Array(Type.Object({ text: Type.String(), children: Type.Optional(Type.Array(Type.String())) }))),
			text: Type.Optional(Type.String()), items: Type.Optional(Type.Array(Type.String())), steps: Type.Optional(Type.Array(Type.String())),
			kind: Type.Optional(Type.String({ description: "box: definition | exam | revisit | mistake | idea" })), title: Type.Optional(Type.String()),
			material: Type.Optional(Type.String({ description: "figure: material id or file name" })), page: Type.Optional(Type.Integer({ minimum: 1 })),
			focus: Type.Optional(Type.String({ description: "figure: ONLY when the learner struggled with something on this page — what they found hard; those words get circled or pointed at. Leave it out for an ordinary screenshot (most figures)." })), caption: Type.Optional(Type.String()),
		}))),
		id: Type.Optional(Type.String({ description: "edit: the element id from the outline" })), text: Type.Optional(Type.String()), items: Type.Optional(Type.Array(Type.String())),
	});
	const NextSchema = Type.Object({
		mode: Type.Union([Type.Literal("due"), Type.Literal("progressive"), Type.Literal("all")], { description: "due = spaced-repetition due cards; progressive = weakest topic first, one topic at a time; all = everything, weakest first." }),
		topics: Type.Optional(Type.Array(Type.String(), { description: "Limit to these topic names." })),
	});
	const RateSchema = Type.Object({ id: Type.String(), rating: Type.Integer({ minimum: 1, maximum: 4, description: "1 again, 2 hard, 3 good, 4 easy" }) });
	const SaveNotesSchema = Type.Object({
		title: Type.String({ minLength: 1, description: "Short title for the saved notes (also the material file name)." }),
		markdown: Type.String({ minLength: 1, description: "The complete notes in Markdown." }),
	});
	const FigureSchema = Type.Object({
		materialId: Type.String({ minLength: 1, description: "The uploaded file's id or file name." }),
		page: Type.Integer({ minimum: 1, description: "The 1-based page number in that file." }),
		quote: Type.Optional(Type.String({ description: "A few words next to the figure, formula or table, to locate it on the page." })),
		box: Type.Optional(Type.Object({
			x: Type.Number({ minimum: 0, maximum: 1 }), y: Type.Number({ minimum: 0, maximum: 1 }),
			w: Type.Number({ minimum: 0, maximum: 1 }), h: Type.Number({ minimum: 0, maximum: 1 }),
		}, { description: "Exact region in fractions of the page (0–1), when you know where the figure is. Takes precedence over quote." })),
		caption: Type.String({ minLength: 1, description: "One short line shown under the image." }),
	});

	const tools: Record<string, AgentTool<any>> = {
		study_context: {
			name: "study_context",
			label: "study_context",
			description: "Look something up in the uploaded material's memory without re-reading it: contents entries (with the pages around them), page-range summaries and stored page text. Use it before study_material. With no query it gives an overview of what is read.",
			parameters: ContextSchema,
			execute: serverExecute("study_context", ContextSchema, async (input) => {
				const m = material(input.material);
				const pages = input.pages ? parseRange(input.pages, m.pageCount).slice(0, MAX_PAGES_PER_CALL) : undefined;
				return { text: await ports.lookup(m.id, { query: input.query, pages }) };
			}),
		},
		study_material: {
			name: "study_material",
			label: "study_material",
			description: "Read pages of an uploaded material that have not been read yet (a vision model looks at them once and the result is remembered; do not ask for pages you already have). Up to 24 pages per call. Use study_context first to find where to look.",
			parameters: MaterialSchema,
			execute: serverExecute("study_material", MaterialSchema, async (input) => {
				const m = material(input.material);
				const pages = parseRange(input.pages, m.pageCount).slice(0, MAX_PAGES_PER_CALL);
				if (!pages.length) throw new Error(`${m.fileName} has ${m.pageCount} pages.`);
				return { text: await ports.read(m.id, pages) };
			}),
		},
		show_figure: {
			name: "show_figure",
			label: "show_figure",
			description: "Show a cropped region of a lecture PDF page in chat as an image card — a diagram, figure, formula or table from the learner's files, not a whole page of text. Read the page first with study_material. Prefer `box` when you know where the figure sits (fractions of the page, 0–1); otherwise give a short `quote` from beside it and its position is found in the PDF's own text layout. Never show a whole page just to show text; the whole page is used only when no region can be found. You receive the crop back as an image so you can teach from it.",
			parameters: FigureSchema,
			execute: serverExecute("show_figure", FigureSchema, async (input): Promise<ImageFileResult> => {
				const m = material(input.materialId);
				if (m.kind === "text") throw new Error("text files have no pages to crop");
				if (input.page > m.pageCount) throw new Error(`${m.fileName} has only ${m.pageCount} pages.`);
				const runs = await ports.pageTextRuns(m.sha256, input.page);
				const region = figureRegion(runs, { quote: input.quote, box: input.box });
				const crop = await ports.figure({ sha256: m.sha256, page: input.page, region });
				const caption = input.caption.trim();
				const details: ShowFigureDetails = {
					materialId: m.id,
					fileName: m.fileName,
					subjectId: ports.placement().subjectId,
					page: input.page,
					caption,
					mimeType: "image/png",
					snapshotId: crop.snapshotId,
					width: crop.width,
					height: crop.height,
					...(region.wholePage ? { wholePage: true } : {}),
				};
				return { text: `Shown: ${caption} (${m.fileName}, p. ${input.page})`, images: [{ data: crop.data, mimeType: crop.mimeType }], details };
			}),
		},
		study_notes: {
			name: "study_notes",
			label: "study_notes",
			description: "Write the learner's class notes as you teach, like a student's iPad notes: short headings, bullets, margin stickies, boxes (definition / exam / revisit / mistake), worked steps from this lesson, diagram blocks (flowcharts and mind maps drawn from the content you give), math blocks for key equations (all maths in LaTeX: $...$ inline in any text), and figure blocks that screenshot a page of the material (give page and focus; it is marked up with circles and arrows for you). Add after each part is taught, not before. Notes are never deleted: use edit to change wording, outline to see what is there first.",
			parameters: NotesSchema,
			execute: serverExecute("study_notes", NotesSchema, async (input) => {
				if (input.action === "outline") return { text: ports.notes.outline() };
				if (input.action === "edit") {
					if (!input.id) throw new Error("Give the element id from the outline.");
					return { text: await ports.notes.edit(input.id, { text: input.text, items: input.items }) };
				}
				const planned = (input.blocks ?? []).flatMap((b): Array<{ block: import("../../core/study/notes.ts").Block; focus?: string }> => {
					if (b.type === "figure") { const m = material(b.material); return b.page ? [{ block: { type: "figure", materialId: m.id, page: b.page, aspect: 0.75, caption: b.caption }, focus: b.focus }] : []; }
					if (b.type === "math") return b.latex ? [{ block: { type: "math", latex: b.latex, text: b.text } }] : [];
					if (b.type === "diagram") return [{ block: { type: "diagram", title: b.title, diagram: diagramFromFlat(b) } }];
					if (b.type === "bullets") return [{ block: { type: "bullets", items: b.items ?? [] } }];
					if (b.type === "steps") return [{ block: { type: "steps", title: b.title, steps: b.steps ?? b.items ?? [] } }];
					if (b.type === "box") return [{ block: { type: "box", kind: (b.kind ?? "idea") as never, title: b.title, text: b.text ?? "" } }];
					return [{ block: { type: b.type, text: b.text ?? "" } as never }];
				});
				return { text: await ports.notes.add(planned, input.summary ?? "Notes from the lesson") };
			}),
		},
		save_chat_notes: {
			name: "save_chat_notes",
			label: "save_chat_notes",
			description: "Save the chat's notes as a Markdown text material in this chat's subject/topic. Call this when the learner asks to write up and save the conversation's notes. Returns the material id and the saved scope.",
			parameters: SaveNotesSchema,
			execute: serverExecute("save_chat_notes", SaveNotesSchema, async (input) => {
				if (!ports.saveChatNotes) throw new Error("Saving chat notes is not available in this chat.");
				const saved = await ports.saveChatNotes(input.title.trim(), input.markdown);
				const scope = [saved.subjectName, saved.topicName].filter(Boolean).join(" › ");
				return { text: `Saved to ${scope}: ${saved.title}.`, details: { tool: "save_chat_notes", saved: true, ...saved } };
			}),
		},
		study_cards: {
			name: "study_cards",
			label: "study_cards",
			description: "The learner's flashcards for this topic. add: one idea per card, short question and answer (duplicates are skipped). edit/remove by id. list shows what exists.",
			parameters: CardsSchema,
			execute: serverExecute("study_cards", CardsSchema, async (input) => {
				if (input.action === "list") {
					const all = ports.cards().flatMap((e) => e.set.cards);
					return { text: all.length ? all.slice(0, 60).map(show).join("\n") + (all.length > 60 ? `\n… ${all.length - 60} more` : "") : "No cards yet." };
				}
				if (input.action === "add") {
					const own = ports.ownCardKey();
					const entry = ports.cards().find((e) => e.key === own.key);
					const result = addCards(entry?.set ?? { version: 1, cards: [] }, (input.cards ?? []).map((c) => ({ q: c.q, a: c.a, group: own.group, source: c.page ? { page: c.page } : undefined })), "agent", now());
					ports.saveCards(own.key, result.set);
					return { text: `Added ${result.added.length} card${result.added.length === 1 ? "" : "s"}${result.skipped ? ` (${result.skipped} already existed)` : ""}.` };
				}
				if (!input.id) throw new Error("Give the card id.");
				const { entry } = find(input.id);
				if (input.action === "remove") { ports.saveCards(entry.key, removeCard(entry.set, input.id)); return { text: "Removed." }; }
				ports.saveCards(entry.key, editCard(entry.set, input.id, { q: input.q, a: input.a }, now()));
				return { text: "Updated." };
			}),
		},
		study_practice_next: {
			name: "study_practice_next",
			label: "study_practice_next",
			description: "The next flashcard to practise. Ask its question, let the learner answer, judge honestly, then call study_practice_rate. Returns what is left and, for progressive mode, the topic order.",
			parameters: NextSchema,
			execute: serverExecute("study_practice_next", NextSchema, async (input) => {
				const cards = ports.cards().flatMap((e) => e.set.cards);
				const queue = studyQueue(cards, { mode: input.mode as StudyMode, groups: input.topics }, now());
				if (!queue.cards.length) {
					const sums = groupSummaries(cards, now());
					return { text: cards.length ? `Nothing to practise in ${input.mode} mode right now. Cards: ${sums.map((s) => `${s.group} ${s.total} (${s.due} due)`).join(", ")}. Try mode "all", or add cards while teaching.` : "There are no cards yet. Add some with study_cards while teaching." };
				}
				const card = queue.cards[0]!;
				return { text: `Practise this card (${queue.cards.length} left${queue.group ? ` in topic "${queue.group}"` : ""}${queue.groupOrder.length > 1 ? `; next topics: ${queue.groupOrder.slice(1, 4).join(", ")}` : ""}):\n[${card.id}] Q: ${card.q}\nExpected answer (do not reveal first): ${card.a}` };
			}),
		},
		study_practice_rate: {
			name: "study_practice_rate",
			label: "study_practice_rate",
			description: "Record how recall went for the card just practised: 1 again (blank/wrong), 2 hard, 3 good, 4 easy. Rate honestly from the learner's answer; this schedules the next review.",
			parameters: RateSchema,
			execute: serverExecute("study_practice_rate", RateSchema, async (input) => {
				const { entry } = find(input.id);
				const result = rateCard(entry.set, input.id, input.rating, now());
				ports.saveCards(entry.key, result.set);
				const due = new Date(result.card.schedule.due);
				return { text: `Rated ${input.rating}. Next review ${due.toISOString().slice(0, 16).replace("T", " ")}.` };
			}),
		},
	};
	if (mode === "plain") {
		const plainNames = ["study_context", "study_material", "show_figure", "study_notes", "save_chat_notes"] as const;
		return Object.fromEntries(plainNames.map(name => [name, tools[name]!])) as Record<string, AgentTool<any>>;
	}
	// Teaching/practice chats keep their study tools; note export is only
	// part of the plain study-chat registry.
	const { save_chat_notes: _saveChatNotes, ...teaching } = tools;
	return teaching;
}
