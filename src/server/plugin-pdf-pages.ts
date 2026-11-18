/**
 * The plugin backend's `documents` service: page counts and native page rendering for a local PDF the
 * learner pointed at. Access follows the agent's read tools exactly: `resolveSourcePath` applies the
 * mandatory sensitive-location denials and the optional allowed-folders boundary. Rendering is the shared
 * module (pdf-pages.ts).
 */
import { resolveSourcePath } from "../agent/tools/fs-shared.ts";
import { MAX_RENDER_PAGES, pdfPageCount, renderPdfPages } from "./pdf-pages.ts";
import type { PluginDocumentService } from "../core/plugins.ts";

export { pngSize } from "./pdf-pages.ts";

function readablePdf(path: unknown): string {
	if (typeof path !== "string" || !path.trim()) throw new Error("Give the path of a PDF file.");
	const absolute = resolveSourcePath(path.trim());
	if (!/\.pdf$/i.test(absolute)) throw new Error("Only PDF files can be rendered. Export slides (PowerPoint, Keynote) to PDF first.");
	return absolute;
}

export function createPluginDocumentService(): PluginDocumentService {
	return {
		async pdfInfo(path) {
			const absolute = readablePdf(path);
			return { path: absolute, pageCount: await pdfPageCount(absolute) };
		},
		async renderPdfPages(input) {
			if (!input || typeof input !== "object") throw new Error("Expected {path, pages}.");
			const absolute = readablePdf(input.path);
			const pages = Array.isArray(input.pages) ? input.pages : [];
			if (pages.length > MAX_RENDER_PAGES) throw new Error(`Render at most ${MAX_RENDER_PAGES} pages per call.`);
			return renderPdfPages(absolute, { pages, dpi: input.dpi, format: input.format });
		},
	};
}
