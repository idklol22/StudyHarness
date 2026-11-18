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
	addMaterial, createSubject, createTopic, deleteSubject, deleteTopic, moveMaterial, removeMaterial, renameSubject,
	renameTopic, setContext, type Library, type Material, type StudyScope, type Removal,
} from "../core/study/model.ts";
import { lookup, recordPages, type MaterialMemory } from "../core/study/material-memory.ts";
import { sha256Of, type PageImage, type StudyStore } from "../store/study.ts";

export const MAX_MATERIAL_BYTES = 150 * 1024 * 1024;
const PDF_MAGIC = Buffer.from("%PDF-");

export interface StudyPdf {
	pageCount(absolute: string): Promise<number>;
	texts(absolute: string, pages: readonly number[]): Promise<Array<{ page: number; text: string }>>;
	render(absolute: string, options: { pages: readonly number[]; dpi?: number; format?: "jpeg" | "png" }): Promise<Array<{ page: number; image: string; mimeType: "image/jpeg" | "image/png"; width: number; height: number; text: string }>>;
}

export class StudyInputError extends Error {}

export function createStudyService(store: StudyStore, pdf: StudyPdf) {
	function change<T>(fn: (lib: Library) => { library: Library; result: T; orphaned?: string[] }): T {
		const { library, result, orphaned } = fn(store.readLibrary());
		store.writeLibrary(library);
		for (const hash of orphaned ?? []) store.deleteFile(hash);
		return result;
	}
	const guard = <T>(fn: () => T): T => {
		try { return fn(); } catch (error) { throw error instanceof StudyInputError ? error : new StudyInputError(error instanceof Error ? error.message : String(error)); }
	};
	/** Notebooks and cards belong to a scope; deleting the scope deletes them (the files they pinned go with the library). */
	const dropScopeDocs = (ids: string[]) => { for (const id of ids) for (const kind of ["notes", "cards"] as const) store.deleteDoc(kind, id); };
	const withRemoval = (r: Removal) => ({ library: r.library, result: undefined, orphaned: r.orphaned });

	const api = {
		library: (): Library => store.readLibrary(),

		createSubject: (name: unknown) => guard(() => change((lib) => { const r = createSubject(lib, name); return { library: r.library, result: r.subject }; })),
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
			if (!bytes.subarray(0, 1024).includes(PDF_MAGIC)) throw new StudyInputError("Only PDF files can be added. Export slides (PowerPoint, Keynote) to PDF first.");
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
		prunePages: (hash: string, pinned: ReadonlySet<number>) => store.prunePages(hash, pinned),
		materialPath: (hash: string) => store.materialPath(hash),
		/** Startup safety net: remove stored files no material references. */
		sweep: () => store.sweepUnreferenced(store.readLibrary()),
	};
	return api;
}

export type StudyService = ReturnType<typeof createStudyService>;
