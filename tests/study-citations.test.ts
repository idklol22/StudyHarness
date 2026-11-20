/** T16 — canonical study-file citations: prompt wording, tool hint, matching and the clickable chip. */
import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { STUDY_BLOCK_CHARS, STUDY_CITATION_FORMAT, STUDY_TOOL_CITE_HINT, studyInstructions } from "../src/core/study/doctrine.ts";
import { addMaterial, createSubject, emptyLibrary } from "../src/core/study/model.ts";
import { findCitations, linkCitations } from "../components/panel/citations.ts";
import { CitationPill, SidePanelProvider } from "../components/panel/side-panel.tsx";

const mats = [
	{ id: "m1", fileName: "Lecture 3 - Graphs.pdf", pageCount: 20 },
	{ id: "m2", fileName: "week4.pdf", pageCount: 10, title: "Dynamic Programming" },
];

function largeLibrary() {
	let lib = emptyLibrary();
	const s = createSubject(lib, "Biology"); lib = s.library;
	for (let i = 0; i < 30; i++) {
		const m = addMaterial(lib, { sha256: String(i).padStart(64, "a"), fileName: `file-${i}.pdf`, pageCount: 10, bytes: 1, scope: { subjectId: s.subject.id } });
		lib = m.library;
	}
	return { lib, subjectId: s.subject.id };
}

describe("study citation block", () => {
	it("emits the canonical format verbatim in teach and plain modes", () => {
		const { lib, subjectId } = largeLibrary();
		const placement = { subjectId, startMode: "check" as const };
		for (const mode of ["teach", "plain"] as const) {
			const text = studyInstructions({ library: lib, placement, kind: "teach", mode });
			assert.ok(text.includes(STUDY_CITATION_FORMAT), `${mode} contains the format verbatim`);
		}
	});

	it("keeps the variable block within the cap for a large library", () => {
		const { lib, subjectId } = largeLibrary();
		const text = studyInstructions({ library: lib, placement: { subjectId, startMode: "check" }, kind: "teach" });
		const variable = text.slice(0, text.indexOf("Where to look, in this order"));
		assert.ok(variable.includes(STUDY_CITATION_FORMAT));
		assert.ok(variable.length <= STUDY_BLOCK_CHARS, `variable block ${variable.length} <= ${STUDY_BLOCK_CHARS}`);
	});

	it("exposes a single-line tool hint naming the canonical token", () => {
		assert.ok(STUDY_TOOL_CITE_HINT.includes("(exact file name, p. N)"));
		assert.equal(STUDY_TOOL_CITE_HINT.includes("\n"), false);
		assert.equal(STUDY_TOOL_CITE_HINT.trimEnd(), STUDY_TOOL_CITE_HINT);
	});
});

describe("study citation regression", () => {
	it("opens the first page of a range and leaves fenced code untouched", () => {
		const hits = findCitations("(Lecture 3 - Graphs.pdf, pp. 12-14)", mats);
		assert.deepEqual(hits.map((h) => [h.materialId, h.page]), [["m1", 12]]);
		const out = linkCitations("a (week4.pdf, p. 2) b\n```\n(week4.pdf, p. 3)\n```", mats);
		assert.ok(out.includes("`lh-cite|m2|2|(week4.pdf, p. 2)`"));
		assert.ok(out.includes("```\n(week4.pdf, p. 3)\n```"));
	});
});

describe("CitationPill", () => {
	it("renders a labelled side-panel button with a visible focus ring", () => {
		const markup = renderToStaticMarkup(
			React.createElement(SidePanelProvider, {
				chatId: "c",
				subjectId: "s1",
				children: React.createElement(CitationPill, { materialId: "m1", page: 12, label: "(Lecture 3 - Graphs.pdf, p. 12)" }),
			}),
		);
		const doc = parseHTML(`<html><body>${markup}</body></html>`).document;
		const pill = doc.querySelector('[data-testid="citation-pill"]');
		assert.ok(pill, "rendered pill exists");
		const action = pill!.getAttribute("aria-label") ?? pill!.getAttribute("title");
		assert.match(action ?? "", /side panel/i);
		const classes = pill!.getAttribute("class") ?? "";
		assert.ok(classes.includes("focus-visible:ring-2"));
		assert.ok(classes.includes("focus-visible:ring-ring"));
		assert.match(pill!.textContent ?? "", /Lecture 3 - Graphs\.pdf, p\. 12/);
	});
});
