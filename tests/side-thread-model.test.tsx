import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { SideThreadBody, type SideThreadHandlers } from "../components/side-thread.tsx";
import type { SideThreadState } from "../components/use-side-thread.ts";

const answer = { id: "answer", role: "assistant" as const, text: "Because it is continuous.", at: "2026-11-05T00:00:02Z", model: "claude-code:haiku" };
const state: SideThreadState = {
	threadId: "side_lesson", segmentId: "lesson", messages: [
		{ id: "question", role: "user", text: "Why?", at: "2026-11-05T00:00:01Z" },
		answer,
	], answering: false, streamText: "", mode: "popover", anchor: { kind: "composer" },
};
const handlers: SideThreadHandlers = { onAsk: async () => true, onStop() {}, onExpand() {}, onFloat() {}, onClose() {} };
const render = (s = state, onDragStart?: (event: React.PointerEvent<HTMLElement>) => void) =>
	parseHTML(`<html><body>${renderToStaticMarkup(<SideThreadBody state={s} {...handlers} onDragStart={onDragStart} />)}</body></html>`).document;

describe("follow-up model label and picker", () => {
	it("labels only saved helper answers, with the qualified id in the title", () => {
		const doc = render();
		const labels = doc.querySelectorAll('[data-testid="side-model-label"]');
		assert.equal(labels.length, 1);
		assert.equal(labels[0]!.textContent, "haiku · claude-code");
		assert.equal(labels[0]!.getAttribute("title"), "claude-code:haiku");
		assert.ok(labels[0]!.classList.contains("font-ui"));
		assert.ok(doc.querySelector('[data-testid="side-helper-message"]')!.querySelector('[data-testid="side-model-label"]'));
		assert.equal(doc.querySelector('[data-testid="side-learner-message"]')!.querySelector('[data-testid="side-model-label"]'), null);
	});

	it("renders no label for a legacy answer or the streaming placeholder", () => {
		const { model: _legacy, ...unlabelled } = answer;
		const doc = render({ ...state, messages: [unlabelled], answering: true, streamText: "Partial…" });
		assert.equal(doc.querySelector('[data-testid="side-model-label"]'), null);
		assert.ok(doc.querySelector('[data-testid="side-streaming-answer"]'));
	});

	it("shows Auto when unset and the short model name when a choice is active", () => {
		const unset = render({ ...state, model: undefined }).querySelector('[data-testid="side-thread-model-picker"]')!;
		assert.match(unset.textContent ?? "", /Auto/);
		assert.doesNotMatch(unset.textContent ?? "", /haiku/);
		const chosen = render({ ...state, model: { provider: "openrouter", id: "deepseek/deepseek-r1" } })
			.querySelector('[data-testid="side-thread-model-picker"]')!;
		assert.match(chosen.textContent ?? "", /deepseek-r1/);
		assert.doesNotMatch(chosen.textContent ?? "", /openrouter|Auto/);
	});

	it("keeps the draggable header in charge and exposes the picker contract", () => {
		const doc = render(state, () => {});
		const header = doc.querySelector('[data-testid="side-thread-header"]')!;
		assert.ok(header.classList.contains("cursor-grab"), "the header still owns drag");
		const picker = header.querySelector('[data-testid="side-thread-model-picker"]')!;
		assert.ok(picker, "the picker sits between the title and the Pin button");
		assert.equal(picker.tagName.toLowerCase(), "button");
		assert.equal(picker.getAttribute("draggable"), null);
		assert.equal(picker.getAttribute("title"), "Follow-up model — applies to the next answer");
		assert.equal(picker.getAttribute("aria-label"), "Follow-up model");
		assert.equal(picker.getAttribute("aria-haspopup"), "menu");
		assert.equal(picker.getAttribute("aria-expanded"), "false");
		assert.equal(picker.hasAttribute("disabled"), false, "a disabled picker must stay focusable");
		assert.ok(Array.from(header.querySelectorAll("button")).some((button) => button.getAttribute("aria-label") === "Dock side conversation"), "the Pin button still follows the picker");
	});

	it("marks the picker aria-disabled while an answer streams", () => {
		const picker = render({ ...state, answering: true }).querySelector('[data-testid="side-thread-model-picker"]')!;
		assert.equal(picker.getAttribute("aria-disabled"), "true");
	});
});
