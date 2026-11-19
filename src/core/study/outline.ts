/**
 * A compact outline of a whole document from its page texts, for suggesting topics and ideas without a model
 * reading every page (owner 2026-11-19: "convert the PDF to text and read that text; based on that, create topics").
 * Each page contributes its heading-like lines and its opening words; the result is bounded so even a 600-page
 * book fits one cheap-model call. Pure.
 */

const HEADING = /^(#{1,4}\s+.+|(?:chapter|section|part|unit|lecture|module|week|topic)\b.{0,70}|\d+(?:\.\d+)*\s+[A-Z].{2,70}|[A-Z][^.!?:;]{2,60})$/i;

/** Heading-like lines of a page: markdown headings, "Chapter 3 …", "2.1 Title", or a short line without a full stop. */
export function headingsOf(text: string, max = 4): string[] {
	const out: string[] = [];
	for (const raw of text.split("\n")) {
		const line = raw.replace(/\s+/g, " ").trim();
		if (line.length < 3 || line.length > 80) continue;
		if (/^[-*•\d.)\s]+$/.test(line)) continue;
		if (!HEADING.test(line)) continue;
		const clean = line.replace(/^#+\s*/, "");
		if (!out.includes(clean)) out.push(clean);
		if (out.length >= max) break;
	}
	return out;
}

/** The first `n` characters of a page's prose (headings and markdown markers stripped). */
function opening(text: string, n: number): string {
	return text.replace(/^#+\s.*$/gm, "").replace(/[#*_`>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
}

export interface OutlineInput {
	/** Page number → text (missing or empty pages are skipped). */
	pages: Readonly<Record<number, string>>;
	pageCount: number;
	/** Contents entries already known (printed page numbers). */
	toc?: ReadonlyArray<{ title: string; page: number }>;
}

/**
 * "p12: [Dynamic programming | 3.1 Memoization] We now turn to …" per page, within `budget` characters. When the
 * document is too long, each page's opening shrinks first; then pages without headings are thinned out evenly,
 * so every heading survives.
 */
export function documentOutline({ pages, pageCount, toc = [] }: OutlineInput, budget = 40000): string {
	const nums = Object.keys(pages).map(Number).filter((n) => n >= 1 && (pages[n] ?? "").trim()).sort((a, b) => a - b);
	const head = toc.length ? `Contents: ${toc.slice(0, 80).map((t) => `${t.title} (p.${t.page})`).join("; ")}\n` : "";
	const covered = `${nums.length} of ${pageCount} pages have text.\n`;
	const rows = nums.map((n) => ({ n, heads: headingsOf(pages[n]!), text: pages[n]! }));
	const render = (each: number, keep: (r: (typeof rows)[number], i: number) => boolean) =>
		rows.filter(keep).map((r) => `p${r.n}: ${r.heads.length ? `[${r.heads.join(" | ")}] ` : ""}${opening(r.text, each)}`.trimEnd()).join("\n");
	const room = Math.max(0, budget - head.length - covered.length);
	for (const each of [150, 90, 50, 0]) {
		const body = render(each, () => true);
		if (body.length <= room) return head + covered + body;
	}
	// Still too long: keep every page with headings, and an even sample of the others.
	const plain = rows.filter((r) => !r.heads.length).length || 1;
	for (let step = 2; step <= rows.length; step *= 2) {
		let k = 0;
		const body = render(40, (r) => r.heads.length > 0 || k++ % step === 0);
		if (body.length <= room) return head + covered + body;
		if (step > plain) break;
	}
	return (head + covered + render(0, (r) => r.heads.length > 0)).slice(0, budget);
}

/** Pages to skim with the vision reader on upload: 20% of the document, at most 8, at least 1. */
export const skimPageCount = (pageCount: number): number => Math.max(1, Math.min(8, Math.ceil(pageCount * 0.2)));
