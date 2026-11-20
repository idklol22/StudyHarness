/**
 * The single new-chat context chip (Study overhaul round 5): its pure label rule and the chip/popover's static
 * markup. The chip owns no state of its own — tests pass a PlacementState facade, exactly like study-ui.test.tsx.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createSubject, createTopic, emptyLibrary, type Library } from "../src/core/study/model.ts";
import { contextChipLabel } from "../components/study/context-chip.tsx";
import { PlacementPills, MentionMenu } from "../components/study/placement-pills.tsx";
import { emptyChoice, mentionOptions, mentionQuery, stripMention, orderedSubjects } from "../components/study/placement.ts";
import type { PlacementState } from "../components/study/placement-picker.tsx";

function library(): { lib: Library; ml: string; dp: string; alg: string } {
	let lib = emptyLibrary();
	const ml = createSubject(lib, "Machine Learning"); lib = ml.library;
	const alg = createSubject(lib, "Algorithms"); lib = alg.library;
	const dp = createTopic(lib, ml.subject.id, "Dynamic programming"); lib = dp.library;
	return { lib, ml: ml.subject.id, dp: dp.topic.id, alg: alg.subject.id };
}

function state(over: Partial<PlacementState> = {}): PlacementState {
	const { lib, ml } = library();
	return {
		library: lib, loaded: true, choice: { subjectId: ml, topicId: "", startMode: "" }, placement: null, missing: "",
		setSubject() {}, setTopic() {}, setStartMode() {}, async createSubject() {}, async createTopic() {}, error: "", ...over,
	};
}

describe("contextChipLabel — the chip's pure text", () => {
	it("subject › topic · start mode", () => {
		const { lib, ml, dp } = library();
		assert.equal(contextChipLabel(lib, { subjectId: ml, topicId: dp, startMode: "scratch" }), "Machine Learning › Dynamic programming");
		assert.equal(contextChipLabel(lib, { subjectId: ml, topicId: dp, startMode: "check" }), "Machine Learning › Dynamic programming");
	});

	it("the whole subject drops the topic segment", () => {
		const { lib, ml } = library();
		assert.equal(contextChipLabel(lib, { subjectId: ml, topicId: "", startMode: "scratch" }), "Machine Learning");
	});

	it("practice uses its own label, not a start mode", () => {
		const { lib, ml, dp } = library();
		assert.equal(contextChipLabel(lib, { subjectId: ml, topicId: dp, startMode: "check" }, true), "Machine Learning › Dynamic programming · Practice");
	});

	it("an unasked start mode leaves just the scope; an empty choice is empty", () => {
		const { lib, ml, dp } = library();
		assert.equal(contextChipLabel(lib, { subjectId: ml, topicId: dp, startMode: "" }), "Machine Learning › Dynamic programming");
		assert.equal(contextChipLabel(lib, emptyChoice), "");
	});

	it("a ChatPlacement from the core (required startMode) is accepted directly", () => {
		const { lib, ml } = library();
		assert.equal(contextChipLabel(lib, { subjectId: ml, startMode: "check" }), "Machine Learning");
	});
});

describe("placement pills markup", () => {
	it("renders a pill per subject, the selected one pressed, and + New subject", () => {
		const { lib, ml, alg } = library();
		const html = renderToStaticMarkup(<PlacementPills state={state({ library: lib, choice: { subjectId: ml, topicId: "", startMode: "" } })} />);
		assert.match(html, new RegExp(`data-testid="subject-pill-${ml}"[^>]*aria-pressed="true"`));
		assert.match(html, new RegExp(`data-testid="subject-pill-${alg}"[^>]*aria-pressed="false"`));
		assert.match(html, /[+] New subject/);
		assert.ok(!html.includes("context-chip-popover"));
	});

	it("the topic row appears only with a subject, Whole subject first, plus + New topic", () => {
		const withSubject = renderToStaticMarkup(<PlacementPills state={state()} />);
		assert.match(withSubject, /data-testid="topic-pills"/);
		assert.match(withSubject, /Whole subject/);
		assert.match(withSubject, /Dynamic programming/);
		assert.match(withSubject, /[+] New topic/);
		const none = renderToStaticMarkup(<PlacementPills state={state({ choice: emptyChoice })} />);
		assert.ok(!none.includes("topic-pills"));
	});

	it("with no subjects only + New subject and a hint show", () => {
		const html = renderToStaticMarkup(<PlacementPills state={state({ library: emptyLibrary(), choice: emptyChoice })} />);
		assert.match(html, /[+] New subject/);
		assert.match(html, /pills-empty-hint/);
		assert.ok(!html.includes("subject-pill-more"));
	});

	it("more than six subjects overflow into More…, keeping the selected one visible", () => {
		let lib = emptyLibrary();
		const ids: string[] = [];
		for (let i = 0; i < 8; i++) { const r = createSubject(lib, `Subject ${i}`); lib = r.library; ids.push(r.subject.id); }
		const html = renderToStaticMarkup(<PlacementPills state={state({ library: lib, choice: { subjectId: ids[0]!, topicId: "", startMode: "" } })} />);
		assert.match(html, /subject-pill-more/);
		assert.ok(html.includes(`subject-pill-${ids[0]}`));
		assert.equal((html.match(/data-testid="subject-pill-sub/g) ?? []).length, 6);
	});

	it("the remembered subject is ordered first", () => {
		const { lib, ml, alg } = library();
		assert.equal(orderedSubjects(lib, ml)[0]!.id, ml);
		assert.equal(orderedSubjects(lib, alg)[0]!.id, alg);
	});
});

describe("@ mention rules", () => {
	it("detects a trailing @query only", () => {
		assert.equal(mentionQuery("hello @alg"), "alg");
		assert.equal(mentionQuery("@"), "");
		assert.equal(mentionQuery("mail a@b.com"), null);
		assert.equal(mentionQuery("@alg then more"), null);
		assert.equal(mentionQuery("plain text"), null);
	});

	it("filters subjects and Subject › Topic entries", () => {
		const { lib, ml, dp } = library();
		assert.equal(mentionOptions(lib, "").length, 3);
		assert.deepEqual(mentionOptions(lib, "dynamic").map((o) => [o.subjectId, o.topicId]), [[ml, dp]]);
		assert.equal(mentionOptions(lib, "dynamic")[0]!.label, "Machine Learning › Dynamic programming");
		assert.deepEqual(mentionOptions(lib, "machine").map((o) => o.label), ["Machine Learning", "Machine Learning › Dynamic programming"]);
		assert.deepEqual(mentionOptions(lib, "zzz"), []);
	});

	it("stripMention removes the @query and keeps the rest", () => {
		assert.equal(stripMention("explain this @alg"), "explain this ");
		assert.equal(stripMention("@alg"), "");
	});

	it("the menu renders options and marks the active one", () => {
		const { lib } = library();
		const opts = mentionOptions(lib, "");
		const html = renderToStaticMarkup(<MentionMenu options={opts} index={1} onPick={() => {}} />);
		assert.match(html, /data-testid="mention-menu"/);
		assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 1);
		assert.equal(renderToStaticMarkup(<MentionMenu options={[]} index={0} onPick={() => {}} />), "");
	});
});
