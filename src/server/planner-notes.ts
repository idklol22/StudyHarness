/**
 * Planner note hand-off (Harness H1): the pure rules behind POST /api/planner/notes.
 *
 * A planner task's Markdown becomes an ordinary Study TEXT material, so it shows up in the
 * subject/topic library exactly like a note saved by `save_chat_notes` (src/server/study.ts).
 * `planner-notes.json` in the study data dir is the small externalId → materialId map that makes
 * repeated hand-offs of the same task an update rather than a second file.
 */
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { NAME_MAX } from "../core/study/model.ts";
import { writeFileAtomicSync } from "../store/atomic-write.ts";
import { sha256Of } from "../store/study.ts";
import type { StudyService } from "./study.ts";

/** Bad input (including a stale subject/topic id): the route maps this to HTTP 400. */
export class PlannerNoteInputError extends Error {}

export interface PlannerNote {
	externalId: string;
	subjectId: string;
	topicId?: string;
	title: string;
	/** YYYY-MM-DD */
	date: string;
	markdown: string;
	finished: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BAD_TITLE = /[\\/\r\n\u0000-\u001f]/;
/** `<date> <title>.md` must fit the library's cleanName limit (10 + 1 + n + 3). */
const TITLE_MAX = NAME_MAX - 14;

const requiredText = (value: unknown, label: string): string => {
	if (typeof value !== "string" || !value.trim()) throw new PlannerNoteInputError(`${label} must be a non-empty string.`);
	return value;
};

/** Validate the JSON body: no coercion, no guessing — anything else is a 400. */
export function validatePlannerNote(value: unknown): PlannerNote {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlannerNoteInputError("Send a JSON object.");
	const raw = value as Record<string, unknown>;
	const externalId = requiredText(raw.externalId, "externalId").trim();
	const subjectId = requiredText(raw.subjectId, "subjectId").trim();
	const title = requiredText(raw.title, "title").trim();
	if (BAD_TITLE.test(title)) throw new PlannerNoteInputError("title must not contain path separators or line breaks.");
	if (title.length > TITLE_MAX) throw new PlannerNoteInputError(`title is at most ${TITLE_MAX} characters.`);
	const date = requiredText(raw.date, "date").trim();
	const stamp = `${date}T00:00:00Z`;
	if (!DATE.test(date) || Number.isNaN(Date.parse(stamp)) || new Date(stamp).toISOString().slice(0, 10) !== date) throw new PlannerNoteInputError("date must be a real calendar date in YYYY-MM-DD form.");
	const markdown = requiredText(raw.markdown, "markdown");
	if (raw.topicId !== undefined && (typeof raw.topicId !== "string" || !raw.topicId.trim())) throw new PlannerNoteInputError("topicId must be a non-empty string when given.");
	if (typeof raw.finished !== "boolean") throw new PlannerNoteInputError("finished must be a boolean.");
	return {
		externalId,
		subjectId,
		...(typeof raw.topicId === "string" && raw.topicId.trim() ? { topicId: raw.topicId.trim() } : {}),
		title,
		date,
		markdown,
		finished: raw.finished,
	};
}

/** The Study material name, exactly `<date> <title>.md`. */
export const plannerNoteFileName = (note: PlannerNote): string => `${note.date} ${note.title}.md`;

/** Unfinished tasks carry a visible marker inside the notes themselves. */
export function plannerNoteMarkdown(note: PlannerNote): string {
	return note.finished ? note.markdown : `> Unfinished notes (task not completed)\n\n${note.markdown}`;
}

/** Only string → string entries survive; a hand-edited map must never inject junk ids. */
export function parsePlannerNoteMap(raw: unknown): Record<string, string> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

/** The map is injected so the upsert itself stays IO-free and testable. */
export interface PlannerNoteMap {
	read(): Record<string, string>;
	write(map: Record<string, string>): void;
}

export interface PlannerNoteDeps {
	study: StudyService;
	map: PlannerNoteMap;
}

/** A note without a topic of its own may have been filed into a topic of its subject (by absorption or by the learner): that stays. */
const sameScope = (a: { subjectId: string; topicId?: string }, b: { subjectId: string; topicId?: string }) => a.subjectId === b.subjectId && (!b.topicId || a.topicId === b.topicId);

/** The details a Planner note carries in the library: the "From Planner" group, its date and its finished badge. */
export const plannerNoteMeta = (note: PlannerNote) => ({ source: "planner" as const, finished: note.finished, date: note.date, title: note.title, kind: "other" as const });

/**
 * Upsert by externalId. An unchanged note (same content, name and scope) keeps its material id;
 * anything else gets a fresh text material and the old one is removed. The new material is added
 * before the old one is removed, so a failure never leaves the task with no notes at all.
 */
export async function upsertPlannerNote(note: PlannerNote, deps: PlannerNoteDeps): Promise<{ materialId: string }> {
	const lib = deps.study.library();
	if (!lib.subjects.some((s) => s.id === note.subjectId)) throw new PlannerNoteInputError(`Unknown subject: ${note.subjectId}.`);
	if (note.topicId && !lib.topics.some((t) => t.id === note.topicId && t.subjectId === note.subjectId)) throw new PlannerNoteInputError(`Unknown topic: ${note.topicId}.`);
	const scope = { subjectId: note.subjectId, ...(note.topicId ? { topicId: note.topicId } : {}) };
	const fileName = plannerNoteFileName(note);
	const bytes = Buffer.from(plannerNoteMarkdown(note), "utf8");
	const hash = sha256Of(bytes);
	const map = deps.map.read();
	const oldId = Object.hasOwn(map, note.externalId) ? map[note.externalId] : undefined;
	const old = oldId ? lib.materials.find((m) => m.id === oldId) : undefined;
	const stamp = (id: string) => {
		const m = deps.study.library().materials.find((x) => x.id === id);
		if (m?.meta?.source === "planner" && m.meta.finished === note.finished) return;
		deps.study.setMaterialMeta(id, plannerNoteMeta(note));
	};
	if (old && old.sha256 === hash && old.fileName === fileName && sameScope(old.scope, scope)) { stamp(old.id); return { materialId: old.id }; }

	// Study dedupes by (hash, scope): never delete a material another task's mapping still owns.
	const shared = !!oldId && Object.entries(map).some(([id, materialId]) => id !== note.externalId && materialId === oldId);
	const removeOld = () => {
		if (!oldId || shared) return;
		try { deps.study.removeMaterial(oldId); } catch { /* the mapped material is already gone */ }
	};
	let { material } = await deps.study.addMaterial({ bytes, fileName, scope });
	if (oldId && material.id === oldId && !shared) {
		// A rename or scope edit kept the bytes, so the add deduped onto the old reference;
		// drop it and add again so the new name/scope actually sticks.
		removeOld();
		({ material } = await deps.study.addMaterial({ bytes, fileName, scope }));
	} else removeOld();
	deps.map.write({ ...map, [note.externalId]: material.id });
	stamp(material.id);
	return { materialId: material.id };
}

const MAP_FILE = path.join(PATHS.study, "planner-notes.json");

/** The concrete map in `<data>/study/planner-notes.json`, written crash-safely like the rest of the store. */
export const plannerNoteMap: PlannerNoteMap = {
	read() {
		try { return parsePlannerNoteMap(JSON.parse(fs.readFileSync(MAP_FILE, "utf8"))); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
	},
	write(map) {
		fs.mkdirSync(path.dirname(MAP_FILE), { recursive: true });
		writeFileAtomicSync(MAP_FILE, JSON.stringify(map, null, "\t") + "\n");
	},
};
