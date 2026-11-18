/**
 * Native PDF page counting and rendering for files the app can already read (a managed Study copy, or a
 * path an access check has approved). Rendering is pdfjs into @napi-rs/canvas (Skia, in process, no browser)
 * under the pdf-reader's memory bounds; one document open serves a whole batch (text and images together),
 * and JPEG is the default so uploads to a model are small and fast.
 */
import * as fsp from "node:fs/promises";
import { pdfCanvasGeometry } from "../agent/subagents/headless.ts";
import { standardFontsDir } from "../agent/subagents/pdf-ops.ts";
import { documentToMarkdown } from "../agent/subagents/pdf-markdown.ts";

export const MAX_TEXT = 8_000;
export const MAX_RENDER_PAGES = 8;

export interface RenderedPage {
	page: number;
	/** Base64 image data, no data: prefix. */
	image: string;
	mimeType: "image/jpeg" | "image/png";
	width: number;
	height: number;
	/** The page's own text (Markdown-ish), capped; empty for image-only pages. */
	text: string;
}

export interface RenderOptions { pages: readonly number[]; dpi?: number; format?: "jpeg" | "png" }

async function openPdf(absolute: string) {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const task = pdfjs.getDocument({ data: new Uint8Array(await fsp.readFile(absolute)), standardFontDataUrl: standardFontsDir(), verbosity: 0 });
	return { task, doc: await task.promise };
}

export async function pdfPageCount(absolute: string): Promise<number> {
	const { task, doc } = await openPdf(absolute);
	try { return doc.numPages; } finally { await task.destroy().catch(() => {}); }
}

/** The text of the given pages only (no rendering): cheap, used to fill page memory on demand. */
export async function pdfPageTexts(absolute: string, pages: readonly number[]): Promise<Array<{ page: number; text: string }>> {
	const { task, doc } = await openPdf(absolute);
	try {
		const wanted = pages.filter((n) => Number.isInteger(n) && n >= 1 && n <= doc.numPages);
		const out = await documentToMarkdown(doc, wanted);
		return out.map((p) => ({ page: p.number, text: p.kind === "text" ? p.markdown.trim().slice(0, MAX_TEXT) : "" }));
	} finally { await task.destroy().catch(() => {}); }
}

/** Width/height from a PNG's IHDR chunk (bytes 16–23, big-endian). */
export function pngSize(png: Buffer): { width: number; height: number } {
	if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) throw new Error("Rendered page is not a PNG");
	return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** Render pages (1-based, deduplicated, out-of-range skipped) with their text, opening the document once. */
export async function renderPdfPages(absolute: string, options: RenderOptions): Promise<RenderedPage[]> {
	const pages = [...new Set(options.pages)];
	if (!pages.length || pages.some((n) => !Number.isInteger(n) || n < 1)) throw new Error("Pages must be 1-based whole numbers.");
	if (pages.length > MAX_RENDER_PAGES) throw new Error(`Render at most ${MAX_RENDER_PAGES} pages per call.`);
	const dpi = options.dpi ?? 90;
	if (!Number.isFinite(dpi) || dpi < 50 || dpi > 200) throw new Error("dpi must be between 50 and 200.");
	const format = options.format ?? "jpeg";
	if (format !== "jpeg" && format !== "png") throw new Error("format must be jpeg or png.");
	const { createCanvas } = await import("@napi-rs/canvas");
	const { task, doc } = await openPdf(absolute);
	try {
		const wanted = pages.filter((n) => n <= doc.numPages);
		const texts = new Map<number, string>();
		try {
			for (const p of await documentToMarkdown(doc, wanted)) texts.set(p.number, p.kind === "text" ? p.markdown.trim().slice(0, MAX_TEXT) : "");
		} catch { /* image-only or unusual pages: no text */ }
		const out: RenderedPage[] = [];
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
}
