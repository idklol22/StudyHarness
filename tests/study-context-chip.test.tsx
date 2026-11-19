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
import { contextChipLabel, ContextChip, ContextChipPopover } from "../components/study/context-chip.tsx";
import { emptyChoice } from "../components/study/placement.ts";
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
		assert.equal(contextChipLabel(lib, { subjectId: ml, topicId: dp, startMode: "scratch" }), "Machine Learning › Dynamic programming · From scratch");
		assert.equal(contextChipLabel(lib, { subjectId: ml, topicId: dp, startMode: "check" }), "Machine Learning › Dynamic programming · Check what I know first");
	});

	it("the whole subject drops the topic segment", () => {
		const { lib, ml } = library();
		assert.equal(contextChipLabel(lib, { subjectId: ml, topicId: "", startMode: "scratch" }), "Machine Learning · From scratch");
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
		assert.equal(contextChipLabel(lib, { subjectId: ml, startMode: "check" }), "Machine Learning · Check what I know first");
	});
});

describe("context chip markup", () => {
	it("the chip carries its label and test hooks; the missing hint is opt-in", () => {
		const { lib, ml } = library();
		const html = renderToStaticMarkup(<ContextChip state={state({ library: lib, choice: { subjectId: ml, topicId: "", startMode: "scratch" } })} />);
		assert.match(html, /data-testid="context-chip"/);
		assert.match(html, /aria-expanded="false"/);
		assert.match(html, /Machine Learning · From scratch/);
		assert.ok(!html.includes("context-chip-hint"));
		const missing = renderToStaticMarkup(<ContextChip state={state({ missing: "Choose how to start." })} showMissing />);
		assert.match(missing, /data-testid="context-chip-hint"/);
		assert.match(missing, /Choose how to start\./);
	});

	it("the popover lists subjects with search and New subject, topics with Whole subject and New topic", () => {
		const html = renderToStaticMarkup(<ContextChipPopover state={state()} />);
		assert.match(html, /data-testid="context-chip-popover"/);
		assert.match(html, /data-testid="context-chip-subject-search"/);
		assert.match(html, /Machine Learning/);
		assert.match(html, /Algorithms/);
		assert.match(html, /data-testid="context-chip-new-subject"/);
		assert.match(html, /\+ New subject/);
		assert.match(html, /data-testid="context-chip-whole-subject"/);
		assert.match(html, /Whole subject/);
		assert.match(html, /Dynamic programming/);
		assert.match(html, /data-testid="context-chip-new-topic"/);
		assert.match(html, /\+ New topic/);
	});

	it("both start modes render, unselected until asked, and the chosen one is marked", () => {
		const html = renderToStaticMarkup(<ContextChipPopover state={state()} />);
		assert.match(html, /data-testid="context-chip-start-mode"/);
		assert.match(html, /From scratch/);
		assert.match(html, /Check what I know first/);
		assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 0);
		const chosen = renderToStaticMarkup(<ContextChipPopover state={state({ choice: { subjectId: library().ml, topicId: "", startMode: "scratch" } })} />);
		assert.match(chosen, /aria-checked="true"[^>]*data-testid="context-chip-mode-scratch"|data-testid="context-chip-mode-scratch"[^>]*aria-checked="true"/);
	});

	it("practice shows no start-mode choice", () => {
		const html = renderToStaticMarkup(<ContextChipPopover state={state()} practice />);
		assert.ok(!html.includes("context-chip-start-mode"));
	});

	it("Add files links to this scope's #files page, with the topic when one is picked", () => {
		const { lib, ml, dp } = library();
		const whole = renderToStaticMarkup(<ContextChipPopover state={state({ library: lib, choice: { subjectId: ml, topicId: "", startMode: "" } })} />);
		assert.match(whole, /data-testid="context-chip-add-files"/);
		assert.match(whole, new RegExp(`href="/subjects/${ml}#files"`));
		assert.match(whole, /Add files to Machine Learning instead/);
		const topic = renderToStaticMarkup(<ContextChipPopover state={state({ library: lib, choice: { subjectId: ml, topicId: dp, startMode: "" } })} />);
		assert.match(topic, new RegExp(`href="/subjects/${ml}/${dp}#files"`));
		assert.match(topic, /Add files to Machine Learning instead/);
	});

	it("the create forms and the missing hint are available on demand", () => {
		const html = renderToStaticMarkup(<ContextChipPopover state={state({ error: "Could not create the subject.", missing: "Choose a subject for this chat." })} showMissing />);
		assert.match(html, /data-testid="context-chip-error"/);
		assert.match(html, /Could not create the subject\./);
		assert.match(html, /data-testid="context-chip-hint"/);
		assert.match(html, /Choose a subject for this chat\./);
	});

	it("with no subject chosen yet, there is no topic list or Add-files link", () => {
		const html = renderToStaticMarkup(<ContextChipPopover state={state({ library: emptyLibrary(), choice: emptyChoice })} />);
		assert.ok(!html.includes("context-chip-topics"));
		assert.ok(!html.includes("context-chip-add-files"));
		assert.match(html, /No subjects found\./);
	});
});
