/**
 * Planner note absorption (server half). After a note is saved as a material, a background pass reads it:
 * course knowledge goes into the subject's (or topic's) context under "From Planner note: <title> (<date>)",
 * dated items become deadlines (unless one already covers them). Idempotent per externalId + content hash;
 * the result is kept in `<data>/study/planner-absorb.json` for GET /api/planner/notes/result.
 */
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { absorbGate, absorbModelDue, dayEnded, dueOf, matchTopic, newItems, normalizeAbsorbed, regexAbsorb, replaceNoteBlock, weekdayOf, type Absorbed, type AbsorbItem } from "../core/study/planner-absorb.ts";
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
	/** false = only the free regex pass ran (an unfinished note awaiting completion/day end that needs the model). */
	final?: boolean;
	/** The note itself, kept while not final so the day-end sweep can finish it. */
	pending?: PlannerNote;
}
export interface AbsorbStateStore {
	read(): Record<string, AbsorbState>;
	write(all: Record<string, AbsorbState>): void;
}
export interface AbsorbDeps {
	study: Pick<StudyService, "library" | "setContext" | "addDeadline" | "moveMaterial">;
	/** The model call: returns the raw extraction (an object or JSON text). Throws on model failure. */
	extract: (note: PlannerNote, markdown: string, topics: string[]) => Promise<unknown>;
	state: AbsorbStateStore;
	/** Test seam: the current time (default now). */
	now?: () => Date;
}

const MODEL_TEXT_MAX = 30_000;

/** What the model reads: the note without inline images (they are base64 blobs) or the unfinished marker. */
export const absorbText = (markdown: string): string =>
	markdown.replace(/!\[[^\]]*\]\(data:[^)]*\)/g, "").replace(/^> Unfinished notes \(task not completed\)\s*/i, "").trim().slice(0, MODEL_TEXT_MAX);

export const absorbHash = (note: Pick<PlannerNote, "title" | "date" | "markdown" | "subjectId" | "topicId">): string =>
	sha256Of(Buffer.from(JSON.stringify([note.subjectId, note.topicId ?? "", note.title, note.date, absorbText(note.markdown)]), "utf8"));

const inflight = new Map<string, { hash: string; promise: Promise<AbsorbState> }>();

async function run(note: PlannerNote, hash: string, deps: AbsorbDeps, materialId?: string): Promise<AbsorbState> {
	const text = absorbText(note.markdown);
	const subjectTopics = deps.study.library().topics.filter((t) => t.subjectId === note.subjectId);
	// Token diet: the free regex pass first; the model only for real study content or unparseable dates,
	// and only once the task is finished or its day has ended (not on every edit).
	const gate = absorbGate(text, note.date);
	const due = absorbModelDue(note, deps.now?.());
	let absorbed: Absorbed = gate.regex;
	const final = !gate.useModel || due;
	if (gate.useModel && due) {
		try { absorbed = normalizeAbsorbed(await deps.extract(note, text, subjectTopics.map((t) => t.name))); }
		catch (error) {
			console.error("[planner] note extraction by the model failed, using the fallback:", error instanceof Error ? error.message : error);
			absorbed = gate.regex;
		}
	}
	// A subject-level note goes to the topic the model clearly matched; otherwise it stays subject-wide.
	const matched = note.topicId ? undefined : matchTopic(absorbed.topic, subjectTopics);
	const topicId = note.topicId ?? matched;
	const target = { subjectId: note.subjectId, ...(topicId ? { topicId } : {}) };
	if (matched && materialId) {
		try { await deps.study.moveMaterial(materialId, target); } catch (error) { console.error("[planner] could not file the note in its topic:", error); }
	}
	const place = (id?: string) => { const lib = deps.study.library(); return id ? lib.topics.find((t) => t.id === id) : lib.subjects.find((s) => s.id === note.subjectId); };
	const owner = place(topicId);
	if (!owner) throw new Error("The subject or topic no longer exists.");
	const next = replaceNoteBlock(owner.context ?? "", note, absorbed.knowledge);
	if (next !== (owner.context ?? "")) await deps.study.setContext(target, next);
	// A block left by an earlier pass elsewhere in the subject is dropped, so the note is remembered once.
	for (const other of [undefined, ...subjectTopics.map((t) => t.id)]) {
		if (other === topicId) continue;
		const o = place(other);
		const cleaned = o ? replaceNoteBlock(o.context ?? "", note, "") : undefined;
		if (o && cleaned !== undefined && cleaned !== (o.context ?? "")) await deps.study.setContext({ subjectId: note.subjectId, ...(other ? { topicId: other } : {}) }, cleaned);
	}

	const existing = (deps.study.library().deadlines ?? []).filter((d) => d.subjectId === note.subjectId);
	const deadlines: AbsorbedDeadline[] = [];
	for (const item of newItems(existing, absorbed.items)) {
		const made = await deps.study.addDeadline({ ...target, title: item.title, due: dueOf(item), kind: item.kind, notes: item.syllabus });
		deadlines.push({ id: made.id, title: made.title, due: made.due, kind: made.kind });
	}
	return { status: "done", hash, items: absorbed.items, deadlines, final, ...(final ? {} : { pending: note }) };
}

/** Start (or reuse) the absorption of a saved note. Never rejects; resolves to the final state. */
export function absorbPlannerNote(note: PlannerNote, deps: AbsorbDeps, materialId?: string): Promise<AbsorbState> {
	const hash = absorbHash(note);
	const known = deps.state.read()[note.externalId];
	// A provisional (regex-only) result is final for edits; once the model is due it is finished exactly once.
	if (known && known.hash === hash && known.status === "done" && (known.final !== false || !absorbModelDue(note, deps.now?.()))) return Promise.resolve(known);
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
		.then(() => run(note, hash, deps, materialId))
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
async function defaultExtract(note: PlannerNote, markdown: string, topics: string[]): Promise<unknown> {
	const [{ resolveEngine }, { absorbNote }] = await Promise.all([import("./chat-handler.ts"), import("../agent/subagents/planner-note-worker.ts")]);
	const engine = resolveEngine("extractor");
	if (!engine) throw new Error("No model is configured for note extraction.");
	return await absorbNote({ title: note.title, date: note.date, weekday: weekdayOf(note.date), markdown, topics }, { engine });
}

/** Absorb with the real study service and model. Lazy so importing this module never boots Study. */
export async function absorbWithApp(note: PlannerNote, materialId?: string): Promise<AbsorbState> {
	const { study } = await import("./study-runtime.ts");
	void sweepDayEndAbsorbs(study);
	return await absorbPlannerNote(note, { study, extract: defaultExtract, state: absorbStateStore }, materialId);
}

/** The stored result for GET /api/planner/notes/result. */
export function absorbResult(externalId: string): AbsorbState | undefined {
	return absorbStateStore.read()[externalId];
}

let lastSweep = 0;
/** Finish the provisional notes whose day has ended (at most hourly, and only when one is waiting). */
export async function sweepDayEndAbsorbs(study: AbsorbDeps["study"], now: Date = new Date()): Promise<number> {
	if (now.getTime() - lastSweep < 3_600_000) return 0;
	lastSweep = now.getTime();
	const waiting = Object.values(absorbStateStore.read()).filter((s) => s.final === false && s.pending && dayEnded(s.pending.date, now));
	for (const state of waiting) await absorbPlannerNote(state.pending!, { study, extract: defaultExtract, state: absorbStateStore, now: () => now }).catch(() => undefined);
	return waiting.length;
}
