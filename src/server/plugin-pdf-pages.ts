/**
 * The plugin backend's `documents` service (Study redesign, 2026-11): page counts and native page
 * rendering for a local PDF the learner pointed at, so a plugin tool can turn slides into images
 * (for a vision model and for slide screenshots in notes) and text.
 *
 * Access follows the agent's read tools exactly: `resolveSourcePath` applies the mandatory
 * sensitive-location denials and the optional allowed-folders boundary.
 *
 * Speed (owner: "PDF reading is too slow"): one call opens the document ONCE, renders its pages with
 * pdfjs into @napi-rs/canvas (Skia, in process, no browser) using the pdf-reader's memory bounds,
 * encodes JPEG by default (several times smaller than PNG for slides, so model uploads are faster),
 * and extracts every requested page's text from that same open document.
 */
import * as fsp from "node:fs/promises";
import { resolveSourcePath } from "../agent/tools/fs-shared.ts";
import { pdfCanvasGeometry } from "../agent/subagents/headless.ts";
import { standardFontsDir } from "../agent/subagents/pdf-ops.ts";
import { documentToMarkdown } from "../agent/subagents/pdf-markdown.ts";
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

async function openPdf(absolute: string) {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const task = pdfjs.getDocument({ data: new Uint8Array(await fsp.readFile(absolute)), standardFontDataUrl: standardFontsDir(), verbosity: 0 });
	return { task, doc: await task.promise };
}

export function createPluginDocumentService(): PluginDocumentService {
	return {
		async pdfInfo(path) {
			const absolute = readablePdf(path);
			const { task, doc } = await openPdf(absolute);
			try { return { path: absolute, pageCount: doc.numPages }; }
			finally { await task.destroy().catch(() => {}); }
		},
		async renderPdfPages(input) {
			if (!input || typeof input !== "object") throw new Error("Expected {path, pages}.");
			const absolute = readablePdf(input.path);
			const pages = Array.isArray(input.pages) ? [...new Set(input.pages)] : [];
			if (!pages.length || pages.some((n) => !Number.isInteger(n) || n < 1)) throw new Error("Pages must be 1-based whole numbers.");
			if (pages.length > PLUGIN_RENDER_MAX_PAGES) throw new Error(`Render at most ${PLUGIN_RENDER_MAX_PAGES} pages per call.`);
			const dpi = input.dpi ?? 90;
			if (!Number.isFinite(dpi) || dpi < 50 || dpi > 200) throw new Error("dpi must be between 50 and 200.");
			const format = input.format ?? "jpeg";
			if (format !== "jpeg" && format !== "png") throw new Error("format must be jpeg or png.");
			const { createCanvas } = await import("@napi-rs/canvas");
			const { task, doc } = await openPdf(absolute);
			try {
				const wanted = pages.filter((n) => n <= doc.numPages);
				// All the batch's text in one pass over the already-open document.
				const texts = new Map<number, string>();
				try {
					for (const p of await documentToMarkdown(doc, wanted)) texts.set(p.number, p.kind === "text" ? p.markdown.trim().slice(0, MAX_TEXT) : "");
				} catch { /* image-only or unusual pages: no text */ }
				const out: PluginRenderedPage[] = [];
				for (const n of wanted) {
					const page = await doc.getPage(n);
					const base = page.getViewport({ scale: 1 });
					const geometry = pdfCanvasGeometry(base.width, base.height, dpi);
					const canvas = createCanvas(geometry.width, geometry.height);
					const ctx = canvas.getContext("2d");
					if (format === "jpeg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, geometry.width, geometry.height); } // JPEG has no alpha
					await page.render({
						canvasContext: ctx as unknown as CanvasRenderingContext2D,
						canvas: canvas as unknown as HTMLCanvasElement,
						viewport: page.getViewport({ scale: geometry.scale }),
					}).promise;
					const bytes = format === "jpeg" ? await canvas.encode("jpeg", 82) : await canvas.encode("png");
					out.push({ page: n, image: bytes.toString("base64"), mimeType: format === "jpeg" ? "image/jpeg" : "image/png", width: geometry.width, height: geometry.height, text: texts.get(n) ?? "" });
					page.cleanup();
				}
				return out;
			} finally {
				await task.destroy().catch(() => {});
			}
		},
	};
}
