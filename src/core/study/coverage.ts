/**
 * What a notebook covers (owner 2026-11-19): "a note can refer to at most 32 pages of topic files", the learner
 * chooses which files and pages, and the file list shows which pages are already covered by which notes.
 * Pure.
 */
import type { Material } from "./model.ts";

/** The most source pages (PDF pages, slides, or a text file's pages) one notebook may summarise. */
export const MAX_SOURCE_PAGES = 32;

export interface Coverage { materialId: string; from: number; to: number }

const span = (c: Coverage) => c.to - c.from + 1;

/** The pages of a file this scope uses (a file shared by two topics covers different pages in each). */
const usable = (m: Material) => ({ from: m.pages?.from ?? 1, to: m.pages?.to ?? m.pageCount });

/**
 * Clean a requested coverage against the files: unknown files dropped, ranges clamped to the file (and to the part
 * this scope uses), merged per file, and cut so the total never exceeds MAX_SOURCE_PAGES. With nothing requested,
 * the files in order from their first page until the limit is reached.
 */
export function normalizeCoverage(files: readonly Material[], requested?: readonly Coverage[]): Coverage[] {
	const byId = new Map(files.map((m) => [m.id, m]));
	const wanted: Coverage[] = requested
		? requested.flatMap((c) => {
			const m = byId.get(c.materialId);
			if (!m) return [];
			const u = usable(m);
			const from = Math.max(u.from, Math.min(u.to, Math.round(Number(c.from) || u.from)));
			const to = Math.max(from, Math.min(u.to, Math.round(Number(c.to) || u.to)));
			return [{ materialId: m.id, from, to }];
		})
		: files.map((m) => ({ materialId: m.id, ...usable(m) }));
	const out: Coverage[] = [];
	let left = MAX_SOURCE_PAGES;
	for (const c of wanted) {
		if (left <= 0) break;
		const to = Math.min(c.to, c.from + left - 1);
		const prev = out.find((o) => o.materialId === c.materialId && c.from <= o.to + 1 && to >= o.from - 1);
		if (prev) { const before = span(prev); prev.from = Math.min(prev.from, c.from); prev.to = Math.max(prev.to, to); left -= span(prev) - before; }
		else { out.push({ materialId: c.materialId, from: c.from, to }); left -= to - c.from + 1; }
	}
	return out;
}

export const coveredPages = (coverage: readonly Coverage[]): number => coverage.reduce((n, c) => n + span(c), 0);

/** Per file: which notebooks cover which of its pages, and how many of its pages no notebook covers yet. */
export function coverageByFile(
	files: readonly Material[],
	notebooks: ReadonlyArray<{ id: string; title: string; scopeName: string; href: string; covers?: readonly Coverage[] }>,
): Map<string, { parts: Array<{ notebookId: string; title: string; scopeName: string; href: string; from: number; to: number }>; uncovered: number }> {
	const out = new Map<string, { parts: Array<{ notebookId: string; title: string; scopeName: string; href: string; from: number; to: number }>; uncovered: number }>();
	for (const m of files) {
		const parts = notebooks.flatMap((n) => (n.covers ?? []).filter((c) => c.materialId === m.id).map((c) => ({ notebookId: n.id, title: n.title, scopeName: n.scopeName, href: n.href, from: c.from, to: c.to })));
		const u = usable(m);
		const seen = new Set<number>();
		for (const p of parts) for (let n = Math.max(p.from, u.from); n <= Math.min(p.to, u.to); n++) seen.add(n);
		out.set(m.id, { parts, uncovered: u.to - u.from + 1 - seen.size });
	}
	return out;
}
