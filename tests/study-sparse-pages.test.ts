/** Token diet: text layer first — only sparse (image/slide-only) pages are sent to the vision model. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyMemory, markTextRead, recordBatch, recordPages, SPARSE_PAGE_CHARS, splitByTextLayer } from "../src/core/study/material-memory.ts";

const prose = "word ".repeat(80); // 400 chars

describe("splitByTextLayer", () => {
	it("sends only pages whose text layer is under the threshold to the vision model", () => {
		const memory = recordPages(emptyMemory(), [{ n: 1, text: prose }, { n: 2, text: "Fig. 3" }, { n: 3, text: "" }, { n: 4, text: prose }]);
		const split = splitByTextLayer(memory, [1, 2, 3, 4, 5]);
		assert.deepEqual(split.textual, [1, 4]);
		assert.deepEqual(split.sparse, [2, 3]);
		assert.deepEqual(split.unknown, [5], "pages without extracted text are extracted first, not guessed");
	});

	it("counts non-whitespace-padded length and honours a custom threshold", () => {
		const memory = recordPages(emptyMemory(), [{ n: 1, text: `${" ".repeat(500)}hi` }, { n: 2, text: "x".repeat(SPARSE_PAGE_CHARS) }]);
		assert.deepEqual(splitByTextLayer(memory, [1, 2]), { textual: [2], sparse: [1], unknown: [] });
		assert.deepEqual(splitByTextLayer(memory, [1, 2], 2).textual, [1, 2]);
	});

	it("skips pages already read, whether by the model or from the text layer", () => {
		let memory = recordPages(emptyMemory(), [{ n: 1, text: prose }, { n: 2, text: "" }, { n: 3, text: "" }]);
		memory = markTextRead(memory, [1]);
		memory = recordBatch(memory, { pages: [{ n: 2, text: "seen by vision" }], summary: "s" });
		assert.deepEqual(splitByTextLayer(memory, [1, 2, 3]), { textual: [], sparse: [3], unknown: [] });
	});
});
