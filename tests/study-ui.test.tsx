/**
 * Study UI logic (Phase C): the placement choice rules, the sidebar's Subject → Topic → chats grouping and
 * display order, and a render of the picker (asked every time: no default start mode).
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createSubject, createTopic, emptyLibrary, type Library } from "../src/core/study/model.ts";
import { emptyChoice, missingPlacement, placementFromChoice, placementLabel, restoreChoice } from "../components/study/placement.ts";
import { displayOrder, groupChats } from "../components/study/group-chats.ts";
import { PlacementPickerView, type PlacementState } from "../components/study/placement-picker.tsx";

function library(): { lib: Library; ml: string; dp: string; rl: string; alg: string } {
	let lib = emptyLibrary();
	const ml = createSubject(lib, "Machine Learning"); lib = ml.library;
	const alg = createSubject(lib, "Algorithms"); lib = alg.library;
	const dp = createTopic(lib, ml.subject.id, "Dynamic programming"); lib = dp.library;
	const rl = createTopic(lib, ml.subject.id, "Reinforcement learning"); lib = rl.library;
	return { lib, ml: ml.subject.id, dp: dp.topic.id, rl: rl.topic.id, alg: alg.subject.id };
}

describe("placement choice", () => {
	it("needs a subject and an explicit start mode; practice needs no start mode", () => {
		const { lib, ml, dp } = library();
		assert.equal(placementFromChoice(lib, emptyChoice), null);
		assert.match(missingPlacement(lib, emptyChoice), /Choose a subject/);
		assert.match(missingPlacement(lib, { subjectId: ml, topicId: "", startMode: "" }), /how to start/);
		assert.deepEqual(placementFromChoice(lib, { subjectId: ml, topicId: dp, startMode: "scratch" }), { subjectId: ml, topicId: dp, startMode: "scratch" });
		assert.deepEqual(placementFromChoice(lib, { subjectId: ml, topicId: "", startMode: "check" }), { subjectId: ml, startMode: "check" });
		assert.equal(missingPlacement(lib, { subjectId: ml, topicId: "", startMode: "" }, true), "");
		assert.equal(placementFromChoice(lib, { subjectId: ml, topicId: "", startMode: "" }, true)?.startMode, "check");
	});

	it("a stale subject or topic never produces a placement", () => {
		const { lib, ml } = library();
		assert.equal(placementFromChoice(lib, { subjectId: "sub_gone", topicId: "", startMode: "scratch" }), null);
		assert.equal(placementFromChoice(lib, { subjectId: ml, topicId: "top_gone", startMode: "scratch" }), null);
		assert.match(missingPlacement(lib, { subjectId: ml, topicId: "top_gone", startMode: "scratch" }), /no longer exists/);
	});

	it("remembers the last subject/topic that still exist, never the start mode", () => {
		const { lib, ml, dp } = library();
		assert.deepEqual(restoreChoice(lib, { subjectId: ml, topicId: dp, startMode: "scratch" }), { subjectId: ml, topicId: dp, startMode: "" });
		assert.deepEqual(restoreChoice(lib, { subjectId: ml, topicId: "top_gone" }), { subjectId: ml, topicId: "", startMode: "" });
		assert.deepEqual(restoreChoice(lib, { subjectId: "sub_gone", topicId: dp }), emptyChoice);
		assert.deepEqual(restoreChoice(lib, null), emptyChoice);
		assert.equal(placementLabel(lib, { subjectId: ml, topicId: dp }), "Machine Learning › Dynamic programming");
	});
});

describe("sidebar grouping", () => {
	const chat = (id: string, at: string, placement?: { subjectId: string; topicId?: string }) => ({ id, updatedAt: at, placement });

	it("groups chats by subject and topic, newest first, with a Not filed bucket", () => {
		const { lib, ml, dp, alg } = library();
		const chats = [
			chat("c1", "2026-11-01T00:00:00Z", { subjectId: ml, topicId: dp }),
			chat("c2", "2026-11-03T00:00:00Z", { subjectId: ml, topicId: dp }),
			chat("c3", "2026-11-02T00:00:00Z", { subjectId: ml }),
			chat("c4", "2026-11-04T00:00:00Z"),
			chat("c5", "2026-11-05T00:00:00Z", { subjectId: "sub_deleted" }),
			chat("c6", "2026-11-06T00:00:00Z", { subjectId: ml, topicId: "top_deleted" }),
		];
		const g = groupChats(lib, chats);
		assert.deepEqual(g.subjects.map((s) => s.subject.name), ["Algorithms", "Machine Learning"]);
		const mlGroup = g.subjects.find((s) => s.subject.id === ml)!;
		assert.deepEqual(mlGroup.chats.map((c) => c.id), ["c3"]);
		assert.deepEqual(mlGroup.topics.map((t) => t.topic.name), ["Dynamic programming", "Reinforcement learning"]);
		assert.deepEqual(mlGroup.topics[0]!.chats.map((c) => c.id), ["c2", "c1"]);
		assert.deepEqual(g.unfiled.map((c) => c.id), ["c6", "c5", "c4"], "no placement, a deleted subject and a deleted topic are all unfiled");
		assert.equal(g.subjects.find((s) => s.subject.id === alg)!.chats.length, 0, "empty subjects still appear");
	});

	it("the display order is what the keyboard walk follows", () => {
		const { lib, ml, dp, rl } = library();
		const g = groupChats(lib, [
			chat("a", "2026-11-01T00:00:00Z", { subjectId: ml, topicId: rl }),
			chat("b", "2026-11-02T00:00:00Z", { subjectId: ml, topicId: dp }),
			chat("c", "2026-11-03T00:00:00Z", { subjectId: ml }),
			chat("d", "2026-11-04T00:00:00Z"),
		]);
		assert.deepEqual(displayOrder(g).map((c) => c.id), ["c", "b", "a", "d"]);
	});
});

describe("placement picker view", () => {
	const state = (over: Partial<PlacementState> = {}): PlacementState => {
		const { lib, ml } = library();
		return {
			library: lib, loaded: true, choice: { subjectId: ml, topicId: "", startMode: "" }, placement: null, missing: "Choose how to start: from scratch, or check what you know first.",
			setSubject() {}, setTopic() {}, setStartMode() {}, async createSubject() {}, async createTopic() {}, error: "", ...over,
		};
	};

	it("lists subjects and topics, offers New subject / New topic, and shows both start modes unselected", () => {
		const html = renderToStaticMarkup(<PlacementPickerView state={state()} />);
		assert.match(html, /Machine Learning/);
		assert.match(html, /New subject…/);
		assert.match(html, /Whole subject/);
		assert.match(html, /Dynamic programming/);
		assert.match(html, /New topic…/);
		assert.match(html, /From scratch/);
		assert.match(html, /Check what I know first/);
		assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 0, "the start mode is asked every time: nothing preselected");
	});

	it("marks the chosen start mode and shows the missing-choice hint only when asked", () => {
		const chosen = renderToStaticMarkup(<PlacementPickerView state={state({ choice: { subjectId: library().ml, topicId: "", startMode: "scratch" } })} />);
		assert.match(chosen, /aria-checked="true"[^>]*data-testid="start-mode-scratch"|data-testid="start-mode-scratch"[^>]*aria-checked="true"/);
		assert.ok(!renderToStaticMarkup(<PlacementPickerView state={state()} />).includes("placement-hint"));
		assert.match(renderToStaticMarkup(<PlacementPickerView state={state()} showMissing />), /Choose how to start/);
	});

	it("a practice chat shows no start-mode choice; with no subject yet, only the subject picker shows", () => {
		assert.ok(!renderToStaticMarkup(<PlacementPickerView state={state()} practice />).includes("placement-start-mode"));
		const none = renderToStaticMarkup(<PlacementPickerView state={state({ library: emptyLibrary(), choice: emptyChoice })} />);
		assert.match(none, /New subject…/);
		assert.ok(!none.includes("placement-topic"));
	});
});
