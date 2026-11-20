/**
 * Class capture inbox — pure rules shared by the API and the UI.
 *
 * A capture is stored under `<data>/study/inbox/<id>/`; `inbox/index.json` is the list the UI reads. The
 * extracted markdown becomes one dated section in a scope's `Class inbox.md`, and dated deadline lines become
 * ordinary study deadlines. No IO lives here.
 */
import { validDue, type DeadlineKind } from "./deadlines.ts";

export type CaptureStatus = "processing" | "added" | "failed";

/** An original screenshot/photo as it is kept on disk, plus the name the student gave it. */
export interface CaptureFile {
	name: string;
	storedAs: string;
	mimeType: "image/png" | "image/jpeg" | "image/webp";
}

export interface Capture {
	id: string;
	subjectId: string;
	topicId?: string;
	createdAt: string;
	status: CaptureStatus;
	files: CaptureFile[];
	/** Set when processing failed; cleared on retry. */
	error?: string;
	addedAt?: string;
}

export interface InboxIndex {
	captures: Capture[];
}

export const INBOX_INDEX_FILE = "index.json";
export const INBOX_NOTES_FILE = "Class inbox.md";
/** How many captures the overview shows (the index keeps a longer tail). */
export const RECENT_CAPTURES = 12;
const KEEP_CAPTURES = 100;

export const emptyInboxIndex = (): InboxIndex => ({ captures: [] });

/** The index is newest-first, with a bounded tail so a busy course cannot grow it without limit. */
export function upsertCapture(index: InboxIndex, capture: Capture): InboxIndex {
	return { captures: [capture, ...index.captures.filter((c) => c.id !== capture.id)].slice(0, KEEP_CAPTURES) };
}

export function patchCapture(index: InboxIndex, id: string, patch: Partial<Pick<Capture, "status" | "error" | "addedAt">>): InboxIndex {
	return { captures: index.captures.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

/** GET ?subjectId= lists the captures of that subject, including those filed under its topics. */
export function capturesOf(index: InboxIndex, subjectId: string): Capture[] {
	return index.captures.filter((c) => c.subjectId === subjectId).slice(0, RECENT_CAPTURES);
}

/** UTC to keep sections deterministic wherever the app runs. */
export function captureSectionHeading(at: string): string {
	const date = new Date(at);
	const iso = Number.isFinite(date.getTime()) ? date.toISOString() : at;
	return `## ${iso.slice(0, 16).replace("T", " ")}`;
}

/** Append one section per capture to a text material, separated by a blank line. */
export function appendCaptureSection(existing: string, markdown: string, at: string): string {
	const body = markdown.trim();
	if (!body) return existing;
	const base = existing.trimEnd();
	return `${base ? `${base}\n\n` : ""}${captureSectionHeading(at)}\n\n${body}\n`;
}

export interface ExtractedDeadline {
	title: string;
	due: string;
	kind: DeadlineKind;
}

const MONTHS: Record<string, number> = {
	jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
	jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
	oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const HINT = /\b(due|deadline|submission|submit|exam|test|quiz|homework|assignment)\b/i;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?\b/g;
const MONTH_FIRST = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i;
const DAY_FIRST = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:,?\s+(\d{4}))?\b/i;
const pad = (n: number) => String(n).padStart(2, "0");

/** Turn a month/day (and optional year) into an ISO date; without a year, choose the next occurrence. */
function toDue(month: number, day: number, year: number | undefined, now: Date): string | undefined {
	const today = new Date(now);
	const thisYear = year ?? today.getUTCFullYear();
	const date = new Date(Date.UTC(thisYear, month, day));
	if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return undefined;
	if (year === undefined && date.getTime() < Date.UTC(thisYear, today.getUTCMonth(), today.getUTCDate())) date.setUTCFullYear(thisYear + 1);
	const due = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
	return validDue(due) ? due : undefined;
}

/** The title on a deadline line, with the bullet, hint words and date removed. */
function deadlineTitle(line: string, dateText: string, kind: DeadlineKind): string {
	const title = line
		.replace(/^\s*[-*+]\s+/, "")
		.replace(/^\s*\d+[.)]\s+/, "")
		.replace(/\*\*|__|`/g, "")
		.replace(dateText, " ")
		.replace(/\b(due|by|is|deadline|on)\b/gi, " ")
		.replace(/\s{2,}/g, " ")
		.replace(/^[\s:–—-]+|[\s:–—-]+$/g, " ")
		.trim()
		.slice(0, 120);
	return title || (kind === "exam" ? "Exam" : kind === "quiz" ? "Quiz" : "Course deadline");
}

/**
 * Deadlines from markdown lines that both mention a due/deadline/exam and carry a parseable date.
 * One deadline per line, deduplicated by title and date. Dates without a year refer to the next occurrence.
 */
export function extractDeadlines(markdown: string, now: Date | number = new Date()): ExtractedDeadline[] {
	const today = new Date(now);
	const found: ExtractedDeadline[] = [];
	const seen = new Set<string>();
	for (const rawLine of markdown.split(/\r?\n/)) {
		if (!HINT.test(rawLine)) continue;
		ISO_DATE.lastIndex = 0;
		const iso = ISO_DATE.exec(rawLine);
		const monthFirst = MONTH_FIRST.exec(rawLine);
		const dayFirst = DAY_FIRST.exec(rawLine);
		let dateText = "";
		let due: string | undefined;
		if (iso) {
			dateText = iso[0]!;
			const candidate = `${iso[1]!}-${iso[2]!}-${iso[3]!}`;
			due = validDue(candidate) ? candidate : undefined;
		} else if (monthFirst) {
			const month = MONTHS[monthFirst[1]!.toLowerCase().replace(".", "")];
			if (month !== undefined) due = toDue(month, Number(monthFirst[2]), monthFirst[3] ? Number(monthFirst[3]) : undefined, today);
			dateText = monthFirst[0];
		} else if (dayFirst) {
			const month = MONTHS[dayFirst[2]!.toLowerCase().replace(".", "")];
			if (month !== undefined) due = toDue(month, Number(dayFirst[1]), dayFirst[3] ? Number(dayFirst[3]) : undefined, today);
			dateText = dayFirst[0];
		}
		if (!due) continue;
		const kind: DeadlineKind = /\bquiz\b/i.test(rawLine) ? "quiz" : /\b(exam|test)\b/i.test(rawLine) ? "exam" : /\b(assignment|homework|submit|submission|due|deadline)\b/i.test(rawLine) ? "assignment" : "other";
		const title = deadlineTitle(rawLine, dateText, kind);
		const key = `${title}\u0000${due}`;
		if (seen.has(key)) continue;
		seen.add(key);
		found.push({ title, due, kind });
	}
	return found;
}

