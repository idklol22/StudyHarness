/**
 * Study agent glue (Phase D): everything the chat handler needs to give a placed chat its Study abilities.
 *  - studyContributions(): instructions (placement, layered context, materials, start-mode doctrine) + tools
 *  - keepContextAfterTurn(): throttled, non-blocking refresh of the topic/subject context documents
 * Model engines are passed in (`engineFor`), so this module never reads settings itself.
 */
import type { Usage } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ModelRole } from "../../config.ts";
import type { PiEngine } from "../agent/models.ts";
import { keepContext, readPages, type WorkerEnv } from "../agent/subagents/study-workers.ts";
import { studyTools } from "../agent/tools/study.ts";
import { emptyCards, type CardSet } from "../core/study/cards.ts";
import { studyInstructions, visibleMaterials, STUDY_TOOL_NAMES } from "../core/study/doctrine.ts";
import { formatLookup, recordBatch, unread } from "../core/study/material-memory.ts";
import { topicOf, topicsOf, subjectOf, type ChatPlacement } from "../core/study/model.ts";
import { studyStore } from "../store/study.ts";
import { study } from "./study-runtime.ts";
import { addBlocks, editNote, readNotebook } from "./study-notes.ts";
import { notebookOutline } from "../core/study/notes.ts";

export interface StudyDeps {
	engineFor: (role: ModelRole) => PiEngine | undefined;
	onUsage?: (usage: Usage) => void;
	signal?: AbortSignal;
}

const READ_BATCH = 6;
const cardsOf = (key: string): CardSet => studyStore.readDoc<CardSet>("cards", key, emptyCards());

const worker = (deps: StudyDeps, role: ModelRole, chatId: string): WorkerEnv => ({ engine: deps.engineFor(role), signal: deps.signal, chatId, onUsage: (usage) => deps.onUsage?.(usage) });

/** Fold a short update into the context document of the scope a material (or chat) belongs to. */
async function refreshContext(target: { subjectId: string; topicId?: string }, update: string, deps: StudyDeps, chatId: string): Promise<void> {
	const lib = study.library();
	const topic = target.topicId ? topicOf(lib, target.topicId) : undefined;
	const subject = subjectOf(lib, target.subjectId);
	if (!subject || (target.topicId && !topic)) return;
	const level = topic ? "topic" : "subject";
	const current = (topic ?? subject).context;
	const next = await keepContext({ name: (topic ?? subject).name, level, current, update }, worker(deps, "extractor", chatId));
	study.setContext(target, next);
}

export function studyContributions(chatId: string, placement: ChatPlacement, kind: "teach" | "practice", deps: StudyDeps): { instructions: string[]; tools: AgentTool<any>[] } | undefined {
	const lib = study.library();
	if (!subjectOf(lib, placement.subjectId)) return undefined;
	const readState = (id: string) => {
		const m = lib.materials.find((x) => x.id === id);
		if (!m) return "";
		const read = studyStore.readMemory(m.sha256).read.length;
		return read ? `read ${read} of ${m.pageCount} pages` : "not read yet";
	};
	const instructions = studyInstructions({ library: lib, placement, kind, readState });

	const ownKey = () => {
		const topic = placement.topicId ? topicOf(study.library(), placement.topicId) : undefined;
		return topic ? { key: topic.id, group: topic.name } : { key: placement.subjectId, group: "General" };
	};
	const tools = studyTools({
		library: () => study.library(),
		placement: () => placement,
		async lookup(materialId, input) {
			const m = visibleMaterials(study.library(), placement).find((x) => x.id === materialId);
			if (!m) throw new Error("That file is no longer in this subject.");
			const { result } = await study.lookupPages(m.sha256, input);
			return formatLookup(m.fileName, result);
		},
		async read(materialId, pages) {
			const m = visibleMaterials(study.library(), placement).find((x) => x.id === materialId);
			if (!m) throw new Error("That file is no longer in this subject.");
			let memory = studyStore.readMemory(m.sha256);
			const todo = unread(memory, pages);
			if (!todo.length) return `Pages ${pages.join(", ")} are already read — use study_context to see them.`;
			const summaries: string[] = [];
			for (let i = 0; i < todo.length; i += READ_BATCH) {
				const batch = todo.slice(i, i + READ_BATCH);
				const images = await Promise.all(batch.map(async (page) => { const img = await study.pageImage(m.sha256, page); return { page, data: Buffer.from(img.bytes).toString("base64"), mimeType: img.mimeType }; }));
				const read = await readPages(images, `${m.fileName}${placement.topicId ? "" : ""}`, worker(deps, "pdfReader", chatId));
				memory = recordBatch(studyStore.readMemory(m.sha256), { pages: read.pages, summary: read.summary, concepts: read.concepts, toc: read.toc, figures: read.figures });
				studyStore.writeMemory(m.sha256, memory);
				summaries.push(`pages ${batch[0]}–${batch.at(-1)}: ${read.summary}`);
			}
			// The scope that owns the material learns what it now contains (non-blocking for the learner's turn).
			void refreshContext(m.scope, `Read ${m.fileName}.\n${summaries.join("\n")}`, deps, chatId).catch((e) => console.error("[study] context refresh failed:", e));
			return `Read ${todo.length} page${todo.length === 1 ? "" : "s"} of ${m.fileName} and remembered them.\n${summaries.join("\n")}`;
		},
		cards() {
			const lib2 = study.library();
			const topic = placement.topicId ? topicOf(lib2, placement.topicId) : undefined;
			if (topic) return [{ key: topic.id, group: topic.name, set: cardsOf(topic.id) }];
			return [
				{ key: placement.subjectId, group: "General", set: cardsOf(placement.subjectId) },
				...topicsOf(lib2, placement.subjectId).map((t) => ({ key: t.id, group: t.name, set: cardsOf(t.id) })),
			].map((e) => ({ ...e, set: { ...e.set, cards: e.set.cards.map((c) => ({ ...c, group: e.group })) } }));
		},
		saveCards: (key, set) => studyStore.writeDoc("cards", key, set),
		notes: {
			outline: () => notebookOutline(readNotebook(placement)),
			async add(planned, summary) { const book = await addBlocks(placement, planned, summary, deps); return `Added ${planned.length} block${planned.length === 1 ? "" : "s"} (notes now ${book.pages.length} page${book.pages.length === 1 ? "" : "s"}).`; },
			async edit(id, patch) { await editNote(placement, id, patch); return "Updated."; },
		},
		ownCardKey: ownKey,
	});
	return { instructions: [instructions], tools: Object.values(tools) };
}

const lastKept = new Map<string, { at: number; turns: number }>();
const KEEP_EVERY_MS = 3 * 60_000;
const KEEP_EVERY_TURNS = 4;

/** After a turn: refresh the chat's topic/subject context with the latest exchange, at most every few minutes. Never throws. */
export function keepContextAfterTurn(chatId: string, placement: ChatPlacement | undefined, exchange: string, deps: StudyDeps, now = Date.now()): void {
	if (!placement || !exchange.trim()) return;
	const seen = lastKept.get(chatId) ?? { at: 0, turns: 0 };
	seen.turns++;
	if (now - seen.at < KEEP_EVERY_MS && seen.turns < KEEP_EVERY_TURNS) { lastKept.set(chatId, seen); return; }
	lastKept.set(chatId, { at: now, turns: 0 });
	void refreshContext(placement, `Recent exchange in a tutoring chat:\n${exchange.slice(-3500)}`, deps, chatId).catch((e) => console.error("[study] context refresh failed:", e));
}

export { STUDY_TOOL_NAMES };
