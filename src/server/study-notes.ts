/**
 * Study notes service (Phase E): reads/writes a scope's notebook, turns planned blocks into placed elements
 * (screenshotting and marking figures), and generates notes for a topic or a whole subject.
 * One notebook per topic, plus one subject-wide notebook keyed by the subject id.
 */
import type { Usage } from "@earendil-works/pi-ai";
import type { ModelRole } from "../../config.ts";
import type { PiEngine } from "../agent/models.ts";
import { markFigure, planNotes, type PlannedBlock, type WorkerEnv } from "../agent/subagents/study-workers.ts";
import { visibleMaterials } from "../core/study/doctrine.ts";
import { formatLookup, lookup } from "../core/study/material-memory.ts";
import { addLearnerSticky, addStroke, appendBlocks, editElement, emptyNotebook, notebookOutline, removeLearnerSticky, undoStroke, type Block, type Mark, type Notebook, type Stroke } from "../core/study/notes.ts";
import { subjectOf, topicOf, topicsOf, type StudyScope } from "../core/study/model.ts";
import { studyStore } from "../store/study.ts";
import { study } from "./study-runtime.ts";

export interface NotesDeps {
	engineFor: (role: ModelRole) => PiEngine | undefined;
	onUsage?: (usage: Usage) => void;
	signal?: AbortSignal;
}

export const notebookKey = (scope: StudyScope): string => scope.topicId ?? scope.subjectId;
const env = (deps: NotesDeps, role: ModelRole): WorkerEnv => ({ engine: deps.engineFor(role), signal: deps.signal, onUsage: (u) => deps.onUsage?.(u) });

export function checkedScope(scope: StudyScope): StudyScope {
	const lib = study.library();
	if (!subjectOf(lib, scope.subjectId)) throw new Error("That subject no longer exists.");
	if (scope.topicId && topicOf(lib, scope.topicId)?.subjectId !== scope.subjectId) throw new Error("That topic no longer exists.");
	return scope;
}

export const readNotebook = (scope: StudyScope): Notebook => studyStore.readDoc<Notebook>("notes", notebookKey(checkedScope(scope)), emptyNotebook());
const save = (scope: StudyScope, book: Notebook): Notebook => { studyStore.writeDoc("notes", notebookKey(scope), book); return book; };

/** Serialise writes per notebook so concurrent agent/learner changes never overwrite each other. */
const queues = new Map<string, Promise<unknown>>();
function exclusive<T>(scope: StudyScope, fn: () => Promise<T> | T): Promise<T> {
	const key = notebookKey(scope);
	const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
	queues.set(key, run);
	return run;
}

/** Place blocks: figures get their page screenshot's aspect and (when asked for) pen marks from a vision look. */
export function addBlocks(scope: StudyScope, planned: readonly PlannedBlock[], summary: string, deps: NotesDeps): Promise<Notebook> {
	checkedScope(scope);
	return exclusive(scope, async () => {
		const materials = visibleMaterials(study.library(), { ...scope, startMode: "check" });
		const blocks: Block[] = [];
		for (const { block, focus } of planned) {
			if (block.type !== "figure") { blocks.push(block); continue; }
			const m = materials.find((x) => x.id === block.materialId || x.fileName === block.materialId);
			if (!m) throw new Error(`Unknown material "${block.materialId}" for a figure.`);
			if (block.page > m.pageCount) throw new Error(`${m.fileName} has only ${m.pageCount} pages.`);
			const img = await study.pageImage(m.sha256, block.page);
			let marks: Mark[] = block.marks ?? [];
			if (!marks.length && focus) {
				try { marks = await markFigure({ page: block.page, data: Buffer.from(img.bytes).toString("base64"), mimeType: img.mimeType }, focus, env(deps, "pdfReader")); }
				catch (error) { console.error("[study] figure marking failed:", error); } // an unmarked screenshot is still a useful figure
			}
			blocks.push({ ...block, materialId: m.id, aspect: img.width / img.height, marks });
		}
		const { notebook } = appendBlocks(readNotebook(scope), blocks, summary);
		return save(scope, notebook);
	});
}

export const editNote = (scope: StudyScope, elementId: string, patch: Parameters<typeof editElement>[2]): Promise<Notebook> =>
	exclusive(scope, () => save(scope, editElement(readNotebook(scope), elementId, patch)));

/** The learner's ink: always saved through the same queue, never touching the agent's elements. */
export const learnerInk = (scope: StudyScope, op: { kind: "stroke"; pageId: string; stroke: Stroke } | { kind: "undo"; pageId: string } | { kind: "sticky"; pageId: string; x: number; y: number; text: string } | { kind: "remove-sticky"; pageId: string; id: string }): Promise<Notebook> =>
	exclusive(scope, () => {
		const book = readNotebook(scope);
		const next = op.kind === "stroke" ? addStroke(book, op.pageId, op.stroke) : op.kind === "undo" ? undoStroke(book, op.pageId) : op.kind === "sticky" ? addLearnerSticky(book, op.pageId, op) : removeLearnerSticky(book, op.pageId, op.id);
		return save(scope, next);
	});

/** What the course material holds for the notes planner: page-range summaries and figures worth showing, per file. */
function materialDigest(scope: StudyScope): string {
	const lib = study.library();
	const out: string[] = [];
	for (const m of visibleMaterials(lib, { ...scope, startMode: "check" })) {
		const memory = studyStore.readMemory(m.sha256);
		out.push(`${m.fileName} [id ${m.id}] — ${m.pageCount} pages, ${memory.read.length} read`);
		for (const c of memory.chunks) {
			out.push(`  pages ${c.from}–${c.to}: ${c.summary}${c.concepts.length ? ` [${c.concepts.join(", ")}]` : ""}`);
			for (const f of c.figures ?? []) out.push(`    figure p.${f.page}: ${f.caption}`);
		}
		if (!memory.chunks.length && memory.read.length) out.push("  " + formatLookup(m.fileName, lookup(memory)));
	}
	return out.join("\n").slice(0, 6000);
}

/** The context documents a notebook draws on: its own, and for a subject-wide notebook every topic's too. */
function contextFor(scope: StudyScope): { name: string; text: string } {
	const lib = study.library();
	const subject = subjectOf(lib, scope.subjectId)!;
	if (scope.topicId) { const t = topicOf(lib, scope.topicId)!; return { name: `${subject.name} › ${t.name}`, text: [t.context, subject.context && `Subject: ${subject.context}`].filter(Boolean).join("\n\n") }; }
	return { name: subject.name, text: [subject.context, ...topicsOf(lib, subject.id).filter((t) => t.context.trim()).map((t) => `## ${t.name}\n${t.context}`)].filter(Boolean).join("\n\n").slice(0, 8000) };
}

/** Generate (or extend) the scope's notes from its context, the material and — when given — the lesson so far. */
export function generateNotes(scope: StudyScope, lesson: string, deps: NotesDeps): Promise<{ notebook: Notebook; added: number }> {
	checkedScope(scope);
	const ctx = contextFor(scope);
	return (async () => {
		const plan = await planNotes({ name: ctx.name, context: ctx.text, materials: materialDigest(scope), outline: notebookOutline(readNotebook(scope)), lesson }, env(deps, "extractor"));
		if (!plan.blocks.length) throw new Error("There was nothing to add to the notes yet. Upload material or have a lesson first.");
		const notebook = await addBlocks(scope, plan.blocks, plan.summary, deps);
		return { notebook, added: plan.blocks.length };
	})();
}
