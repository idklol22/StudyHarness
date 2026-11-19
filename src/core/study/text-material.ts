/**
 * Text materials (markdown / plain text): a text file is cut into virtual "pages" so it works with the same
 * page memory, lookup and notes as a PDF. Pure; no model call is needed to read it, the text IS the content.
 */
import { PAGE_TEXT_CAP, type TocEntry } from "./material-memory.ts";

export const TEXT_EXTENSIONS = [".md", ".markdown", ".txt"] as const;
export const isTextName = (name: string): boolean => TEXT_EXTENSIONS.some((e) => name.toLowerCase().endsWith(e));

const PAGE_CHARS = PAGE_TEXT_CAP - 100;

/** Split at paragraph (then line, then hard) boundaries into pages of at most ~2.4k characters. Never empty. */
export function textPages(source: string): string[] {
	const text = source.replace(/\r\n?/g, "\n").trim();
	if (!text) return [""];
	const pages: string[] = [];
	let current = "";
	const flush = () => { if (current.trim()) pages.push(current.trim()); current = ""; };
	for (const paragraph of text.split(/\n{2,}/)) {
		// A paragraph longer than a page is cut on line, then character, boundaries.
		const pieces: string[] = [];
		let rest = paragraph;
		while (rest.length > PAGE_CHARS) {
			const cut = rest.lastIndexOf("\n", PAGE_CHARS) > PAGE_CHARS / 2 ? rest.lastIndexOf("\n", PAGE_CHARS) : rest.lastIndexOf(" ", PAGE_CHARS) > PAGE_CHARS / 2 ? rest.lastIndexOf(" ", PAGE_CHARS) : PAGE_CHARS;
			pieces.push(rest.slice(0, cut));
			rest = rest.slice(cut).trimStart();
		}
		pieces.push(rest);
		for (const piece of pieces) {
			if (current && current.length + piece.length + 2 > PAGE_CHARS) flush();
			current += (current ? "\n\n" : "") + piece;
		}
	}
	flush();
	return pages.length ? pages : [""];
}

/** Markdown headings (or, failing that, nothing) as contents entries pointing at the page they start on. */
export function textOutline(pages: readonly string[]): { toc: TocEntry[]; concepts: string[]; summary: string } {
	const toc: TocEntry[] = [];
	pages.forEach((page, i) => {
		for (const line of page.split("\n")) {
			const m = line.match(/^#{1,4}\s+(.+?)\s*#*$/);
			if (m) toc.push({ title: m[1]!.slice(0, 120), page: i + 1 });
		}
	});
	const first = (pages[0] ?? "").split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").slice(0, 160) ?? "";
	return { toc: toc.slice(0, 80), concepts: toc.slice(0, 20).map((t) => t.title), summary: first ? `Text file starting “${first}”, ${pages.length} page${pages.length === 1 ? "" : "s"}.` : `${pages.length} page${pages.length === 1 ? "" : "s"} of text.` };
}
