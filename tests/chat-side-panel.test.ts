import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findCitations, linkCitations, parseCitationToken } from "../components/panel/citations.ts";
import { clampPanelFraction, emptyPanel, itemKey, panelReducer, parsePanel, serializePanel, type PanelItem } from "../components/panel/panel-store.ts";

const mats = [
	{ id: "m1", fileName: "Lecture 3 - Graphs.pdf", pageCount: 20 },
	{ id: "m2", fileName: "week4.pdf", pageCount: 10, title: "Dynamic Programming" },
];

describe("citations", () => {
	it("matches by file name and by meta title, with or without extension", () => {
		const hits = findCitations("See (Lecture 3 - Graphs.pdf, p. 5) and (Dynamic Programming, p. 2).", mats);
		assert.deepEqual(hits.map((h) => [h.materialId, h.page]), [["m1", 5], ["m2", 2]]);
		assert.equal(findCitations("(lecture 3 - graphs, p. 7)", mats)[0]?.materialId, "m1");
	});
	it("takes the first page of a range and ignores unknown files or out-of-range pages", () => {
		assert.equal(findCitations("(week4.pdf, pp. 3-4)", mats)[0]?.page, 3);
		assert.equal(findCitations("(other.pdf, p. 2)", mats).length, 0);
		assert.equal(findCitations("(week4.pdf, p. 99)", mats).length, 0);
		assert.equal(findCitations("(week4.pdf, p. 1)", []).length, 0);
	});
	it("rewrites to links that parse back, leaving code fences alone", () => {
		const out = linkCitations("a (week4.pdf, p. 2) b\n```\n(week4.pdf, p. 3)\n```", mats);
		assert.ok(out.includes("`lh-cite|m2|2|(week4.pdf, p. 2)`"));
		assert.ok(out.includes("```\n(week4.pdf, p. 3)\n```"));
		assert.deepEqual(parseCitationToken("lh-cite|m2|2|(week4.pdf, p. 2)"), { materialId: "m2", page: 2, label: "(week4.pdf, p. 2)" });
		assert.equal(parseCitationToken("const x"), null);
	});
});

describe("panel store", () => {
	const pdf: PanelItem = { kind: "pdf", id: "m1", title: "L3", page: 2 };
	it("opens, dedupes by kind+id, and re-focuses with the new page", () => {
		let s = panelReducer(emptyPanel, { type: "open", item: pdf });
		s = panelReducer(s, { type: "open", item: { kind: "figure", id: "f1", title: "Fig" } });
		assert.equal(s.activeKey, "figure:f1");
		s = panelReducer(s, { type: "open", item: { ...pdf, page: 9 } });
		assert.equal(s.items.length, 2);
		assert.equal(s.activeKey, "pdf:m1");
		assert.equal(s.items[0]?.page, 9);
		assert.equal(s.items[0]?.nonce, 2);
		s = panelReducer(s, { type: "open", item: { kind: "note", id: "m1", title: "N" } });
		assert.equal(s.items.length, 3);
	});
	it("closes the active item onto a neighbour, and the last one empties the panel", () => {
		let s = panelReducer(emptyPanel, { type: "open", item: pdf });
		s = panelReducer(s, { type: "open", item: { kind: "files", id: "files", title: "Files" } });
		s = panelReducer(s, { type: "focus", key: itemKey(pdf) });
		s = panelReducer(s, { type: "close", key: "pdf:m1" });
		assert.equal(s.activeKey, "files:files");
		s = panelReducer(s, { type: "close", key: "files:files" });
		assert.deepEqual(s, emptyPanel);
	});
	it("round-trips through storage and survives garbage", () => {
		const s = panelReducer(emptyPanel, { type: "open", item: pdf });
		assert.equal(parsePanel(serializePanel(s)).items[0]?.id, "m1");
		assert.deepEqual(parsePanel("{nope"), emptyPanel);
		assert.equal(parsePanel(JSON.stringify({ items: [{ kind: "x", id: 1 }] })).items.length, 0);
	});
	it("keeps both panes above their minimums", () => {
		assert.equal(clampPanelFraction(0.5, 1400), 0.5);
		assert.ok(clampPanelFraction(0.95, 1400) <= 1 - 420 / 1400 + 1e-9);
		assert.ok(clampPanelFraction(0.01, 1400) >= 320 / 1400 - 1e-9);
	});
});
