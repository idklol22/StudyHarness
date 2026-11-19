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
import { parseRange } from "../core/study/material-memory.ts";
import { formatLookup, lookup } from "../core/study/material-memory.ts";
import { marksFromQuotes } from "../core/study/text-boxes.ts";
import { addLearnerSticky, addStroke, appendBlocks, editElement, emptyNotebook, MAX_NOTE_PAGES, notebookOutline, PAGE_H, removeLearnerSticky, undoStroke, type Block, type Mark, type Notebook, type Stroke } from "../core/study/notes.ts";
import { materialsIn, materialsUnder, subjectOf, topicOf, topicsOf, type Material, type StudyScope } from "../core/study/model.ts";
import { studyStore } from "../store/study.ts";
import { study } from "./study-runtime.ts";
import { chatsInScope, scopeChatDigest } from "./study-digest.ts";
import { coveredPages, normalizeCoverage, type Coverage } from "../core/study/coverage.ts";
import { readMaterialPages } from "./study-reading.ts";
import { skimPageCount } from "../core/study/outline.ts";
import { beginStudyWork, type WorkHandle } from "./study-activity.ts";

export interface NotesDeps {
	engineFor: (role: ModelRole) => PiEngine | undefined;
	onUsage?: (usage: Usage) => void;
	signal?: AbortSignal;
}

/** A scope plus, optionally, which of its notebooks (absent = the newest). */
export type NotesScope = StudyScope & { notebookId?: string };
/** One notebook of a subject/topic: at most MAX_NOTE_PAGES pages (one exported PDF). */
export interface NotebookEntry { id: string; title: string; createdAt: string; /** Pages asked for when it was created. */ target?: number; /** The file pages it summarises (at most MAX_SOURCE_PAGES). */ covers?: Coverage[]; /** The chats it drew on. */ chats?: string[] }

const scopeKey = (scope: StudyScope): string => scope.topicId ?? scope.subjectId;
const indexKey = (scope: StudyScope): string => `index_${scopeKey(scope)}`;
const env = (deps: NotesDeps, role: ModelRole): WorkerEnv => ({ engine: deps.engineFor(role), signal: deps.signal, onUsage: (u) => deps.onUsage?.(u) });

export function checkedScope<S extends StudyScope>(scope: S): S {
	const lib = study.library();
	if (!subjectOf(lib, scope.subjectId)) throw new Error("That subject no longer exists.");
	if (scope.topicId && topicOf(lib, scope.topicId)?.subjectId !== scope.subjectId) throw new Error("That topic no longer exists.");
	return scope;
}

/** The scope's notebooks, oldest first. A scope from before notebooks existed has its one notebook listed as "Notes". */
export function notebooksOf(scope: StudyScope): NotebookEntry[] {
	const index = studyStore.readDoc<NotebookEntry[] | null>("notes", indexKey(scope), null);
	if (index) return index;
	const legacy = studyStore.readDoc<Notebook | null>("notes", scopeKey(scope), null);
	return legacy?.pages.length ? [{ id: scopeKey(scope), title: "Notes", createdAt: new Date(legacy.log[0]?.at ?? Date.now()).toISOString() }] : [];
}
const writeIndex = (scope: StudyScope, list: NotebookEntry[]) => studyStore.writeDoc("notes", indexKey(scope), list);

/** Start a new, empty notebook in the scope (becomes the newest). */
export function createNotebook(scope: StudyScope, title: string, target?: number, extra: { covers?: Coverage[]; chats?: string[] } = {}): NotebookEntry {
	checkedScope(scope);
	const list = notebooksOf(scope);
	const entry: NotebookEntry = { id: `nb_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title: title.replace(/\s+/g, " ").trim().slice(0, 80) || `Notes ${list.length + 1}`, createdAt: new Date().toISOString(), ...(target ? { target } : {}), ...(extra.covers?.length ? { covers: extra.covers } : {}), ...(extra.chats?.length ? { chats: extra.chats } : {}) };
	writeIndex(scope, [...list, entry]);
	return entry;
}

/** Which stored notebook a scope refers to: the one named, else the newest, else the scope's default. */
export function notebookKey(scope: NotesScope): string {
	const list = notebooksOf(scope);
	if (scope.notebookId) {
		if (!list.some((e) => e.id === scope.notebookId)) throw new Error("That notebook no longer exists.");
		return scope.notebookId;
	}
	return list.at(-1)?.id ?? scopeKey(scope);
}

export const readNotebook = (scope: NotesScope): Notebook => studyStore.readDoc<Notebook>("notes", notebookKey(checkedScope(scope)), emptyNotebook());
const save = (scope: NotesScope, book: Notebook, key = notebookKey(scope)): Notebook => {
	studyStore.writeDoc("notes", key, book);
	// The scope's default notebook is listed the first time something is written to it.
	if (!notebooksOf(scope).some((e) => e.id === key)) writeIndex(scope, [...notebooksOf(scope), { id: key, title: "Notes", createdAt: new Date().toISOString() }]);
	return book;
};

/** Serialise writes per scope so concurrent agent/learner changes (and notebook roll-overs) never overwrite each other. */
const queues = new Map<string, Promise<unknown>>();
function exclusive<T>(scope: StudyScope, fn: () => Promise<T> | T): Promise<T> {
	const key = scopeKey(scope);
	const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
	queues.set(key, run);
	return run;
}

/**
 * Place blocks: figures get their page screenshot's aspect and (when asked for) pen marks placed on the quoted words.
 * A named notebook stops at MAX_NOTE_PAGES (the rest is dropped and `full` is reported); the tutor's live notes (no
 * notebook named) roll over into a new "lesson notes" notebook when the newest is full.
 */
export function addBlocks(scope: NotesScope, planned: readonly PlannedBlock[], summary: string, deps: NotesDeps, maxPages = MAX_NOTE_PAGES): Promise<Notebook> {
	checkedScope(scope);
	return exclusive(scope, async () => {
		const materials = visibleMaterials(study.library(), { ...scope, startMode: "check" });
		const blocks: Block[] = [];
		for (const { block, focus } of planned) {
			if (block.type !== "figure") { blocks.push(block); continue; }
			const m = materials.find((x) => x.id === block.materialId || x.fileName === block.materialId);
			if (!m) throw new Error(`Unknown material "${block.materialId}" for a figure.`);
			if (m.kind === "text") throw new Error(`${m.fileName} is a text file with no page images; quote it in a text or box block instead of a figure.`);
			if (block.page > m.pageCount) throw new Error(`${m.fileName} has only ${m.pageCount} pages.`);
			const img = await study.pageImage(m.sha256, block.page);
			let marks: Mark[] = block.marks ?? [];
			if (!marks.length && focus) {
				try {
					// The marker picks the words; their exact place comes from the PDF's own text layout (never a guessed position).
					const runs = await study.pageTextRuns(m.sha256, block.page);
					marks = marksFromQuotes(runs, await markFigure(runs.map((r) => r.text).join(" "), focus, env(deps, "extractor")));
				}
				catch (error) { console.error("[study] figure marking failed:", error); } // an unmarked screenshot is still a useful figure
			}
			blocks.push({ ...block, materialId: m.id, aspect: img.width / img.height, marks });
		}
		const key = notebookKey(scope);
		const first = appendBlocks(studyStore.readDoc<Notebook>("notes", key, emptyNotebook()), blocks, summary, undefined, undefined, maxPages);
		let book = first.added ? save(scope, first.notebook, key) : first.notebook;
		if (first.full && !scope.notebookId && maxPages >= MAX_NOTE_PAGES) {
			const lib = study.library();
			const name = (scope.topicId ? topicOf(lib, scope.topicId)?.name : undefined) ?? subjectOf(lib, scope.subjectId)?.name ?? "Notes";
			const entry = createNotebook(scope, `${name} — lesson notes ${notebooksOf(scope).length + 1}`);
			const rest = appendBlocks(emptyNotebook(), blocks.slice(first.added), summary);
			book = save({ ...scope, notebookId: entry.id }, rest.notebook, entry.id);
		}
		return book;
	});
}

export const editNote = (scope: NotesScope, elementId: string, patch: Parameters<typeof editElement>[2]): Promise<Notebook> =>
	exclusive(scope, () => save(scope, editElement(readNotebook(scope), elementId, patch)));

/** The learner's ink: always saved through the same queue, never touching the agent's elements. */
export const learnerInk = (scope: NotesScope, op: { kind: "stroke"; pageId: string; stroke: Stroke } | { kind: "undo"; pageId: string } | { kind: "sticky"; pageId: string; x: number; y: number; text: string } | { kind: "remove-sticky"; pageId: string; id: string }): Promise<Notebook> =>
	exclusive(scope, () => {
		const book = readNotebook(scope);
		const next = op.kind === "stroke" ? addStroke(book, op.pageId, op.stroke) : op.kind === "undo" ? undoStroke(book, op.pageId) : op.kind === "sticky" ? addLearnerSticky(book, op.pageId, op) : removeLearnerSticky(book, op.pageId, op.id);
		return save(scope, next);
	});

/** The files a scope's notes summarise: a topic's own and the subject-wide ones; a subject's, every topic's included. */
function notesMaterials(scope: StudyScope): Material[] {
	const lib = study.library();
	if (!scope.topicId) return materialsUnder(lib, scope);
	return [...materialsIn(lib, scope), ...materialsIn(lib, { subjectId: scope.subjectId })];
}

/** One slice of the material handed to the note-taker: its label and the digest text. */
interface Section { label: string; text: string }
const SECTION_CHARS = 12000;
const MAX_SECTIONS_PER_FILE = 6;

/**
 * What a file holds, cut into sections the note-taker reads one at a time: a text file is its own pages
 * (grouped up to ~12k characters); a PDF is its page-range summaries, concepts and figures worth showing.
 */
function fileSections(m: Material, topicName: string, range?: { from: number; to: number }): Section[] {
	const full = studyStore.readMemory(m.sha256);
	// Only the pages this notebook covers.
	const inRange = (n: number) => !range || (n >= range.from && n <= range.to);
	const memory = { ...full, pages: Object.fromEntries(Object.entries(full.pages).filter(([n]) => inRange(Number(n)))), chunks: full.chunks.filter((c) => inRange(c.from) || inRange(c.to)) };
	const where = topicName ? ` (topic: ${topicName})` : " (subject-wide)";
	const head = `${m.fileName} [id ${m.id}]${where}`;
	const groups: string[][] = [[]];
	let size = 0;
	const push = (line: string) => {
		if (size + line.length > SECTION_CHARS && groups.at(-1)!.length) { groups.push([]); size = 0; }
		groups.at(-1)!.push(line); size += line.length;
	};
	const texts = Object.entries(memory.pages).filter(([, t]) => t.trim()).sort(([a], [b]) => Number(a) - Number(b));
	if (m.kind === "text" || texts.length >= Math.min(3, m.pageCount)) {
		// The page texts themselves (a PDF's own text layer, extracted on upload), with the figures worth showing.
		const figures = new Map<number, string[]>();
		for (const c of memory.chunks) for (const f of c.figures ?? []) figures.set(f.page, [...(figures.get(f.page) ?? []), f.caption]);
		// A long document is condensed per page so the whole of it fits the passes (a 300-page book is still covered end to end).
		const perPage = Math.max(300, Math.floor((SECTION_CHARS * MAX_SECTIONS_PER_FILE) / Math.max(1, texts.length)) - 40);
		for (const [n, text] of texts) push(`[page ${n}]${figures.has(Number(n)) ? ` (figure: ${figures.get(Number(n))!.join("; ")})` : ""}\n${text.slice(0, perPage)}`);
	} else {
		for (const c of memory.chunks) {
			push(`pages ${c.from}–${c.to}: ${c.summary}${c.concepts.length ? ` [${c.concepts.join(", ")}]` : ""}`);
			for (const f of c.figures ?? []) push(`  figure p.${f.page}: ${f.caption}`);
		}
		if (!memory.chunks.length && memory.read.length) push(formatLookup(m.fileName, lookup(memory)));
		if (!groups[0]!.length) push(`${m.pageCount} pages, none read yet.`);
	}
	const parts = groups.filter((g) => g.length).slice(0, MAX_SECTIONS_PER_FILE);
	return parts.map((g, i) => ({ label: parts.length > 1 ? `${m.fileName}, part ${i + 1} of ${parts.length}` : m.fileName, text: `${head}${m.kind === "text" ? ` — text file, ${m.pageCount} pages` : ` — ${m.pageCount} pages, ${memory.read.length} read`}\n${g.join("\n")}` }));
}


/** Before summarising, make sure the files have been looked at: the first pages of each, within a total budget. */
async function readForNotes(files: readonly Material[], deps: NotesDeps, work: WorkHandle): Promise<void> {
	// Files are normally understood on upload; anything older (or interrupted) gets its text now — no model needed —
	// plus the same short skim (20% of the file, at most 8 pages).
	for (const m of files.filter((x) => x.kind !== "text")) {
		if (deps.signal?.aborted) return;
		const memory = studyStore.readMemory(m.sha256);
		const missing = Array.from({ length: m.pageCount }, (_, i) => i + 1).filter((n) => memory.pages[n] === undefined);
		try {
			if (missing.length) {
				work.say(`Extracting the text of ${m.fileName} (${missing.length} page${missing.length === 1 ? "" : "s"})…`);
				for (let i = 0; i < missing.length; i += 40) await study.extractText(m.sha256, missing.slice(i, i + 40));
			}
			await readMaterialPages(m, parseRange(`1-${skimPageCount(m.pageCount)}`, m.pageCount), deps);
		} catch (error) { console.error(`[study] could not prepare ${m.fileName} for notes:`, error); work.say(`Could not read ${m.fileName}; using what is already remembered.`); }
	}
}

/** The context documents a notebook draws on: its own, and for a subject-wide notebook every topic's too. */
function contextFor(scope: StudyScope): { name: string; text: string } {
	const lib = study.library();
	const subject = subjectOf(lib, scope.subjectId)!;
	if (scope.topicId) { const t = topicOf(lib, scope.topicId)!; return { name: `${subject.name} › ${t.name}`, text: [t.context, subject.context && `Subject: ${subject.context}`].filter(Boolean).join("\n\n") }; }
	return { name: subject.name, text: [subject.context, ...topicsOf(lib, subject.id).filter((t) => t.context.trim()).map((t) => `## ${t.name}\n${t.context}`)].filter(Boolean).join("\n\n").slice(0, 8000) };
}

/** Roughly how many blocks fill one notes page (used to turn a page target into a per-pass budget). */
const BLOCKS_PER_PAGE = 5;
/** The last page is mostly used (so stopping there leaves no near-empty page). */
const pageFull = (book: Notebook): boolean => { const last = book.pages.at(-1); return !!last && Math.max(0, ...last.elements.map((e) => e.y + e.h)) > PAGE_H * 0.6; };
const depth = (blocks: number) => `Write thorough, descriptive notes for this pass (up to about ${blocks} blocks): start with a heading for what it covers, give a mind map of its structure when it is a whole file or chapter, then explain each concept, define the terms, add flowcharts for processes and algorithms, worked steps for examples, and stickies for tips and exam warnings. Do not repeat what the notes already say.`;

export interface NotesOptions {
	/** How many pages the learner wants (MIN_NOTE_PAGES–MAX_NOTE_PAGES; default 8). */
	pages?: number;
	/** Title of the new notebook. */
	title?: string;
	/** Which file pages to summarise (at most MAX_SOURCE_PAGES in total; default: the scope's files in order up to the limit). */
	coverage?: Coverage[];
	/** Which of the scope's chats to draw on (default: all). */
	chats?: string[];
	/** Include what the agent knows (the topic/subject context). Default true. */
	knowledge?: boolean;
}

export const MIN_NOTE_PAGES = 8;

/**
 * Create a NEW notebook for the scope and write about `pages` pages into it: a summary of ALL the scope's files and
 * ALL its chats (a topic: its own; a subject: every topic's too). The material is split into passes; when the page
 * target is small, sections are merged into fewer passes so every file is still covered, just more briefly.
 * Each step is reported to the activity dock. A notebook never exceeds MAX_NOTE_PAGES.
 */
export function generateNotes(scope: StudyScope, lesson: string, deps: NotesDeps, options: NotesOptions = {}): Promise<{ notebook: Notebook; notebookId: string; added: number }> {
	checkedScope(scope);
	return (async () => {
		const lib = study.library();
		const ctx = contextFor(scope);
		const target = Math.max(MIN_NOTE_PAGES, Math.min(MAX_NOTE_PAGES, Math.round(options.pages ?? 8)));
		const coverage = normalizeCoverage(notesMaterials(scope), options.coverage);
		const files = coverage.map((c) => lib.materials.find((m) => m.id === c.materialId)!);
		const chats = scopeChatDigest(scope, scope.topicId ? 16000 : 24000, options.chats ? new Set(options.chats) : undefined);
		if (options.knowledge === false) ctx.text = "";
		const work = beginStudyWork(`Writing notes: ${ctx.name}`, `About ${target} pages from ${coveredPages(coverage)} source page${coveredPages(coverage) === 1 ? "" : "s"} in ${files.length} file${files.length === 1 ? "" : "s"}, ${chats.chats} conversation${chats.chats === 1 ? "" : "s"}${options.knowledge === false ? "" : " and what the agent knows"}`);
		try {
			await readForNotes(files, deps, work);
			// Material sections, in file order.
			const sections: Array<{ label: string; text: string; topicName: string; continued: boolean }> = [];
			for (const [k, m] of files.entries()) {
				const topicName = m.scope.topicId ? topicOf(lib, m.scope.topicId)?.name ?? "" : "";
				fileSections(m, topicName, coverage[k]).forEach((s, i) => sections.push({ ...s, topicName, continued: i > 0 }));
			}
			const said = [lesson.trim(), chats.text].filter(Boolean).join("\n\n");
			// No more passes than the pages allow (about two pages per pass); merged sections share one pass.
			const room = Math.max(1, Math.ceil(target / 2) - (said ? 1 : 0));
			const groups: Array<typeof sections> = [];
			const per = Math.ceil(sections.length / Math.min(room, Math.max(1, sections.length)));
			for (let i = 0; i < sections.length; i += per) groups.push(sections.slice(i, i + per));
			const totalPasses = groups.length + (said ? 1 : 0) || 1;
			const budget = Math.max(4, Math.min(25, Math.round((target * BLOCKS_PER_PAGE) / totalPasses)));
			const passes: Array<{ label: string; materials: string; lesson: string; instruction: string }> = groups.map((g) => {
				const share = Math.floor((SECTION_CHARS * 1.5) / g.length);
				const label = g.length === 1 ? g[0]!.label : `${g[0]!.label} … ${g.at(-1)!.label}`;
				const topics = [...new Set(g.map((s) => s.topicName).filter(Boolean))];
				return {
					label, lesson: "",
					materials: g.map((s) => (g.length === 1 ? s.text : s.text.slice(0, share))).join("\n\n"),
					instruction: `This pass covers ONLY the material below: ${label}${topics.length ? ` (topic${topics.length > 1 ? "s" : ""}: ${topics.join(", ")})` : ""}. ${g.length === 1 && g[0]!.continued ? "Continue the notes on this file from where they stop; do not restart with an overview. " : ""}${depth(budget)}`,
				};
			});
			if (said) passes.push({ label: chats.chats ? `${chats.chats} conversation${chats.chats === 1 ? "" : "s"}` : "this lesson", materials: "", lesson: said, instruction: `This pass covers ONLY the conversations below. Summarise what was taught and discussed: the key explanations, the examples that were worked, what the learner found hard or got wrong, and what to revisit. ${depth(budget)}` });
			if (!passes.length && ctx.text.trim()) passes.push({ label: "what is known so far", materials: "", lesson: "", instruction: depth(budget) });
			if (!passes.length) throw new Error("There was nothing to add to the notes yet. Upload material or have a lesson first.");

			const entry = createNotebook(scope, options.title?.trim() || `${ctx.name} — notes`, target, { covers: coverage, chats: options.chats ?? chatsInScope(scope).map((c) => c.id) });
			const here: NotesScope = { ...scope, notebookId: entry.id };
			let notebook = readNotebook(here);
			let added = 0;
			for (const [i, pass] of passes.entries()) {
				if (deps.signal?.aborted) break;
				if (i > 0 && notebook.pages.length >= target && pageFull(notebook)) { work.say(`Reached the ${target} page${target === 1 ? "" : "s"} asked for; stopping here.`); break; }
				work.say(`Understanding ${pass.label} (${i + 1} of ${passes.length}): deciding what the notes should say…`);
				const plan = await planNotes({ name: ctx.name, context: ctx.text, materials: pass.materials, outline: notebookOutline(notebook), lesson: pass.lesson, instruction: `${pass.instruction}\nThe whole notebook must fit in about ${target} page${target === 1 ? "" : "s"} (about ${BLOCKS_PER_PAGE} blocks per page), so be selective and keep to the budget.` }, env(deps, "extractor"));
				if (!plan.blocks.length) { work.say(`Nothing new to add from ${pass.label}.`); continue; }
				const kinds = new Map<string, number>();
				for (const b of plan.blocks) kinds.set(b.block.type, (kinds.get(b.block.type) ?? 0) + 1);
				work.say(`Writing ${plan.blocks.length} blocks from ${pass.label}: ${[...kinds].map(([k, n]) => `${n} ${k}`).join(", ")}${plan.blocks.some((b) => b.block.type === "figure") ? " — screenshotting the figures" : ""}`);
				notebook = await addBlocks(here, plan.blocks, plan.summary, deps, target);
				added += plan.blocks.length;
			}
			if (!added) throw new Error("There was nothing to add to the notes yet. Upload material or have a lesson first.");
			work.say(`Done: ${notebook.pages.length} page${notebook.pages.length === 1 ? "" : "s"} in “${entry.title}”.`);
			return { notebook, notebookId: entry.id, added };
		} finally { work.done(); }
	})();
}

/** Every notebook of a subject and its topics, with what each covers (for the file list's coverage marks). */
export function subjectNotebooks(subjectId: string): Array<NotebookEntry & { scopeName: string; href: string; topicId?: string }> {
	const lib = study.library();
	const subject = subjectOf(lib, subjectId);
	if (!subject) throw new Error("That subject no longer exists.");
	const scopes: Array<{ scope: StudyScope; name: string; href: string }> = [
		{ scope: { subjectId }, name: subject.name, href: `/subjects/${subjectId}#notes` },
		...topicsOf(lib, subjectId).map((t) => ({ scope: { subjectId, topicId: t.id }, name: t.name, href: `/subjects/${subjectId}/${t.id}#notes` })),
	];
	return scopes.flatMap(({ scope, name, href }) => notebooksOf(scope).map((e) => ({ ...e, scopeName: name, href, ...(scope.topicId ? { topicId: scope.topicId } : {}) })));
}
