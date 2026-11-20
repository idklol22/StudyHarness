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
import { keepIdeas, type WorkerEnv } from "../agent/subagents/study-workers.ts";
import { ideasOf } from "../core/study/ideas.ts";
import { studyTools } from "../agent/tools/study.ts";
import { emptyCards, type CardSet } from "../core/study/cards.ts";
import { studyInstructions, visibleMaterials, STUDY_TOOL_NAMES } from "../core/study/doctrine.ts";
import { formatLookup } from "../core/study/material-memory.ts";
import { topicOf, topicsOf, subjectOf, type ChatPlacement } from "../core/study/model.ts";
import { sha256Of, studyStore } from "../store/study.ts";
import { chatStore } from "../store/chats.ts";
import { study } from "./study-runtime.ts";
import { readMaterialPages } from "./study-reading.ts";
import { refreshContext } from "./study-context.ts";
import { addBlocks, editNote, readNotebook } from "./study-notes.ts";
import { notebookOutline } from "../core/study/notes.ts";

export interface StudyDeps {
	engineFor: (role: ModelRole) => PiEngine | undefined;
	onUsage?: (usage: Usage) => void;
	signal?: AbortSignal;
}

const cardsOf = (key: string): CardSet => studyStore.readDoc<CardSet>("cards", key, emptyCards());

const worker = (deps: StudyDeps, role: ModelRole, chatId: string): WorkerEnv => ({ engine: deps.engineFor(role), signal: deps.signal, chatId, onUsage: (usage) => deps.onUsage?.(usage) });


export function studyContributions(
	chatId: string,
	placement: ChatPlacement,
	kind: "teach" | "practice",
	deps: StudyDeps,
	mode: "teach" | "plain" = "teach",
): { instructions: string[]; tools: AgentTool<any>[] } | undefined {
	const lib = study.library();
	if (!subjectOf(lib, placement.subjectId)) return undefined;
	const readState = (id: string) => {
		const m = lib.materials.find((x) => x.id === id);
		if (!m) return "";
		const read = studyStore.readMemory(m.sha256).read.length;
		return read ? `read ${read} of ${m.pageCount} pages` : "not read yet";
	};
	const instructions = studyInstructions({ library: lib, placement, kind, mode, readState });

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
			const { count, summaries } = await readMaterialPages(m, pages, deps, chatId);
			if (!count) return `Pages ${pages.join(", ")} are already read — use study_context to see them.`;
			// The scope that owns the material learns what it now contains (non-blocking for the learner's turn).
			void refreshContext(m.scope, `Read ${m.fileName}.\n${summaries.join("\n")}`, deps, chatId).catch((e) => console.error("[study] context refresh failed:", e));
			return `Read ${count} page${count === 1 ? "" : "s"} of ${m.fileName} and remembered them.\n${summaries.join("\n")}`;
		},
		async pageTextRuns(sha256, page) { return study.pageTextRuns(sha256, page); },
		async figure({ sha256, page, region }) {
			const img = await study.pageFigure(sha256, page, region);
			const data = img.bytes.toString("base64");
			const snapshotId = sha256Of(img.bytes);
			chatStore.saveImageSnapshot(chatId, snapshotId, { mimeType: "image/png", data, width: img.width, height: img.height });
			return { data, mimeType: "image/png", width: img.width, height: img.height, snapshotId };
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
		async saveChatNotes(title, markdown) {
			const scope = { subjectId: placement.subjectId, ...(placement.topicId ? { topicId: placement.topicId } : {}) };
			const safeTitle = title.replace(/[\\/\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 116) || "Chat notes";
			const { material } = await study.addMaterial({
				bytes: Buffer.from(markdown, "utf8"),
				fileName: `${safeTitle}.md`,
				scope,
			});
			const fresh = study.library();
			return {
				id: material.id,
				title: safeTitle,
				subjectId: placement.subjectId,
				...(placement.topicId ? { topicId: placement.topicId } : {}),
				subjectName: subjectOf(fresh, placement.subjectId)?.name ?? "Subject",
				topicName: placement.topicId ? topicOf(fresh, placement.topicId)?.name : undefined,
			};
		},
		ownCardKey: ownKey,
	}, mode);
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
	// The ideas this exchange worked on join the topic's (or subject's) ideas, linked to this chat (the map shows them).
	void (async () => {
		const lib = study.library();
		const scope = { subjectId: placement.subjectId, ...(placement.topicId ? { topicId: placement.topicId } : {}) };
		const name = (placement.topicId ? topicOf(lib, placement.topicId)?.name : undefined) ?? subjectOf(lib, placement.subjectId)?.name;
		if (!name) return;
		const ideas = await keepIdeas({ scopeName: name, existing: ideasOf(lib, scope), exchange }, worker(deps, "extractor", chatId));
		if (ideas.length) study.addIdeas(scope, ideas.map((i) => ({ name: i.name, summary: i.summary, chat: chatId })));
	})().catch((e) => console.error("[study] ideas update failed:", e));
}

export { STUDY_TOOL_NAMES };
