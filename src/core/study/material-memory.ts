/**
 * Material memory (Study overhaul, owner 2026-11-19): "if it reads 5 pages in one go it should remember
 * them and not reread; to find something it should look in memory, see which chunk of pages it is, and
 * use the index to jump straight to e.g. the exercises, a page above or below".
 *
 * One memory per stored PDF (keyed by its SHA-256, so every scope sharing the file shares the memory):
 *   read:   page numbers already read (never read again unless asked);
 *   pages:  {n: text} each page's own text (capped) for lookups without reopening the PDF;
 *   chunks: one per batch the vision model read: page range, a short summary, the concepts found;
 *   toc:    entries of a table of contents / index page (printed page numbers).
 * Lookups return compact excerpts so the chat's context is not flooded. Pure; the store persists it.
 */

export const PAGE_TEXT_CAP = 2500;

export interface MemoryChunk { from: number; to: number; summary: string; concepts: string[]; /** Diagrams/plots/worked examples worth showing later (used by notes). */ figures?: Array<{ page: number; caption: string }> }
export interface TocEntry { title: string; page: number }
export interface MaterialMemory {
	read: number[];
	pages: Record<number, string>;
	chunks: MemoryChunk[];
	toc: TocEntry[];
}

export const emptyMemory = (): MaterialMemory => ({ read: [], pages: {}, chunks: [], toc: [] });

const STOP = new Set("the a an and or of to in on for with is are be by as at from this that these those it its what which how where when page pages slide slides about".split(" "));

export const words = (s: unknown): string[] =>
	String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));

/** "1-12, 20, 30-34" → sorted unique page numbers within 1..max ("all"/empty = every page). */
export function parseRange(spec: unknown, max: number): number[] {
	if (spec == null || String(spec).trim() === "" || String(spec).trim().toLowerCase() === "all") return Array.from({ length: max }, (_, i) => i + 1);
	const out = new Set<number>();
	for (const part of String(spec).split(",")) {
		const text = part.trim();
		const m = text.match(/^(\d+)\s*(?:-|–|to)\s*(\d+)$/) ?? text.match(/^(\d+)$/);
		if (!m) throw new Error(`Could not read the page range "${text}". Use e.g. "1-12, 20, 30-34".`);
		const a = Number(m[1]), b = Number(m[2] ?? m[1]);
		for (let n = Math.min(a, b); n <= Math.max(a, b); n++) if (n >= 1 && n <= max) out.add(n);
	}
	return [...out].sort((x, y) => x - y);
}

/** Remember one batch: page texts, a summary, the concepts found, any table-of-contents entries. */
export function recordBatch(memory: MaterialMemory, batch: { pages: Array<{ n: number; text: string }>; summary?: string; concepts?: string[]; toc?: TocEntry[]; figures?: Array<{ page: number; caption: string }> }): MaterialMemory {
	const nums = batch.pages.map((p) => p.n).sort((a, b) => a - b);
	if (!nums.length) return memory;
	const pages = { ...memory.pages };
	for (const p of batch.pages) pages[p.n] = String(p.text ?? "").slice(0, PAGE_TEXT_CAP);
	const chunks = memory.chunks.filter((c) => !(c.from === nums[0] && c.to === nums.at(-1)));
	chunks.push({ from: nums[0]!, to: nums.at(-1)!, summary: String(batch.summary ?? "").slice(0, 600), concepts: (batch.concepts ?? []).slice(0, 20), ...(batch.figures?.length ? { figures: batch.figures.slice(0, 12).map((f) => ({ page: f.page, caption: String(f.caption).slice(0, 160) })) } : {}) });
	chunks.sort((a, b) => a.from - b.from);
	const toc = [...memory.toc];
	for (const e of batch.toc ?? []) if (!toc.some((x) => x.title.toLowerCase() === e.title.toLowerCase())) toc.push(e);
	return { read: [...new Set([...memory.read, ...nums])].sort((a, b) => a - b), pages, chunks, toc };
}

/** Add page texts without a summary (pages fetched on demand, no model call). */
export function recordPages(memory: MaterialMemory, pages: Array<{ n: number; text: string }>): MaterialMemory {
	const next = { ...memory.pages };
	for (const p of pages) next[p.n] = String(p.text ?? "").slice(0, PAGE_TEXT_CAP);
	return { ...memory, pages: next };
}

/** Which of the wanted pages have not been READ (model-read) yet. */
export const unread = (memory: MaterialMemory, wanted: readonly number[]): number[] => {
	const done = new Set(memory.read);
	return wanted.filter((n) => !done.has(n));
};

const lowerTitle = (e: TocEntry) => e.title.toLowerCase().slice(0, 60);
/** A page whose text lists several contents entries IS a contents/index page, never a chapter's page. */
const listsMany = (memory: MaterialMemory, text: string) => memory.toc.filter((e) => text.toLowerCase().includes(lowerTitle(e))).length >= 2;

/** Printed page number → PDF page: where the entry's heading actually appears near that printed page,
 *  else an offset learned from another entry (front matter shifts printed numbers). */
export function resolvePrinted(memory: MaterialMemory, entry: TocEntry): { page: number; offset: number; confirmed: boolean } {
	const title = lowerTitle(entry);
	const known = Object.keys(memory.pages).map(Number).filter((n) => !listsMany(memory, String(memory.pages[n]))).sort((a, b) => a - b);
	let best: number | null = null;
	for (const n of known) {
		if (!String(memory.pages[n]).toLowerCase().includes(title)) continue;
		const d = n - entry.page;
		if (d < -2 || d > 40) continue;
		if (best === null || Math.abs(d) < Math.abs(best - entry.page)) best = n;
	}
	if (best !== null) return { page: best, offset: best - entry.page, confirmed: true };
	for (const other of memory.toc) {
		if (other === entry) continue;
		const o = lowerTitle(other);
		const hit = known.find((n) => n - other.page >= -2 && n - other.page <= 40 && String(memory.pages[n]).toLowerCase().includes(o));
		if (hit !== undefined) return { page: entry.page + (hit - other.page), offset: hit - other.page, confirmed: false };
	}
	return { page: entry.page, offset: 0, confirmed: false };
}

function snippet(text: string, terms: string[], len = 280): string {
	const t = String(text ?? "").replace(/\s+/g, " ").trim();
	if (!t) return "";
	const lower = t.toLowerCase();
	const first = Math.min(...terms.map((w) => { const i = lower.indexOf(w); return i < 0 ? Infinity : i; }));
	const start = Number.isFinite(first) ? Math.max(0, first - 80) : 0;
	return (start > 0 ? "…" : "") + t.slice(start, start + len) + (start + len < t.length ? "…" : "");
}

export type Lookup =
	| { kind: "pages"; pages: Array<{ n: number; text: string }>; missing: number[] }
	| { kind: "overview"; chunks: MemoryChunk[]; toc: TocEntry[]; read: number[] }
	| { kind: "search"; toc: Array<{ title: string; printed: number; page: number; confirmed: boolean; around: number[] }>; chunks: MemoryChunk[]; pages: Array<{ n: number; excerpt: string }> };

/**
 * Answer from memory. With `pages`: their stored text (missing ones are listed, to be fetched on demand).
 * With `query`: contents hits (resolved to PDF pages, with the page before/after), the best page ranges
 * by their summaries, and the best single pages with short excerpts.
 */
export function lookup(memory: MaterialMemory, input: { query?: string; pages?: readonly number[] } = {}): Lookup {
	if (input.pages?.length) {
		const have = input.pages.filter((n) => memory.pages[n] !== undefined);
		return { kind: "pages", pages: have.map((n) => ({ n, text: memory.pages[n]! })), missing: input.pages.filter((n) => memory.pages[n] === undefined) };
	}
	const terms = words(input.query);
	if (!terms.length) return { kind: "overview", chunks: memory.chunks, toc: memory.toc, read: memory.read };
	const score = (text: string) => { const w = words(text); return terms.reduce((s, t) => s + w.filter((x) => x === t || x.startsWith(t)).length, 0); };
	const toc = memory.toc
		.map((e) => ({ e, s: score(e.title) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3)
		.map(({ e }) => { const r = resolvePrinted(memory, e); return { title: e.title, printed: e.page, page: r.page, confirmed: r.confirmed, around: [r.page - 1, r.page, r.page + 1].filter((n) => n >= 1) }; });
	const chunks = memory.chunks
		.map((c) => ({ c, s: score(c.summary) + 2 * score(c.concepts.join(" ")) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3).map(({ c }) => c);
	const pages = Object.entries(memory.pages)
		.map(([n, text]) => ({ n: Number(n), s: score(text) * (listsMany(memory, text) ? 0.3 : 1), text }))
		.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.n - b.n).slice(0, 5)
		.map((x) => ({ n: x.n, excerpt: snippet(x.text, terms) }));
	return { kind: "search", toc, chunks, pages };
}

/** Compact text for the model (bounded so lookups never flood the context). */
export function formatLookup(fileName: string, r: Lookup): string {
	const out: string[] = [];
	if (r.kind === "pages") {
		for (const p of r.pages) out.push(`--- ${fileName} page ${p.n} ---\n${p.text || "(no text on this page; it may be a figure — show it in the notes instead)"}`);
		if (r.missing.length) out.push(`Not stored yet: pages ${r.missing.join(", ")}.`);
	} else if (r.kind === "overview") {
		out.push(`${fileName}: read pages ${r.read.length ? `${r.read[0]}–${r.read.at(-1)} (${r.read.length})` : "none yet"}.`);
		if (r.toc.length) out.push("Contents: " + r.toc.slice(0, 40).map((e) => `${e.title} (p.${e.page})`).join("; "));
		for (const c of r.chunks) out.push(`pages ${c.from}–${c.to}: ${c.summary}${c.concepts.length ? ` [${c.concepts.join(", ")}]` : ""}`);
	} else {
		if (r.toc.length) out.push("From the contents: " + r.toc.map((t) => `"${t.title}" printed p.${t.printed} → PDF page ${t.page}${t.confirmed ? "" : " (estimated)"}; look at pages ${t.around.join(", ")}`).join("; "));
		for (const c of r.chunks) out.push(`pages ${c.from}–${c.to}: ${c.summary}`);
		for (const p of r.pages) out.push(`page ${p.n}: ${p.excerpt}`);
		if (!out.length) out.push("Nothing in the pages read so far matches. Read more pages (a page range) or try other words.");
	}
	return out.join("\n");
}
