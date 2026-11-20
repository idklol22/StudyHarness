/**
 * Planner note absorption (pure): what a Planner note teaches (memory) and which dated items it announces
 * (deadlines). No IO. The server half (src/server/planner-absorb.ts) runs the model, and falls back to
 * `regexAbsorb` when the model fails.
 */
import { validDue, type DeadlineKind } from "./deadlines.ts";

export interface AbsorbItem {
	title: string;
	kind: DeadlineKind;
	/** YYYY-MM-DD */
	date: string;
	/** HH:MM (24 h) */
	time?: string;
	syllabus?: string;
}

export interface Absorbed {
	knowledge: string;
	items: AbsorbItem[];
	/** Name of an existing topic the note clearly belongs to. */
	topic?: string;
}

const KINDS: readonly DeadlineKind[] = ["assignment", "exam", "quiz", "other"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// ── validation / repair ─────────────────────────────────────────────────────────────────────────────────────────

/** Accept an object or a JSON string (optionally fenced); drop invalid items instead of failing the note. */
export function normalizeAbsorbed(value: unknown): Absorbed {
	let raw = value;
	if (typeof raw === "string") {
		const body = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
		const start = body.indexOf("{");
		const end = body.lastIndexOf("}");
		try { raw = JSON.parse(start >= 0 && end > start ? body.slice(start, end + 1) : body); }
		catch { throw new Error("The extraction was not valid JSON."); }
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("The extraction must be an object.");
	const obj = raw as Record<string, unknown>;
	const knowledge = typeof obj.knowledge === "string" ? obj.knowledge.trim() : "";
	const items: AbsorbItem[] = [];
	for (const entry of Array.isArray(obj.items) ? obj.items : []) {
		if (!entry || typeof entry !== "object") continue;
		const e = entry as Record<string, unknown>;
		const title = typeof e.title === "string" ? e.title.replace(/\s+/g, " ").trim() : "";
		const date = typeof e.date === "string" ? e.date.trim() : "";
		if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !validDue(date)) continue;
		const kind = KINDS.includes(e.kind as DeadlineKind) ? (e.kind as DeadlineKind) : "other";
		const time = typeof e.time === "string" && TIME.test(e.time.trim()) ? e.time.trim() : undefined;
		const syllabus = typeof e.syllabus === "string" && e.syllabus.trim() ? e.syllabus.trim().slice(0, 300) : undefined;
		items.push({ title: title.slice(0, 120), kind, date, ...(time ? { time } : {}), ...(syllabus ? { syllabus } : {}) });
	}
	const topic = typeof obj.topic === "string" && obj.topic.trim() ? obj.topic.trim() : undefined;
	return { knowledge, items, ...(topic ? { topic } : {}) };
}

/** The existing topic a model-named topic refers to (same words, order and case aside); undefined when unclear. */
export function matchTopic(name: string | undefined, topics: ReadonlyArray<{ id: string; name: string }>): string | undefined {
	if (!name) return undefined;
	const wanted = titleTokens(name);
	if (!wanted.length) return undefined;
	const scored = topics
		.map((t) => ({ id: t.id, score: titleOverlap(name, t.name), same: titleTokens(t.name).length === wanted.length }))
		.filter((t) => t.score >= 0.6)
		.sort((a, b) => b.score - a.score || Number(b.same) - Number(a.same));
	if (!scored.length) return undefined;
	if (scored[1] && scored[1].score === scored[0]!.score && scored[1].same === scored[0]!.same) return undefined; // ambiguous
	return scored[0]!.id;
}

// ── dates ───────────────────────────────────────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseIso = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => { const d = parseIso(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

/** The weekday name for a YYYY-MM-DD date (given to the model so "friday" resolves correctly). */
export const weekdayOf = (date: string): string => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][parseIso(date).getUTCDay()]!;

/** The `day`th of the note's month, or of the next month when that day has already passed; undefined when it does not exist. */
export function dayOfMonthAfter(noteDate: string, day: number): string | undefined {
	const base = parseIso(noteDate);
	for (let step = 0; step < 2; step++) {
		const candidate = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + step, day));
		if (candidate.getUTCDate() !== day) continue; // month too short
		const text = iso(candidate);
		if (text >= noteDate) return text;
	}
	return undefined;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// ── deterministic fallback ──────────────────────────────────────────────────────────────────────────────────────

const KEYWORD = /\b(assignments?|exams?|end[\s-]?sem(?:ester)?s?|mid[\s-]?sem(?:ester)?s?|quizz?(?:es)?|tests?|viva|lab|homework|submission|project|deadline|presentation)\b/i;
const DATE_WORDS = String.raw`day after tomorrow|tomorrow|tonight|today|(?:next\s+|this\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|\d{4}-\d{2}-\d{2}|(?:the\s+)?\d{1,2}(?:st|nd|rd|th)\b`;
const DATE_RE = new RegExp(String.raw`(?:@\s*|\b(?:on|by|due|before)\s+)?\b(?:${DATE_WORDS})`, "i");
const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(?:at|@)\s*(\d{1,2}):(\d{2})\b/i;

function lineDate(text: string, noteDate: string): string | undefined {
	const lower = text.toLowerCase();
	const isoM = /\b(\d{4}-\d{2}-\d{2})\b/.exec(lower);
	if (isoM) return validDue(isoM[1]) ? isoM[1] : undefined;
	if (/day after tomorrow/.test(lower)) return addDays(noteDate, 2);
	if (/\btomorrow\b/.test(lower)) return addDays(noteDate, 1);
	if (/\b(today|tonight)\b/.test(lower)) return noteDate;
	const wd = new RegExp(String.raw`\b(${WEEKDAYS.join("|")})\b`).exec(lower);
	if (wd) {
		let delta = (WEEKDAYS.indexOf(wd[1]!) - parseIso(noteDate).getUTCDay() + 7) % 7;
		if (delta === 0) delta = 7;
		return addDays(noteDate, delta);
	}
	const dm = /\b(\d{1,2})(?:st|nd|rd|th)\b/.exec(lower);
	return dm ? dayOfMonthAfter(noteDate, Number(dm[1])) : undefined;
}

function lineTime(text: string): string | undefined {
	const m = TIME_RE.exec(text);
	if (!m) return undefined;
	let hour: number;
	let minute: number;
	if (m[1] !== undefined) {
		hour = Number(m[1]);
		minute = m[2] ? Number(m[2]) : 0;
		if (hour < 1 || hour > 12) return undefined;
		hour = (hour % 12) + (m[3]!.toLowerCase() === "pm" ? 12 : 0);
	} else {
		hour = Number(m[4]);
		minute = Number(m[5]);
	}
	return hour < 24 && minute < 60 ? `${pad(hour)}:${pad(minute)}` : undefined;
}

const kindOf = (text: string): DeadlineKind =>
	/\bquizz?/i.test(text) ? "quiz"
		: /\b(exam|end[\s-]?sem|mid[\s-]?sem|test|viva)/i.test(text) ? "exam"
			: /\b(assignment|lab|homework|submission|project|deadline|presentation)/i.test(text) ? "assignment"
				: "other";

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/**
 * Obvious dated announcements only: a line that names an assessment (assignment, exam, end sem, quiz, lab...)
 * and a day (today, tomorrow, a weekday, "on 29th", an ISO date), optionally "at 5pm" and "syllabus ...".
 * Everything else in the note is kept as knowledge.
 */
export function regexAbsorb(markdown: string, noteDate: string): Absorbed {
	const items: AbsorbItem[] = [];
	const rest: string[] = [];
	let fenced = false;
	for (const line of markdown.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (/^```/.test(trimmed)) { fenced = !fenced; rest.push(line); continue; }
		const plain = !fenced && trimmed && !/^[|#>]/.test(trimmed);
		const key = plain ? KEYWORD.exec(trimmed) : null;
		const date = key ? lineDate(trimmed, noteDate) : undefined;
		if (!plain || !key || !date) { rest.push(line); continue; }
		const syl = /\bsyllabus\b\s*[:\-–]?\s*(?:is\b|are\b)?\s*(.*)$/i.exec(trimmed);
		const dateAt = DATE_RE.exec(trimmed)?.index ?? trimmed.length;
		const cut = Math.min(dateAt, syl ? syl.index : trimmed.length);
		let title = trimmed.slice(0, cut)
			.replace(/^[\s\-*•\d.)]*(?:we\s+(?:have|got|will\s+have)|there\s+is|there's|there\s+will\s+be|our|the|a)\s+/i, "")
			.replace(/[\s@:,;\-–]+$/, "")
			.trim();
		if (!title || !KEYWORD.test(title)) title = key[0];
		const time = lineTime(trimmed);
		const syllabus = syl?.[1]?.replace(/[.\s]+$/, "").trim();
		items.push({ title: capitalize(title), kind: kindOf(title), date, ...(time ? { time } : {}), ...(syllabus ? { syllabus } : {}) });
	}
	return { knowledge: rest.join("\n").replace(/\n{3,}/g, "\n\n").trim(), items };
}

// ── dedupe ──────────────────────────────────────────────────────────────────────────────────────────────────────

const STOP = new Set(["the", "a", "an", "of", "for", "and", "to", "on", "in", "we", "have", "is"]);

/** Lower-case word tokens, punctuation and filler removed, a trailing plural "s" dropped. */
export function titleTokens(title: string): string[] {
	return title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t && !STOP.has(t)).map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));
}

/** Token overlap (shared / smaller set), 0..1. */
export function titleOverlap(a: string, b: string): number {
	const x = new Set(titleTokens(a));
	const y = new Set(titleTokens(b));
	if (!x.size || !y.size) return 0;
	let shared = 0;
	for (const t of x) if (y.has(t)) shared++;
	return shared / Math.min(x.size, y.size);
}

export const similarTitles = (a: string, b: string, threshold = 0.6): boolean => titleOverlap(a, b) >= threshold;

/** Does an existing deadline (already filtered to the subject) cover `item`? Same date and similar title. */
export function alreadyHasItem(existing: ReadonlyArray<{ title: string; due: string }>, item: Pick<AbsorbItem, "title" | "date">): boolean {
	return existing.some((d) => d.due.slice(0, 10) === item.date && similarTitles(d.title, item.title));
}

/** The items not yet covered; items of one note that duplicate each other collapse to the first. */
export function newItems<T extends Pick<AbsorbItem, "title" | "date">>(existing: ReadonlyArray<{ title: string; due: string }>, items: readonly T[]): T[] {
	const pool = [...existing];
	const out: T[] = [];
	for (const item of items) {
		if (alreadyHasItem(pool, item)) continue;
		pool.push({ title: item.title, due: item.date });
		out.push(item);
	}
	return out;
}

/** The deadline's `due`: a date, or a local date-time when the note names a time. */
export const dueOf = (item: Pick<AbsorbItem, "date" | "time">): string => (item.time ? `${item.date}T${item.time}` : item.date);

// ── memory block ────────────────────────────────────────────────────────────────────────────────────────────────

const markerOf = (externalId: string) => `<!-- planner-note:${externalId.replace(/-->/g, "--&gt;")} -->`;
const END = "<!-- /planner-note -->";

/** `context` with the block of this note replaced (or appended); empty knowledge removes the block. */
export function replaceNoteBlock(context: string, note: { externalId: string; title: string; date: string }, knowledge: string): string {
	const marker = markerOf(note.externalId);
	let base = context;
	const start = base.indexOf(marker);
	if (start >= 0) {
		const end = base.indexOf(END, start);
		const stop = end >= 0 ? end + END.length : base.length;
		base = (base.slice(0, start).trimEnd() + "\n\n" + base.slice(stop).trimStart()).trim();
	}
	const body = knowledge.trim();
	if (!body) return base;
	const block = `${marker}\n## From Planner note: ${note.title} (${note.date})\n\n${body}\n${END}`;
	return base ? `${base}\n\n${block}` : block;
}
