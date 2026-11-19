/**
 * Study tools (Phase D). Core tools the chat agent gets when its chat lives in a subject or topic:
 *   study_context        search the material memory (contents / summaries / stored page text), or fetch stored pages
 *   study_material       read page ranges with the vision reader (once; remembered), optionally list materials
 *   study_cards          add / edit / remove / list flashcards
 *   study_practice_next  the next flashcard to practise (due / progressive / all)
 *   study_practice_rate  record the learner's rating of the card just practised
 * The server supplies the ports (library, memory, vision reads, card storage); this file stays free of server imports.
 */
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import { addCards, editCard, groupSummaries, rateCard, removeCard, studyQueue, type Card, type CardSet, type StudyMode } from "../../core/study/cards.ts";
import { visibleMaterials } from "../../core/study/doctrine.ts";
import type { ChatPlacement, Library } from "../../core/study/model.ts";
import { parseRange } from "../../core/study/material-memory.ts";

export interface StudyToolPorts {
	library(): Library;
	placement(): ChatPlacement;
	/** Memory lookup, formatted for the model (never a whole document). */
	lookup(materialId: string, input: { query?: string; pages?: number[] }): Promise<string>;
	/** Vision-read pages not yet read; returns a short account of what was added. */
	read(materialId: string, pages: number[]): Promise<string>;
	/** Every card set in this chat's reach (the topic's, or the subject's and all its topics'), keyed by owner id. */
	cards(): Array<{ key: string; group: string; set: CardSet }>;
	saveCards(key: string, set: CardSet): void;
	/** Where agent-added cards go (topic if the chat has one, else the subject). */
	ownCardKey(): { key: string; group: string };
	now?(): number;
}

const MAX_PAGES_PER_CALL = 24;

export function studyTools(ports: StudyToolPorts): Record<string, AgentTool<any>> {
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
	const NextSchema = Type.Object({
		mode: Type.Union([Type.Literal("due"), Type.Literal("progressive"), Type.Literal("all")], { description: "due = spaced-repetition due cards; progressive = weakest topic first, one topic at a time; all = everything, weakest first." }),
		topics: Type.Optional(Type.Array(Type.String(), { description: "Limit to these topic names." })),
	});
	const RateSchema = Type.Object({ id: Type.String(), rating: Type.Integer({ minimum: 1, maximum: 4, description: "1 again, 2 hard, 3 good, 4 easy" }) });

	return {
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
}
