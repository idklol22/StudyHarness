/**
 * Pure matcher for "(<file name>, p. N)" citations in assistant text. A match
 * must name a material of the chat's subject (by file name or meta title);
 * unknown names and out-of-range pages are left as plain text.
 */
export interface CitationMaterial { id: string; fileName: string; pageCount: number; title?: string }
export interface CitationMatch { start: number; end: number; materialId: string; page: number; text: string }

const norm = (s: string) => s.toLowerCase().replace(/\.(pdf|md|txt|markdown)$/i, "").replace(/[\s_]+/g, " ").trim();

/** `(name, p. 4)`, `(name, pp. 4-6)` and `(name p. 4)`; the first page of a range wins. */
const PATTERN = /\(([^()\n]{1,200}?)[,;]?\s+pp?\.\s*(\d{1,5})(?:\s*[-–]\s*\d{1,5})?\)/g;
const WRAP = /^["'“‘*_`]+|["'”’*_`]+$/g;

export function findMaterial(name: string, materials: readonly CitationMaterial[]): CitationMaterial | undefined {
	const n = norm(name.replace(WRAP, ""));
	if (!n) return undefined;
	return materials.find((m) => norm(m.fileName) === n || (m.title && norm(m.title) === n))
		?? materials.find((m) => n.length >= 4 && (norm(m.fileName).includes(n) || (m.title ? norm(m.title).includes(n) : false)));
}

export function findCitations(text: string, materials: readonly CitationMaterial[]): CitationMatch[] {
	const out: CitationMatch[] = [];
	if (!materials.length) return out;
	for (const m of text.matchAll(PATTERN)) {
		const material = findMaterial(m[1] ?? "", materials);
		const page = Number(m[2]);
		if (!material || page < 1 || (material.pageCount > 0 && page > material.pageCount)) continue;
		out.push({ start: m.index, end: m.index + m[0].length, materialId: material.id, page, text: m[0] });
	}
	return out;
}

/** Markdown carrier for a citation: an inline-code span the renderer swaps for a clickable chip. */
const TOKEN = /^lh-cite\|([^|]+)\|(\d+)\|([\s\S]*)$/;
export const citationToken = (materialId: string, page: number, label: string) =>
	`\`lh-cite|${encodeURIComponent(materialId)}|${page}|${label.replace(/[`|]/g, "")}\``;
export function parseCitationToken(code: string): { materialId: string; page: number; label: string } | null {
	const m = TOKEN.exec(code);
	return m ? { materialId: decodeURIComponent(m[1]!), page: Number(m[2]), label: m[3]! } : null;
}

/** Rewrites matches as citation tokens (skipping fenced code) so the renderer shows them as chips. */
export function linkCitations(text: string, materials: readonly CitationMaterial[]): string {
	if (!materials.length || !/pp?\./.test(text)) return text;
	return text.split(/(```[\s\S]*?(?:```|$))/g).map((chunk, i) => {
		if (i % 2 === 1) return chunk;
		const hits = findCitations(chunk, materials);
		let result = "", at = 0;
		for (const h of hits) {
			result += chunk.slice(at, h.start) + citationToken(h.materialId, h.page, h.text);
			at = h.end;
		}
		return result + chunk.slice(at);
	}).join("");
}
