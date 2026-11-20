/**
 * Subject/topic Overview (Task 4): pure composition of the To-do list, the coverage numbers and the recent-activity
 * list. No IO, no React — the client component feeds it the library plus the small progress/cards payloads.
 */
import { readMaterialMeta, sortMaterials } from "./lecture-meta.ts";
import { upcoming } from "./deadlines.ts";
import { materialsUnder, type Deadline, type Library, type Material, type StudyScope } from "./model.ts";

const DAY = 86_400_000;

export interface MaterialProgress { id: string; pageCount: number; readPages: number; notedPages: number }

export interface TodoItem {
	id: string;
	label: string;
	href: string;
	/** Overdue deadlines are red. */
	danger?: boolean;
}

export const scopePath = (scope: StudyScope): string => `/subjects/${scope.subjectId}${scope.topicId ? `/${scope.topicId}` : ""}`;

/** A file's display title: the learner's edited lecture title when there is one, else its file name. */
export function materialTitle(m: Material): string {
	if (!m.meta) return m.fileName;
	try { return readMaterialMeta(m.meta).title ?? m.fileName; } catch { return m.fileName; }
}

export const clamp = (n: number, max: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : 0);

/** Whole calendar days from `now` to `due` (negative = overdue). */
export function daysUntil(due: string, now: Date | number = new Date()): number {
	const at = typeof now === "number" ? now : now.getTime();
	const date = new Date(due);
	if (!Number.isFinite(date.getTime())) return 0;
	const day = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY; };
	return day(date.getTime()) - day(at);
}

export function relativeDue(due: string, now: Date | number = new Date()): string {
	const days = daysUntil(due, now);
	if (days < 0) return `${-days} day${days === -1 ? "" : "s"} overdue`;
	if (days === 0) return "today";
	if (days === 1) return "tomorrow";
	return `in ${days} days`;
}

export function deadlineLabel(d: Deadline, now: Date | number = new Date()): string {
	const kind = d.kind.charAt(0).toUpperCase() + d.kind.slice(1);
	const days = daysUntil(d.due, now);
	return `${kind} ${d.title} ${days < 0 ? relativeDue(d.due, now) : `due ${relativeDue(d.due, now)}`}`;
}

export interface TodoInput {
	scope: StudyScope;
	library: Library;
	now: Date | number;
	/** Flashcards due now in this scope. */
	dueCards: number;
	/** Per-file progress from GET /api/study/progress. */
	progress: readonly MaterialProgress[];
}

/**
 * What to do next, in priority order: due cards, deadlines inside 14 days, never-covered files, waiting suggestions.
 * An empty list means the learner is caught up.
 */
export function buildTodo({ scope, library, now, dueCards, progress }: TodoInput): TodoItem[] {
	const base = scopePath(scope);
	const out: TodoItem[] = [];
	if (dueCards > 0) out.push({ id: "cards", label: `${dueCards} flashcard${dueCards === 1 ? "" : "s"} due`, href: `${base}#flashcards` });

	for (const d of upcoming(library, scope.subjectId, now, scope.topicId)) {
		const days = daysUntil(d.due, now);
		if (days > 14) continue;
		out.push({ id: `deadline:${d.id}`, label: deadlineLabel(d, now), href: `${base}#deadlines`, ...(days < 0 ? { danger: true } : {}) });
	}

	const files = sortMaterials(materialsUnder(library, scope), "lecture");
	const byId = new Map(progress.map((p) => [p.id, p]));
	const untouched = files.filter((m) => { const p = byId.get(m.id); return !p || (p.readPages === 0 && p.notedPages === 0); });
	untouched.slice(0, 5).forEach((m) => out.push({ id: `file:${m.id}`, label: `Not covered yet: ${materialTitle(m)}`, href: `/subjects/${scope.subjectId}/read/${m.id}` }));
	if (untouched.length > 5) out.push({ id: "more-files", label: `+${untouched.length - 5} more`, href: `${base}#files` });

	const materialIds = new Set(files.map((m) => m.id));
	const waiting = (library.suggestions ?? []).filter((s) => materialIds.has(s.materialId)).length;
	if (waiting > 0) out.push({ id: "suggestions", label: "Topic suggestions waiting", href: `${base}#files` });
	return out;
}

export interface CoverageRow {
	materialId: string;
	pageCount: number;
	readPages: number;
	notedPages: number;
	readPct: number;
	notedPct: number;
	title: string;
}

export const percent = (part: number, total: number): number => (total > 0 ? Math.round((clamp(part, total) / total) * 100) : 0);

/** Coverage per file, in lecture order; percentages are fractions of the file's page count. */
export function coverageRows(files: readonly Material[], progress: readonly MaterialProgress[]): CoverageRow[] {
	const byId = new Map(progress.map((p) => [p.id, p]));
	return sortMaterials(files, "lecture").map((m) => {
		const p = byId.get(m.id);
		const pageCount = Math.max(1, m.pageCount);
		const readPages = clamp(p?.readPages ?? 0, pageCount);
		const notedPages = clamp(p?.notedPages ?? 0, pageCount);
		return { materialId: m.id, title: materialTitle(m), pageCount, readPages, notedPages, readPct: percent(readPages, pageCount), notedPct: percent(notedPages, pageCount) };
	});
}

export interface CoverageTotals { pages: number; readPages: number; notedPages: number; readPct: number; notedPct: number }
export function coverageTotals(rows: readonly CoverageRow[]): CoverageTotals {
	const pages = rows.reduce((n, r) => n + r.pageCount, 0);
	const readPages = rows.reduce((n, r) => n + r.readPages, 0);
	const notedPages = rows.reduce((n, r) => n + r.notedPages, 0);
	return { pages, readPages, notedPages, readPct: percent(readPages, pages), notedPct: percent(notedPages, pages) };
}

/** The sidebar's relative-time wording, kept here so this module stays pure and independent of the shell. */
export function timeAgo(iso: string, now: Date | number = new Date()): string {
	const at = typeof now === "number" ? now : now.getTime();
	const ms = at - new Date(iso).getTime();
	if (!Number.isFinite(ms) || ms < 60_000) return "just now";
	const min = Math.floor(ms / 60_000);
	if (min < 60) return `${min}m ago`;
	const h = Math.floor(min / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	if (d < 7) return `${d}d ago`;
	const date = new Date(iso);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export interface RecentInput {
	scope: StudyScope;
	library: Library;
	chats: ReadonlyArray<{ id: string; title: string; updatedAt: string; placement?: { subjectId: string; topicId?: string } }>;
	notebooks: ReadonlyArray<{ id: string; title: string; createdAt: string; href: string; topicId?: string }>;
	limit?: number;
}
export interface RecentItem { id: string; kind: "file" | "chat" | "note"; title: string; at: string; href: string }

/** The last `limit` additions/updates across files, chats and saved notes of this scope. */
export function recentItems({ scope, library, chats, notebooks, limit = 5 }: RecentInput): RecentItem[] {
	const files: RecentItem[] = materialsUnder(library, scope).map((m) => ({
		id: `file:${m.id}`, kind: "file", title: materialTitle(m), at: m.addedAt, href: `/subjects/${scope.subjectId}/read/${m.id}`,
	}));
	const scopeChats: RecentItem[] = chats
		.filter((c) => c.placement?.subjectId === scope.subjectId && (scope.topicId === undefined || c.placement.topicId === scope.topicId))
		.map((c) => ({ id: `chat:${c.id}`, kind: "chat", title: c.title, at: c.updatedAt, href: `/chat/${c.id}` }));
	const scopeNotes: RecentItem[] = notebooks
		.filter((n) => scope.topicId === undefined || n.topicId === scope.topicId || n.topicId === undefined)
		.map((n) => ({ id: `note:${n.id}`, kind: "note", title: n.title, at: n.createdAt, href: n.href }));
	return [...files, ...scopeChats, ...scopeNotes]
		.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
		.slice(0, limit);
}
