/**
 * The Study storage adapter (Study overhaul, owner 2026-11-19). Layout under `<data>/study/`:
 *
 *   library.json                      subjects, topics, material references (core/study/model.ts)
 *   materials/<sha256>.pdf            ONE managed copy per distinct file
 *   memory/<sha256>.json              the file's page memory (core/study/material-memory.ts)
 *   pages/<sha256>/<n>.<jpg|png>      rendered page images (cache; pruned, see prunePages)
 *   notes/<key>.json                  notebooks (topic or subject scope)
 *   cards/<key>.json                  flashcards per topic
 *
 * Every write is crash-safe (temp file + rename); the library write is atomic JSON. Hashes name files, so
 * names can never escape the folder. One backend process owns the files (no cross-process locking).
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";
import { emptyLibrary, SHA256, type Library } from "../core/study/model.ts";
import { emptyMemory, type MaterialMemory } from "../core/study/material-memory.ts";
import { removeLeftoverTemps, writeFileAtomicSync } from "./atomic-write.ts";
import { emit } from "../core/events.ts";

const KEY = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_PAGE_IMAGES_PER_FILE = 240;

/** Replace a binary file crash-safely (the shared text writer cannot carry bytes). */
function writeBytesAtomic(file: string, bytes: Uint8Array): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp-${randomUUID()}`;
	try {
		const fd = fs.openSync(tmp, "wx", 0o666);
		try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
		fs.renameSync(tmp, file);
	} catch (error) {
		fs.rmSync(tmp, { force: true });
		throw error;
	}
}

export const sha256Of = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export interface PageImage { bytes: Buffer; mimeType: "image/jpeg" | "image/png"; width: number; height: number }

export function createStudyStore(root: string, announce: () => void = () => {}) {
	const dir = (...parts: string[]) => path.join(root, ...parts);
	const libraryFile = dir("library.json");
	const sha = (value: string) => { if (!SHA256.test(value)) throw new Error("Invalid file hash."); return value; };
	const key = (value: string) => { if (!KEY.test(value)) throw new Error("Invalid key."); return value; };
	const readJson = <T>(file: string, fallback: T): T => {
		try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw error; }
	};
	const writeJson = (file: string, value: unknown) => {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		writeFileAtomicSync(file, JSON.stringify(value, null, "\t") + "\n");
	};

	return {
		root,

		// ── Library ────────────────────────────────────────────────────────────
		readLibrary(): Library {
			const raw = readJson<Partial<Library> | null>(libraryFile, null);
			if (!raw) return emptyLibrary();
			if (raw.version !== 1) throw new Error("This Study library was written by a newer version of the app.");
			return { version: 1, subjects: raw.subjects ?? [], topics: raw.topics ?? [], materials: raw.materials ?? [] };
		},
		writeLibrary(library: Library): void {
			writeJson(libraryFile, library);
			removeLeftoverTemps(libraryFile);
			announce();
		},

		// ── Managed PDF copies ─────────────────────────────────────────────────
		materialPath: (hash: string) => dir("materials", `${sha(hash)}.pdf`),
		hasMaterial: (hash: string) => fs.existsSync(dir("materials", `${sha(hash)}.pdf`)),
		/** Store the file once. Returns false when the identical copy already existed (nothing written). */
		saveMaterial(hash: string, bytes: Uint8Array): boolean {
			const file = dir("materials", `${sha(hash)}.pdf`);
			if (fs.existsSync(file)) return false;
			if (sha256Of(bytes) !== hash) throw new Error("File contents do not match their hash.");
			writeBytesAtomic(file, bytes);
			return true;
		},

		// ── Page memory ────────────────────────────────────────────────────────
		readMemory: (hash: string): MaterialMemory => ({ ...emptyMemory(), ...readJson<Partial<MaterialMemory>>(dir("memory", `${sha(hash)}.json`), {}) }),
		writeMemory: (hash: string, memory: MaterialMemory): void => writeJson(dir("memory", `${sha(hash)}.json`), memory),

		// ── Page images (a cache) ──────────────────────────────────────────────
		savePage(hash: string, n: number, image: PageImage): void {
			if (!Number.isInteger(n) || n < 1) throw new Error("Bad page number.");
			const ext = image.mimeType === "image/png" ? "png" : "jpg";
			const folder = dir("pages", sha(hash));
			for (const other of ["png", "jpg"]) if (other !== ext) fs.rmSync(path.join(folder, `${n}.${other}`), { force: true });
			writeBytesAtomic(path.join(folder, `${n}.${ext}`), image.bytes);
			writeJson(path.join(folder, `${n}.json`), { width: image.width, height: image.height, mimeType: image.mimeType });
		},
		readPage(hash: string, n: number): PageImage | null {
			const folder = dir("pages", sha(hash));
			const meta = readJson<{ width: number; height: number; mimeType: PageImage["mimeType"] } | null>(path.join(folder, `${n}.json`), null);
			if (!meta) return null;
			try {
				const bytes = fs.readFileSync(path.join(folder, `${n}.${meta.mimeType === "image/png" ? "png" : "jpg"}`));
				return { bytes, ...meta };
			} catch { return null; }
		},
		hasPage: (hash: string, n: number): boolean => fs.existsSync(dir("pages", sha(hash), `${n}.json`)),
		/** Keep every pinned page (used in notes) and the newest others, up to a cap; delete the rest. */
		prunePages(hash: string, pinned: ReadonlySet<number>, max = MAX_PAGE_IMAGES_PER_FILE): number {
			const folder = dir("pages", sha(hash));
			let names: string[];
			try { names = fs.readdirSync(folder).filter((n) => /^\d+\.json$/.test(n)); } catch { return 0; }
			const entries = names.map((name) => ({ n: Number(name.slice(0, -5)), mtime: fs.statSync(path.join(folder, name)).mtimeMs }));
			const loose = entries.filter((e) => !pinned.has(e.n)).sort((a, b) => b.mtime - a.mtime);
			const room = Math.max(0, max - entries.filter((e) => pinned.has(e.n)).length);
			let removed = 0;
			for (const e of loose.slice(room)) {
				for (const ext of ["json", "jpg", "png"]) fs.rmSync(path.join(folder, `${e.n}.${ext}`), { force: true });
				removed++;
			}
			return removed;
		},

		/** Remove everything stored for a file nothing references any more: the PDF, its memory, its page images. */
		deleteFile(hash: string): void {
			fs.rmSync(dir("materials", `${sha(hash)}.pdf`), { force: true });
			fs.rmSync(dir("memory", `${sha(hash)}.json`), { force: true });
			fs.rmSync(dir("pages", sha(hash)), { recursive: true, force: true });
		},

		// ── Notebooks and cards (opaque JSON documents keyed by scope) ──────────
		readDoc<T>(kind: "notes" | "cards", id: string, fallback: T): T { return readJson<T>(dir(kind, `${key(id)}.json`), fallback); },
		writeDoc(kind: "notes" | "cards", id: string, value: unknown): void { writeJson(dir(kind, `${key(id)}.json`), value); if (kind === "notes") announce(); },
		deleteDoc(kind: "notes" | "cards", id: string): void {
			const file = dir(kind, `${key(id)}.json`);
			fs.rmSync(file, { force: true });
			removeLeftoverTemps(file);
		},
		listDocs(kind: "notes" | "cards"): string[] {
			try { return fs.readdirSync(dir(kind)).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)); } catch { return []; }
		},

		/** Delete stored files no library material references (startup/after deletes): the safety net. */
		sweepUnreferenced(library: Library): string[] {
			const kept = new Set(library.materials.map((m) => m.sha256));
			const removed: string[] = [];
			let names: string[] = [];
			try { names = fs.readdirSync(dir("materials")); } catch { /* none yet */ }
			for (const name of names) {
				const hash = name.replace(/\.pdf$/, "");
				if (SHA256.test(hash) && !kept.has(hash)) { this.deleteFile(hash); removed.push(hash); }
			}
			return removed;
		},
	};
}

export type StudyStore = ReturnType<typeof createStudyStore>;

/** The app's store: `<data>/study`, announcing changes on the event bus. */
export const studyStore: StudyStore = createStudyStore(PATHS.study, () => emit("sources-changed", {}));
