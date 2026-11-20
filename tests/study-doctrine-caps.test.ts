/** Token diet: the study block is capped (materials list, related contexts, total variable size). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MATERIALS_MAX, RELATED_CHARS, STUDY_BLOCK_CHARS, studyInstructions } from "../src/core/study/doctrine.ts";
import { addMaterial, createSubject, createTopic, emptyLibrary, setContext } from "../src/core/study/model.ts";

function big(topics: number, materials: number, ctxChars: number) {
	let lib = emptyLibrary();
	const s = createSubject(lib, "Biology"); lib = s.library;
	const ids: string[] = [];
	for (let i = 0; i < topics; i++) {
		const t = createTopic(lib, s.subject.id, `Topic ${i}`); lib = t.library; ids.push(t.topic.id);
		lib = setContext(lib, { subjectId: s.subject.id, topicId: t.topic.id }, `T${i}-`.padEnd(ctxChars, "x"));
	}
	lib = setContext(lib, { subjectId: s.subject.id }, "S-".padEnd(ctxChars, "y"));
	for (let i = 0; i < materials; i++) {
		const m = addMaterial(lib, { sha256: String(i).padStart(64, "a"), fileName: `file-${i}.pdf`, pageCount: 10, bytes: 1, scope: { subjectId: s.subject.id } }); lib = m.library;
	}
	return { lib, subjectId: s.subject.id, ids };
}

/** The variable part: everything before the static doctrine (LAYERS onwards). */
const variable = (text: string) => text.slice(0, text.indexOf("Where to look, in this order"));

describe("studyInstructions caps", () => {
	it("lists at most 40 materials with a +N more line", () => {
		const f = big(0, 55, 10);
		const text = studyInstructions({ library: f.lib, placement: { subjectId: f.subjectId, startMode: "check" }, kind: "teach" });
		const listed = (text.match(/^- file-\d+\.pdf/gm) ?? []).length;
		assert.ok(listed <= MATERIALS_MAX, `listed ${listed}`);
		assert.ok(text.includes(`+${55 - listed} more`));
	});

	it("truncates related-topic contexts and keeps the whole variable block within ~6k chars", () => {
		const f = big(12, 30, 5000);
		const text = studyInstructions({ library: f.lib, placement: { subjectId: f.subjectId, topicId: f.ids[0], startMode: "check" }, kind: "teach" });
		for (const m of text.matchAll(/### Topic \d+\n(T\d+-x*…?)/g)) assert.ok(m[1]!.length <= RELATED_CHARS, "related context capped");
		assert.ok(variable(text).length <= STUDY_BLOCK_CHARS + 600, `variable block ${variable(text).length}`);
		assert.match(text, /more topics/);
	});

	it("small libraries are untouched", () => {
		const f = big(2, 2, 100);
		const text = studyInstructions({ library: f.lib, placement: { subjectId: f.subjectId, startMode: "check" }, kind: "teach" });
		assert.match(text, /file-1\.pdf/);
		assert.doesNotMatch(text, /more\b.*study_context/);
	});

	it("is identical across calls (stable prefix for prompt caching)", () => {
		const f = big(3, 5, 300);
		const input = { library: f.lib, placement: { subjectId: f.subjectId, startMode: "check" as const }, kind: "teach" as const };
		assert.equal(studyInstructions(input), studyInstructions(input));
	});
});
