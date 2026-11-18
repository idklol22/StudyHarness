/**
 * The plugin backend's `documents` service (Study redesign, owner 2026-11-18): page counts and
 * native page rendering for a local PDF the learner pointed at, so a plugin tool can turn slides
 * into images (for a vision model and for slide screenshots in notes) and text.
 *
 * Access follows the agent's read tools exactly: `resolveSourcePath` applies the mandatory
 * sensitive-location denials and the optional allowed-folders boundary. Rendering reuses the
 * pdf-reader's in-process pdfjs + Skia path (no browser, no model cost) with its memory bounds.
 */
import { resolveSourcePath } from "../agent/tools/fs-shared.ts";
import { getHeadless } from "../agent/subagents/headless.ts";
import { pdfExtract } from "../agent/subagents/pdf-ops.ts";
import { PLUGIN_RENDER_MAX_PAGES, type PluginDocumentService, type PluginRenderedPage } from "../core/plugins.ts";

const MAX_TEXT = 8_000;

/** Width/height from a PNG's IHDR chunk (bytes 16–23, big-endian). */
export function pngSize(png: Buffer): { width: number; height: number } {
	if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) throw new Error("Rendered page is not a PNG");
	return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function readablePdf(path: unknown): string {
	if (typeof path !== "string" || !path.trim()) throw new Error("Give the path of a PDF file.");
	const absolute = resolveSourcePath(path.trim());
	if (!/\.pdf$/i.test(absolute)) throw new Error("Only PDF files can be rendered. Export slides (PowerPoint, Keynote) to PDF first.");
	return absolute;
}

/** Text of one page from pdf_extract's `--- Page N ---` output. */
function pageText(markdown: string): string {
	return markdown.replace(/^--- Page \d+ ---\n?/, "").trim().slice(0, MAX_TEXT);
}

export function createPluginDocumentService(): PluginDocumentService {
	return {
		async pdfInfo(path) {
			const absolute = readablePdf(path);
			const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
			const fs = await import("node:fs/promises");
			const task = pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(absolute)), verbosity: 0 });
			try {
				const doc = await task.promise;
				return { path: absolute, pageCount: doc.numPages };
			} finally {
				await task.destroy().catch(() => {});
			}
		},
		async renderPdfPages(input) {
			if (!input || typeof input !== "object") throw new Error("Expected {path, pages}.");
			const absolute = readablePdf(input.path);
			const pages = Array.isArray(input.pages) ? [...new Set(input.pages)] : [];
			if (!pages.length || pages.some((n) => !Number.isInteger(n) || n < 1)) throw new Error("Pages must be 1-based whole numbers.");
			if (pages.length > PLUGIN_RENDER_MAX_PAGES) throw new Error(`Render at most ${PLUGIN_RENDER_MAX_PAGES} pages per call.`);
			const dpi = input.dpi ?? 110;
			if (!Number.isFinite(dpi) || dpi < 50 || dpi > 200) throw new Error("dpi must be between 50 and 200.");
			const rendered = await getHeadless().renderPdfPages(absolute, pages, { dpi });
			const out: PluginRenderedPage[] = [];
			for (const r of rendered) {
				const { width, height } = pngSize(r.png);
				let text = "";
				try { text = pageText(await pdfExtract(absolute, String(r.page))); } catch { /* image-only page: no text */ }
				out.push({ page: r.page, png: r.png.toString("base64"), width, height, text });
			}
			return out;
		},
	};
}
