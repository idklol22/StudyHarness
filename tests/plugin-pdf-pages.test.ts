/**
 * The plugin backend `documents` service: native PDF page rendering for plugins (Study slides),
 * under the agent's file-access rules. Renders the real 3-page fixture in process.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { createPluginDocumentService, pngSize } from "../src/server/plugin-pdf-pages.ts";

const fixture = path.resolve("tests/fixtures/sample-3page.pdf");

describe("plugin documents service", () => {
	const docs = createPluginDocumentService();

	it("reports the page count of a readable PDF", async () => {
		const info = await docs.pdfInfo(fixture);
		assert.equal(info.pageCount, 3);
	});

	it("renders requested pages to PNG with their extracted text", async () => {
		const pages = await docs.renderPdfPages({ path: fixture, pages: [1, 3], dpi: 60 });
		assert.deepEqual(pages.map((p) => p.page), [1, 3]);
		for (const p of pages) {
			const png = Buffer.from(p.png, "base64");
			assert.deepEqual(pngSize(png), { width: p.width, height: p.height });
			assert.ok(p.width > 50 && p.height > 50);
			assert.equal(typeof p.text, "string");
		}
	});

	it("refuses bad input instead of guessing", async () => {
		await assert.rejects(docs.renderPdfPages({ path: fixture, pages: [] }), /1-based/);
		await assert.rejects(docs.renderPdfPages({ path: fixture, pages: [1, 2, 3, 4, 5, 6, 7, 8, 9] }), /at most 8/);
		await assert.rejects(docs.renderPdfPages({ path: fixture, pages: [1], dpi: 500 }), /dpi/);
		await assert.rejects(docs.pdfInfo(path.resolve("package.json")), /Only PDF/);
	});

	it("applies the read tools' mandatory denials (no credentials files)", async () => {
		await assert.rejects(docs.pdfInfo(path.resolve("auth.json")));
	});
});
