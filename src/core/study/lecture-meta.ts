/**
 * Lecture metadata (Task 1b): a file's name (then its first page) often says which lecture it belongs to,
 * when it was made and what shape it has. Pure: no IO, no model calls. The UI also uses these rules for
 * materials uploaded before metadata was stored, so old files need no migration.
 */
import { NAME_MAX, type Material } from "./model.ts";

export type MaterialMeta = NonNullable<Material["meta"]>;
export type MaterialKind = NonNullable<MaterialMeta["kind"]>;

// Underscores are word characters in JS regexes but separators in file names, so the edges use explicit
// lookarounds instead of \b (otherwise "L5_notes.pdf" and "2026-11-12_Lec05.pdf" would not match).
const LECTURE_SOURCE = "(?<![A-Za-z0-9])(?:lecture|lec|l|week|w|class|session)[\\s._-]*0*(\\d{1,3})(?![A-Za-z0-9])";
const DATE_ISO_SOURCE = "(?<![A-Za-z0-9])(\\d{4})-(\\d{2})-(\\d{2})(?![A-Za-z0-9])";
const DATE_NUMERIC_SOURCE = "(?<![A-Za-z0-9])(\\d{1,2})[./](\\d{1,2})[./](\\d{4})(?![A-Za-z0-9])";
const DATE_TEXT_SOURCE = "(?<![A-Za-z0-9])(\\d{1,2})\\s+([a-z]{3,})\\.?\\s+(\\d{4})(?![A-Za-z0-9])";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const KINDS: readonly MaterialKind[] = ["slides", "handwritten", "assignment", "other"];

const lectureRe = () => new RegExp(LECTURE_SOURCE, "gi");
const isoRe = () => new RegExp(DATE_ISO_SOURCE, "g");
const numericRe = () => new RegExp(DATE_NUMERIC_SOURCE, "g");
const textRe = () => new RegExp(DATE_TEXT_SOURCE, "gi");

/** A real calendar date in ISO form, or nothing (31 February is not a date). */
function isoDate(year: number, month: number, day: number): string | undefined {
	if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
	const date = new Date(Date.UTC(year, month - 1, day));
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
	return date.toISOString().slice(0, 10);
}

function lectureIn(text: string): number | undefined {
	const found = lectureRe().exec(text);
	return found ? Number(found[1]) : undefined;
}

/** Try each supported date spelling in this source; return the first valid ISO date. */
function dateIn(source: string): string | undefined {
	for (const match of source.matchAll(isoRe())) {
		const date = isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
		if (date) return date;
	}
	// The spec's numeric spellings are day-first (DD.MM.YYYY / DD/MM/YYYY).
	for (const match of source.matchAll(numericRe())) {
		const date = isoDate(Number(match[3]), Number(match[2]), Number(match[1]));
		if (date) return date;
	}
	for (const match of source.matchAll(textRe())) {
		const month = MONTHS.indexOf(match[2]!.slice(0, 3).toLowerCase());
		if (month < 0) continue;
		const date = isoDate(Number(match[3]), month + 1, Number(match[1]));
		if (date) return date;
	}
	return undefined;
}

function kindOf(fileName: string, firstPageText: string): MaterialKind {
	const name = fileName.toLowerCase();
	const text = firstPageText.toLowerCase();
	if (/assignment|homework|hw\s*\d|problem\s*set|exercise\s*sheet|quiz|exam/.test(name) || /assignment|homework|hw\s*\d|problem\s*set|exercise\s*sheet|quiz|exam/.test(text)) return "assignment";
	if (/notes|handwritten|scan/.test(name)) return "handwritten";
	if (/slides|lecture|lec|deck/.test(name)) return "slides";
	return "other";
}

/** A readable title: no extension, no lecture/date tokens, separators turned into spaces. */
function titleOf(fileName: string): string {
	const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[^./\\]+$/, "");
	const strip = (s: string) => s.replace(lectureRe(), " ").replace(isoRe(), " ").replace(numericRe(), " ").replace(textRe(), " ");
	// Strip tokens before and after separator normalisation: "2026-11-12_Lec05" and "12-Nov-2026" both work.
	const withoutTokens = strip(strip(base).replace(/[_-]+/g, " "))
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^[\s\-–—._()[\]]+|[\s\-–—._()[\]]+$/g, "")
		.trim();
	return withoutTokens || fileName;
}

/** Guess a file's lecture number, date, kind and title. File name wins over first-page text. */
export function guessLectureMeta(fileName: string, firstPageText = ""): MaterialMeta {
	const name = typeof fileName === "string" ? fileName : "";
	const text = typeof firstPageText === "string" ? firstPageText : "";
	const lecture = lectureIn(name) ?? lectureIn(text);
	const date = dateIn(name) ?? dateIn(text);
	return {
		...(lecture === undefined ? {} : { lecture }),
		...(date === undefined ? {} : { date }),
		kind: kindOf(name, text),
		title: titleOf(name),
	};
}

/** Validate a learner's edits (empty fields clear). Unknown fields are ignored. */
export function readMaterialMeta(raw: unknown): MaterialMeta {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Details must be an object.");
	const r = raw as Record<string, unknown>;
	const meta: MaterialMeta = {};
	const lecture = r.lecture;
	if (lecture !== undefined && lecture !== null && lecture !== "") {
		if (typeof lecture !== "number" || !Number.isInteger(lecture) || lecture < 0 || lecture > 9999) throw new Error("Lecture must be a whole number.");
		meta.lecture = lecture;
	}
	const date = r.date;
	if (date !== undefined && date !== null && date !== "") {
		if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !isoDate(Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10)))) throw new Error("Date must be a real date as YYYY-MM-DD.");
		meta.date = date;
	}
	const kind = r.kind;
	if (kind !== undefined && kind !== null && kind !== "") {
		if (typeof kind !== "string" || !KINDS.includes(kind as MaterialKind)) throw new Error("Choose a valid kind.");
		meta.kind = kind as MaterialKind;
	}
	const title = r.title;
	if (title !== undefined && title !== null && title !== "") {
		if (typeof title !== "string") throw new Error("Title must be text.");
		const clean = title.replace(/\s+/g, " ").trim();
		if (clean.length > NAME_MAX) throw new Error(`Title is at most ${NAME_MAX} characters.`);
		meta.title = clean;
	}
	if (r.source === "planner") {
		meta.source = "planner";
		if (typeof r.finished === "boolean") meta.finished = r.finished;
	}
	return meta;
}

const byName = (a: Material, b: Material) => a.fileName.localeCompare(b.fileName);

/**
 * Sort a copy of the list: by name or recently-added when asked, otherwise by lecture number, then date,
 * then name, with files that have no lecture number last. The input is never mutated.
 */
export function sortMaterials(list: readonly Material[], by: "lecture" | "name" | "added"): Material[] {
	const copy = [...list];
	if (by === "name") return copy.sort(byName);
	if (by === "added") return copy.sort((a, b) => b.addedAt.localeCompare(a.addedAt) || byName(a, b));
	return copy.sort((a, b) => {
		const al = a.meta?.lecture, bl = b.meta?.lecture;
		if (al === undefined || bl === undefined) {
			if (al !== bl) return al === undefined ? 1 : -1;
		} else if (al !== bl) return al - bl;
		const ad = a.meta?.date ?? "\uffff", bd = b.meta?.date ?? "\uffff";
		return ad.localeCompare(bd) || byName(a, b);
	});
}
