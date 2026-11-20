/**
 * Planner note absorption (server half). After a note is saved as a material, a background pass reads it:
 * course knowledge goes into the subject's (or topic's) context under "From Planner note: <title> (<date>)",
 * dated items become deadlines (unless one already covers them). Idempotent per externalId + content hash;
 * the result is kept in `<data>/study/planner-absorb.json` for GET /api/planner/notes/result.
 */
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { dueOf, newItems, normalizeAbsorbed, regexAbsorb, replaceNoteBlock, weekdayOf, type Absorbed, type AbsorbItem } from "../core/study/planner-absorb.ts";
import { writeFileAtomicSync } from "../store/atomic-write.ts";
import { sha256Of } from "../store/study.ts";
import type { PlannerNote } from "./planner-notes.ts";
import type { StudyService } from "./study.ts";

export interface AbsorbedDeadline { id: string; title: string; due: string; kind: AbsorbItem["kind"] }
export interface AbsorbState {
	status: "pending" | "done" | "failed";
	hash: string;
	items: AbsorbItem[];
	deadlines: AbsorbedDeadline[];
	error?: string;
}
export interface AbsorbStateStore {
	read(): Record<string, AbsorbState>;
	write(all: Record<string, AbsorbState>): void;
}
export interface AbsorbDeps {
	study: Pick<StudyService, "library" | "setContext" | "addDeadline">;
	/** The model call: returns the raw extraction (an object or JSON text). Throws on model failure. */
	extract: (note: PlannerNote, markdown: string) => Promise<unknown>;
	state: AbsorbStateStore;
}

const MODEL_TEXT_MAX = 30_000;

/** What the model reads: the note without inline images (they are base64 blobs) or the unfinished marker. */
export const absorbText = (markdown: string): string =>
	markdown.replace(/!\[[^\]]*\]\(data:[^)]*\)/g, "").replace(/^> Unfinished notes \(task not completed\)\s*/i, "").trim().slice(0, MODEL_TEXT_MAX);

export const absorbHash = (note: Pick<PlannerNote, "title" | "date" | "markdown" | "subjectId" | "topicId">): string =>
	sha256Of(Buffer.from(JSON.stringify([note.subjectId, note.topicId ?? "", note.title, note.date, absorbText(note.markdown)]), "utf8"));

const inflight = new Map<string, { hash: string; promise: Promise<AbsorbState> }>();

async function run(note: PlannerNote, hash: string, deps: AbsorbDeps): Promise<AbsorbState> {
	const text = absorbText(note.markdown);
	let absorbed: Absorbed;
	try { absorbed = normalizeAbsorbed(await deps.extract(note, text)); }
	catch (error) {
		console.error("[planner] note extraction by the model failed, using the fallback:", error instanceof Error ? error.message : error);
		absorbed = regexAbsorb(text, note.date);
	}
	const target = { subjectId: note.subjectId, ...(note.topicId ? { topicId: note.topicId } : {}) };
	const lib = deps.study.library();
	const owner = note.topicId ? lib.topics.find((t) => t.id === note.topicId) : lib.subjects.find((s) => s.id === note.subjectId);
	if (!owner) throw new Error("The subject or topic no longer exists.");
	const next = replaceNoteBlock(owner.context ?? "", note, absorbed.knowledge);
	if (next !== (owner.context ?? "")) await deps.study.setContext(target, next);

	const existing = (deps.study.library().deadlines ?? []).filter((d) => d.subjectId === note.subjectId);
	const deadlines: AbsorbedDeadline[] = [];
	for (const item of newItems(existing, absorbed.items)) {
		const made = await deps.study.addDeadline({ ...target, title: item.title, due: dueOf(item), kind: item.kind, notes: item.syllabus });
		deadlines.push({ id: made.id, title: made.title, due: made.due, kind: made.kind });
	}
	return { status: "done", hash, items: absorbed.items, deadlines };
}

/** Start (or reuse) the absorption of a saved note. Never rejects; resolves to the final state. */
export function absorbPlannerNote(note: PlannerNote, deps: AbsorbDeps): Promise<AbsorbState> {
	const hash = absorbHash(note);
	const known = deps.state.read()[note.externalId];
	if (known && known.hash === hash && known.status === "done") return Promise.resolve(known);
	const running = inflight.get(note.externalId);
	if (running && running.hash === hash) return running.promise;
	const save = (state: AbsorbState) => {
		try { deps.state.write({ ...deps.state.read(), [note.externalId]: state }); } catch (error) { console.error("[planner] could not save the absorb state:", error); }
		return state;
	};
	save({ status: "pending", hash, items: [], deadlines: [] });
	// A newer edit waits for the older pass of the same note so the two never interleave.
	const after = running?.promise.catch(() => undefined) ?? Promise.resolve();
	const promise: Promise<AbsorbState> = after
		.then(() => run(note, hash, deps))
		.catch((error): AbsorbState => ({ status: "failed", hash, items: [], deadlines: [], error: error instanceof Error ? error.message : String(error) }))
		.then((state) => {
			if (inflight.get(note.externalId)?.promise !== promise) return state; // superseded; the newer pass owns the stored state
			inflight.delete(note.externalId);
			return save(state);
		});
	inflight.set(note.externalId, { hash, promise });
	return promise;
}

/** Wait for an absorb at most `ms`; undefined when it is still running. */
export async function waitForAbsorb(promise: Promise<AbsorbState>, ms: number): Promise<AbsorbState | undefined> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms); });
	try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
}

const STATE_FILE = path.join(PATHS.study, "planner-absorb.json");

export const absorbStateStore: AbsorbStateStore = {
	read() {
		try {
			const raw: unknown = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
			return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, AbsorbState>) : {};
		} catch { return {}; }
	},
	write(all) {
		fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
		writeFileAtomicSync(STATE_FILE, JSON.stringify(all, null, "\t") + "\n");
	},
};

/** The real model call: the "extractor" role, resolved like the inbox and the context keeper do. */
async function defaultExtract(note: PlannerNote, markdown: string): Promise<unknown> {
	const [{ resolveEngine }, { absorbNote }] = await Promise.all([import("./chat-handler.ts"), import("../agent/subagents/planner-note-worker.ts")]);
	const engine = resolveEngine("extractor");
	if (!engine) throw new Error("No model is configured for note extraction.");
	return await absorbNote({ title: note.title, date: note.date, weekday: weekdayOf(note.date), markdown }, { engine });
}

/** Absorb with the real study service and model. Lazy so importing this module never boots Study. */
export async function absorbWithApp(note: PlannerNote): Promise<AbsorbState> {
	const { study } = await import("./study-runtime.ts");
	return await absorbPlannerNote(note, { study, extract: defaultExtract, state: absorbStateStore });
}

/** The stored result for GET /api/planner/notes/result. */
export function absorbResult(externalId: string): AbsorbState | undefined {
	return absorbStateStore.read()[externalId];
}
