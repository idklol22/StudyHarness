/**
 * The Study service (Study overhaul, owner 2026-11-19): the one place that changes the library.
 * Subjects/topics/materials rules live in core/study/model.ts; this adds storage (managed copies, memory,
 * page images) and PDF access. Every library change is a synchronous read-modify-write (no awaits between
 * read and write), so concurrent requests cannot lose updates.
 *
 * Material rules (owner: "remove redundant PDFs to save space"):
 *   - an upload is hashed; a file already stored is referenced, never copied again;
 *   - when the last reference to a file goes (material/topic/subject deleted) its PDF, page memory and page
 *     images are removed;
 *   - page images are a cache: those used in notes are pinned, the rest are pruned to a cap.
 */
import path from "node:path";
import {
	addMaterial, createSubject, createTopic, setField, deleteSubject, deleteTopic, moveMaterial, removeMaterial, renameSubject,
	renameTopic, setContext, type Library, type Material, type StudyScope, type Removal,
} from "../core/study/model.ts";
import { lookup, recordBatch, recordPages, type MaterialMemory } from "../core/study/material-memory.ts";
import { isTextName, textOutline, textPages } from "../core/study/text-material.ts";
import { acceptSuggestion, addIdea, addSuggestion, assignMaterial, linkMaterial, dismissSuggestion, editIdea, ideasOf, mergeIdeas, removeIdea, setIdeas, tidyLibrary, type IncomingIdea, type SuggestionEdit } from "../core/study/ideas.ts";
import type { SuggestedTopic } from "../core/study/model.ts";
import type { TextRun } from "../core/study/text-boxes.ts";
import { guessField } from "../core/study/fields.ts";
import { sha256Of, type PageImage, type StudyStore } from "../store/study.ts";

export const MAX_MATERIAL_BYTES = 150 * 1024 * 1024;
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const PDF_MAGIC = Buffer.from("%PDF-");

export interface StudyPdf {
	pageCount(absolute: string): Promise<number>;
	texts(absolute: string, pages: readonly number[]): Promise<Array<{ page: number; text: string }>>;
	/** Text runs with their boxes (fractions of the page) — for placing annotations exactly. Optional. */
	textBoxes?(absolute: string, page: number): Promise<TextRun[]>;
	render(absolute: string, options: { pages: readonly number[]; dpi?: number; format?: "jpeg" | "png" }): Promise<Array<{ page: number; image: string; mimeType: "image/jpeg" | "image/png"; width: number; height: number; text: string }>>;
}

export class StudyInputError extends Error {}

export function createStudyService(store: StudyStore, pdf: StudyPdf) {
	function change<T>(fn: (lib: Library) => { library: Library; result: T; orphaned?: string[] }): T {
		const { library, result, orphaned } = fn(store.readLibrary());
		store.writeLibrary(tidyLibrary(library));
		for (const hash of orphaned ?? []) store.deleteFile(hash);
		return result;
	}
	const guard = <T>(fn: () => T): T => {
		try { return fn(); } catch (error) { throw error instanceof StudyInputError ? error : new StudyInputError(error instanceof Error ? error.message : String(error)); }
	};
	/** Notebooks and cards belong to a scope; deleting the scope deletes them (the files they pinned go with the library). */
	const dropScopeDocs = (ids: string[]) => {
		for (const id of ids) {
			// Every notebook of the scope (its index lists them), then the index, the default notebook and the cards.
			for (const entry of store.readDoc<Array<{ id: string }>>("notes", `index_${id}`, [])) store.deleteDoc("notes", entry.id);
			store.deleteDoc("notes", `index_${id}`);
			for (const kind of ["notes", "cards"] as const) store.deleteDoc(kind, id);
		}
	};
	const withRemoval = (r: Removal) => ({ library: r.library, result: undefined, orphaned: r.orphaned });

	/** A markdown / plain-text file: cut into virtual pages and remembered straight away (the text is the content, no model read). */
	async function addText(bytes: Buffer, input: { fileName: string; scope: StudyScope }): Promise<{ material: Material; created: boolean; alreadyStored: boolean }> {
		if (!isTextName(input.fileName)) throw new StudyInputError("Only PDF, Markdown (.md) and text (.txt) files can be added. Export slides (PowerPoint, Keynote) to PDF first.");
		if (bytes.length > MAX_TEXT_BYTES) throw new StudyInputError(`That text file is larger than ${MAX_TEXT_BYTES / 1024 / 1024} MB.`);
		if (bytes.includes(0)) throw new StudyInputError("That file is not text.");
		const hash = sha256Of(bytes);
		const wasStored = store.hasMaterial(hash);
		const stored = store.saveMaterial(hash, bytes, "txt");
		const pages = textPages(bytes.toString("utf8"));
		if (!store.readMemory(hash).read.length) {
			const outline = textOutline(pages);
			store.writeMemory(hash, recordBatch(store.readMemory(hash), { pages: pages.map((text, i) => ({ n: i + 1, text })), summary: outline.summary, concepts: outline.concepts, toc: outline.toc }));
		}
		try {
			return guard(() => change((lib) => {
				const r = addMaterial(lib, { sha256: hash, fileName: path.basename(input.fileName.replace(/\\/g, "/")), pageCount: pages.length, bytes: bytes.length, scope: input.scope, kind: "text" });
				return { library: r.library, result: { material: r.material, created: r.created, alreadyStored: wasStored || r.shared } };
			}));
		} catch (error) {
			if (stored && !store.readLibrary().materials.some((m) => m.sha256 === hash)) store.deleteFile(hash);
			throw error;
		}
	}

	const api = {
		library: (): Library => store.readLibrary(),

		createSubject: (name: unknown) => guard(() => change((lib) => { const r = createSubject(lib, name); const field = r.created ? guessField(r.subject.name) : undefined; return { library: field ? setField(r.library, r.subject.id, field) : r.library, result: r.subject }; })),
		setField: (subjectId: string, field: string) => guard(() => change((lib) => ({ library: setField(lib, subjectId, field), result: undefined }))),
		createTopic: (subjectId: string, name: unknown) => guard(() => change((lib) => { const r = createTopic(lib, subjectId, name); return { library: r.library, result: r.topic }; })),
		renameSubject: (id: string, name: unknown) => guard(() => change((lib) => ({ library: renameSubject(lib, id, name), result: undefined }))),
		renameTopic: (id: string, name: unknown) => guard(() => change((lib) => ({ library: renameTopic(lib, id, name), result: undefined }))),
		deleteSubject: (id: string) => guard(() => {
			const lib = store.readLibrary();
			const topicIds = lib.topics.filter((t) => t.subjectId === id).map((t) => t.id);
			change((l) => withRemoval(deleteSubject(l, id)));
			dropScopeDocs([id, ...topicIds]);
		}),
		deleteTopic: (id: string) => guard(() => { change((lib) => withRemoval(deleteTopic(lib, id))); dropScopeDocs([id]); }),
		setContext: (target: { subjectId: string; topicId?: string }, context: string) => guard(() => change((lib) => ({ library: setContext(lib, target, context), result: undefined }))),

		/** Add a PDF from its bytes to a scope. Idempotent per (file, scope); the stored copy is shared across scopes. */
		async addMaterial(input: { bytes: Uint8Array; fileName: string; scope: StudyScope }): Promise<{ material: Material; created: boolean; alreadyStored: boolean }> {
			const bytes = Buffer.from(input.bytes);
			if (bytes.length > MAX_MATERIAL_BYTES) throw new StudyInputError(`That file is larger than ${MAX_MATERIAL_BYTES / 1024 / 1024} MB.`);
			if (!bytes.subarray(0, 1024).includes(PDF_MAGIC)) return addText(bytes, input);
			const hash = sha256Of(bytes);
			const wasStored = store.hasMaterial(hash);
			const stored = store.saveMaterial(hash, bytes);
			let pageCount: number;
			try {
				pageCount = await pdf.pageCount(store.materialPath(hash));
			} catch (error) {
				if (stored) store.deleteFile(hash); // never keep a copy that cannot be read
				throw new StudyInputError(`Could not read that PDF: ${error instanceof Error ? error.message : String(error)}`);
			}
			try {
				return guard(() => change((lib) => {
					const r = addMaterial(lib, { sha256: hash, fileName: path.basename(input.fileName.replace(/\\/g, "/")), pageCount, bytes: bytes.length, scope: input.scope });
					return { library: r.library, result: { material: r.material, created: r.created, alreadyStored: wasStored || r.shared } };
				}));
			} catch (error) {
				if (stored && !store.readLibrary().materials.some((m) => m.sha256 === hash)) store.deleteFile(hash);
				throw error;
			}
		},
		/** Ideas: fold new ones into a topic's (or the subject's) list. */
		addIdeas: (target: { subjectId: string; topicId?: string }, incoming: readonly IncomingIdea[]) => guard(() => change((lib) => ({ library: setIdeas(lib, target, mergeIdeas(ideasOf(lib, target), incoming)), result: undefined }))),
		/** Topic suggestions for a subject-wide file. */
		suggestTopics: (materialId: string, topics: readonly SuggestedTopic[]) => guard(() => change((lib) => { const r = addSuggestion(lib, materialId, topics); return { library: r.library, result: r.suggestion }; })),
		acceptSuggestion: (id: string, edits?: Record<number, string | SuggestionEdit>) => guard(() => change((lib) => { const r = acceptSuggestion(lib, id, edits); return { library: r.library, result: r.topics }; })),
		addIdea: (target: { subjectId: string; topicId?: string }, idea: { name: string; summary?: string }) => guard(() => change((lib) => ({ library: addIdea(lib, target, idea), result: undefined }))),
		editIdea: (target: { subjectId: string; topicId?: string }, id: string, patch: { name?: string; summary?: string }) => guard(() => change((lib) => ({ library: editIdea(lib, target, id, patch), result: undefined }))),
		removeIdea: (target: { subjectId: string; topicId?: string }, id: string) => guard(() => change((lib) => ({ library: removeIdea(lib, target, id), result: undefined }))),
		linkMaterial: (materialId: string, to: { topicId?: string; newTopicName?: string }) => guard(() => change((lib) => { const r = linkMaterial(lib, materialId, to); return { library: r.library, result: { topicId: r.topicId, material: r.material } }; })),
		assignMaterial: (materialId: string, to: { topicId?: string; newTopicName?: string }) => guard(() => change((lib) => { const r = assignMaterial(lib, materialId, to); return { library: r.library, result: { topicId: r.topicId, material: r.material } }; })),
		dismissSuggestion: (id: string) => guard(() => change((lib) => ({ library: dismissSuggestion(lib, id), result: undefined }))),
		removeMaterial: (id: string) => guard(() => change((lib) => withRemoval(removeMaterial(lib, id)))),
		moveMaterial: (id: string, scope: StudyScope) => guard(() => change((lib) => ({ library: moveMaterial(lib, id, scope), result: undefined }))),

		material(id: string): Material {
			return store.readLibrary().materials.find((m) => m.id === id) ?? (() => { throw new StudyInputError("That file no longer exists."); })();
		},

		// ── Page memory and images ─────────────────────────────────────────────
		readMemory: (hash: string): MaterialMemory => store.readMemory(hash),
		writeMemory: (hash: string, memory: MaterialMemory) => store.writeMemory(hash, memory),

		/** Answer from page memory; pages never stored are fetched (text only, no model call) and remembered. */
		async lookupPages(hash: string, input: { query?: string; pages?: readonly number[] }): Promise<{ memory: MaterialMemory; result: ReturnType<typeof lookup> }> {
			let memory = store.readMemory(hash);
			let result = lookup(memory, input);
			if (result.kind === "pages" && result.missing.length) {
				const fetched = await pdf.texts(store.materialPath(hash), result.missing.slice(0, 12));
				memory = recordPages(memory, fetched.map((p) => ({ n: p.page, text: p.text })));
				store.writeMemory(hash, memory);
				result = lookup(memory, input);
			}
			return { memory, result };
		},

		/** A page image (cached; rendered on first use). The text rides along only on a fresh render. */
		async pageImage(hash: string, n: number): Promise<PageImage> {
			const cached = store.readPage(hash, n);
			if (cached) return cached;
			const [page] = await pdf.render(store.materialPath(hash), { pages: [n], dpi: 110, format: "jpeg" });
			if (!page) throw new StudyInputError(`Page ${n} does not exist in this file.`);
			const image: PageImage = { bytes: Buffer.from(page.image, "base64"), mimeType: page.mimeType, width: page.width, height: page.height };
			store.savePage(hash, n, image);
			return image;
		},
		savePageImages(hash: string, pages: Array<{ page: number; image: string; mimeType: "image/jpeg" | "image/png"; width: number; height: number }>): void {
			for (const p of pages) store.savePage(hash, p.page, { bytes: Buffer.from(p.image, "base64"), mimeType: p.mimeType, width: p.width, height: p.height });
		},
		/** Extract the text of pages (no model) into the file's memory; returns how many pages had text. */
		async extractText(hash: string, pages: readonly number[]): Promise<number> {
			const fetched = await pdf.texts(store.materialPath(hash), pages);
			store.writeMemory(hash, recordPages(store.readMemory(hash), fetched.map((p) => ({ n: p.page, text: p.text }))));
			return fetched.filter((p) => p.text.trim()).length;
		},
		/** Where each piece of text sits on a page (empty for text files, scanned pages, or no engine support). */
		async pageTextRuns(hash: string, n: number): Promise<TextRun[]> {
			if (!pdf.textBoxes || !store.hasMaterial(hash)) return [];
			try { return await pdf.textBoxes(store.materialPath(hash), n); } catch { return []; }
		},
		prunePages: (hash: string, pinned: ReadonlySet<number>) => store.prunePages(hash, pinned),
		materialPath: (hash: string) => store.materialPath(hash),
		/** Startup safety net: remove stored files no material references. */
		sweep: () => store.sweepUnreferenced(store.readLibrary()),
	};
	return api;
}

export type StudyService = ReturnType<typeof createStudyService>;
