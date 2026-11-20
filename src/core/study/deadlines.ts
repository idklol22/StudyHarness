/**
 * Deadlines (Task 4): dated to-dos of a subject or topic, owned by the Harness until a Planner app syncs them.
 * Pure: no IO. The library service persists the list; deleting a scope removes its deadlines (model.ts).
 */
import { checkScope, cleanName, type Deadline, type Fresh, type Library } from "./model.ts";

export type DeadlineKind = Deadline["kind"];
export const DEADLINE_KINDS: readonly DeadlineKind[] = ["assignment", "exam", "quiz", "other"];

const fail = (message: string): never => { throw new Error(message); };
const fresh = (prefix: string, make?: () => Fresh): Fresh => make?.() ?? { id: `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`, at: new Date().toISOString() };

/** Accept a real calendar date (YYYY-MM-DD) or a parseable ISO date/time, as the model promises. */
export function validDue(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const s = value.trim();
	const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
	if (dateOnly) {
		const [, y, m, d] = dateOnly.map(Number) as unknown as number[];
		const date = new Date(Date.UTC(y!, m! - 1, d!));
		return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
	}
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(s)) return false;
	return Number.isFinite(Date.parse(s));
}

export function readKind(value: unknown): DeadlineKind {
	if (value === undefined || value === null || value === "") return "other";
	if (typeof value !== "string" || !DEADLINE_KINDS.includes(value as DeadlineKind)) fail("Choose a valid kind.");
	return value as DeadlineKind;
}

function readTitle(value: unknown): string {
	return cleanName(value, "Title");
}

export interface NewDeadline {
	subjectId: string;
	topicId?: string;
	title: unknown;
	due: unknown;
	kind?: unknown;
	done?: boolean;
	notes?: string;
}

/** Add a deadline to a subject (or one of its topics). */
export function addDeadline(lib: Library, input: NewDeadline, make?: () => Fresh): { library: Library; deadline: Deadline } {
	const scope = checkScope(lib, { subjectId: input.subjectId, ...(input.topicId ? { topicId: input.topicId } : {}) });
	const title = readTitle(input.title);
	const due = input.due;
	if (!validDue(due)) fail("Due must be a real date or date and time.");
	const f = fresh("dl", make);
	const deadline: Deadline = {
		id: f.id,
		...scope,
		title,
		due: String(due).trim(),
		kind: readKind(input.kind),
		...(input.done ? { done: true } : {}),
		...(typeof input.notes === "string" && input.notes.trim() ? { notes: input.notes.trim().slice(0, 500) } : {}),
	};
	return { library: { ...lib, deadlines: [...(lib.deadlines ?? []), deadline] }, deadline };
}

/** Change a deadline's wording, date or kind; each field is validated only when supplied. */
export function editDeadline(lib: Library, id: string, patch: { title?: unknown; due?: unknown; kind?: unknown }): Library {
	const deadlines = lib.deadlines ?? [];
	if (!deadlines.some((d) => d.id === id)) fail("That deadline no longer exists.");
	const changes: Partial<Pick<Deadline, "title" | "due" | "kind">> = {};
	if (patch.title !== undefined) changes.title = readTitle(patch.title);
	const due = patch.due;
	if (due !== undefined) {
		if (!validDue(due)) fail("Due must be a real date or date and time.");
		changes.due = String(due).trim();
	}
	if (patch.kind !== undefined) changes.kind = readKind(patch.kind);
	if (!Object.keys(changes).length) return lib;
	return { ...lib, deadlines: deadlines.map((d) => (d.id === id ? { ...d, ...changes } : d)) };
}

export function removeDeadline(lib: Library, id: string): Library {
	const deadlines = lib.deadlines ?? [];
	if (!deadlines.some((d) => d.id === id)) fail("That deadline no longer exists.");
	return { ...lib, deadlines: deadlines.filter((d) => d.id !== id) };
}

export function toggleDeadline(lib: Library, id: string): Library {
	const deadlines = lib.deadlines ?? [];
	if (!deadlines.some((d) => d.id === id)) fail("That deadline no longer exists.");
	return { ...lib, deadlines: deadlines.map((d) => (d.id === id ? { ...d, done: !d.done } : d)) };
}

/**
 * Not-done deadlines of a subject, overdue first then soonest. With `topicId`, only subject-wide deadlines and
 * deadlines of that topic are returned (the topic page still honours deadlines that apply to the whole subject).
 */
export function upcoming(lib: Library, subjectId: string, now: Date | number = new Date(), topicId?: string): Deadline[] {
	const at = typeof now === "number" ? now : now.getTime();
	return (lib.deadlines ?? [])
		.filter((d) => !d.done && d.subjectId === subjectId && (topicId === undefined || (d.topicId ?? undefined) === topicId))
		.sort((a, b) => (Date.parse(a.due) - at) - (Date.parse(b.due) - at) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}
