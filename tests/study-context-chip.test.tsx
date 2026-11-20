/**
 * The new-chat context bar and the read-only chip for existing chats (H4): pure label rules, the compact
 * two-button bar and its popover, plus the `@` shorthand. Tests pass a PlacementState facade, like study-ui.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createSubject, createTopic, emptyLibrary, type Library } from "../src/core/study/model.ts";
import { contextChipLabel } from "../components/study/context-chip.tsx";
import { ContextPanel, ContextPickerBar, Highlight, MentionMenu } from "../components/study/placement-pills.tsx";
import { emptyChoice, mentionOptions, mentionQuery, stripMention, orderedSubjects } from "../components/study/placement.ts";
import type { PlacementState } from "../components/study/placement-picker.tsx";

function library(): { lib: Library; ml: string; dp: string; rl: string; gr: string; alg: string } {
	let lib = emptyLibrary();
	const ml = createSubject(lib, "Machine Learning"); lib = ml.library;
	const alg = createSubject(lib, "Algorithms"); lib = alg.library;
	const dp = createTopic(lib, ml.subject.id, "Dynamic programming"); lib = dp.library;
	const rl = createTopic(lib, ml.subject.id, "Reinforcement learning"); lib = rl.library;
	const gr = createTopic(lib, ml.subject.id, "Graph theory"); lib = gr.library;
	return { lib, ml: ml.subject.id, dp: dp.topic.id, rl: rl.topic.id, gr: gr.topic.id, alg: alg.subject.id };
}

function state(over: Partial<PlacementState> = {}): PlacementState {
	const { lib, ml } = library();
	return {
		library: lib, loaded: true, choice: { subjectId: ml, topicIds: [], startMode: "" }, placement: null, missing: "",
		setSubject() {}, setTopic() {}, toggleTopic() {}, setTopics() {}, setStartMode() {},
		async createSubject() {}, async createTopic() {}, error: "", ...over,
	};
}

describe("contextChipLabel — the chip's pure text", () => {
	it("subject › topic · start mode", () => {
		const { lib, ml, dp } = library();
		assert.equal(contextChipLabel(lib, { subjectId: ml, topicId: dp, startMode: "scratch" }), "Machine Learning › Dynamic programming");
		assert.equal(contextChipLabel(lib, { subjectId: ml, topicId: dp, startMode: "check" }), "Machine Learning › Dynamic programming", "the old single-id shape still reads");
		assert.equal(contextChipLabel(lib, { subjectId: ml, topicIds: [dp], startMode: "scratch" }), "Machine Learning › Dynamic programming");
	});

	it("the whole subject drops the topic segment; several topics count them", () => {
		const { lib, ml, dp, rl, gr } = library();
		assert.equal(contextChipLabel(lib, { subjectId: ml, topicIds: [], startMode: "scratch" }), "Machine Learning");
		assert.equal(contextChipLabel(lib, { subjectId: ml, topicIds: [dp, rl], startMode: "scratch" }), "Machine Learning › 2 topics");
		assert.equal(contextChipLabel(lib, { subjectId: ml, topicIds: [dp, rl, gr], startMode: "scratch" }), "Machine Learning › 3 topics");
	});

	it("practice uses its own label, not a start mode", () => {
		const { lib, ml, dp } = library();
		assert.equal(contextChipLabel(lib, { subjectId: ml, topicIds: [dp], startMode: "check" }, true), "Machine Learning › Dynamic programming · Practice");
	});

	it("an unasked start mode leaves just the scope; an empty choice is empty", () => {
		const { lib, ml, dp } = library();
		assert.equal(contextChipLabel(lib, { subjectId: ml, topicIds: [dp], startMode: "" }), "Machine Learning › Dynamic programming");
		assert.equal(contextChipLabel(lib, emptyChoice), "");
	});

	it("a ChatPlacement from the core (required startMode) is accepted directly", () => {
		const { lib, ml } = library();
		assert.equal(contextChipLabel(lib, { subjectId: ml, startMode: "check" }), "Machine Learning");
	});
});

describe("context bar and panel markup", () => {
	it("the bar is two compact buttons, with the remembered subject first in the panel", () => {
		const { lib, ml, alg } = library();
		const html = renderToStaticMarkup(<ContextPickerBar state={state({ choice: { subjectId: ml, topicIds: [], startMode: "" } })} last={{ subjectId: alg, topicIds: [] }} />);
		assert.match(html, /data-testid="context-bar"/);
		assert.match(html, /data-testid="context-subject-button"/);
		assert.match(html, /data-testid="context-topics-button"/);
		assert.ok(!html.includes("subject-pill-"), "no pill rows");
		assert.equal(orderedSubjects(lib, alg)[0]!.id, alg);
	});

	it("either button's panel has the create actions, searchable columns and summary", () => {
		const { lib, ml, dp } = library();
		const html = renderToStaticMarkup(<ContextPanel state={state({ library: lib, choice: { subjectId: ml, topicIds: [dp], startMode: "" } })} />);
		assert.match(html, /data-testid="context-panel"/);
		assert.match(html, /\+ New subject/);
		assert.match(html, /\+ New topic/);
		assert.match(html, /Search subjects/);
		assert.match(html, /Search topics/);
		assert.match(html, /Whole subject/);
		assert.match(html, /Dynamic programming/);
		assert.match(html, /data-testid="context-done"/);
		assert.match(html, /Machine Learning › Dynamic programming/);
	});

	it("matches in a search are highlighted", () => {
		const html = renderToStaticMarkup(<Highlight text="Dynamic programming" query="gram" />);
		assert.match(html, /data-testid="context-highlight"/);
		assert.match(html, /<mark[^>]*>gram<\/mark>/);
		assert.equal(renderToStaticMarkup(<Highlight text="Dynamic programming" query="" />), "Dynamic programming");
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
		assert.equal(mentionOptions(lib, "").length, 5);
		assert.deepEqual(mentionOptions(lib, "dynamic").map((o) => [o.subjectId, o.topicId]), [[ml, dp]]);
		assert.equal(mentionOptions(lib, "dynamic")[0]!.label, "Machine Learning › Dynamic programming");
		assert.deepEqual(mentionOptions(lib, "machine").map((o) => o.label), ["Machine Learning", "Machine Learning › Dynamic programming", "Machine Learning › Reinforcement learning", "Machine Learning › Graph theory"]);
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
