/**
 * Study UI logic (Phase C / H4 picker): the placement choice rules, the two-column context panel, sidebar
 * Subject → Topic → chats grouping with multi-topic chats, and the pure search/sort helpers behind the panel.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createSubject, createTopic, emptyLibrary, type Library } from "../src/core/study/model.ts";
import {
	emptyChoice, matchesQuery, missingPlacement, orderedSubjects, orderedTopics, placementFromChoice,
	placementLabel, restoreChoice,
} from "../components/study/placement.ts";
import { displayOrder, groupChats } from "../components/study/group-chats.ts";
import type { PlacementState } from "../components/study/placement-picker.tsx";
import { ContextPanel, ContextPickerBar, topicButtonLabel } from "../components/study/placement-pills.tsx";

function library(): { lib: Library; ml: string; dp: string; rl: string; gr: string; alg: string } {
	let lib = emptyLibrary();
	const ml = createSubject(lib, "Machine Learning"); lib = ml.library;
	const alg = createSubject(lib, "Algorithms"); lib = alg.library;
	const dp = createTopic(lib, ml.subject.id, "Dynamic programming"); lib = dp.library;
	const rl = createTopic(lib, ml.subject.id, "Reinforcement learning"); lib = rl.library;
	const gr = createTopic(lib, ml.subject.id, "Graph theory"); lib = gr.library;
	return { lib, ml: ml.subject.id, dp: dp.topic.id, rl: rl.topic.id, gr: gr.topic.id, alg: alg.subject.id };
}

const state = (over: Partial<PlacementState> = {}): PlacementState => {
	const { lib, ml } = library();
	return {
		library: lib, loaded: true, choice: { subjectId: ml, topicIds: [], startMode: "" }, placement: null, missing: "",
		setSubject() {}, setTopic() {}, toggleTopic() {}, setTopics() {}, setStartMode() {},
		async createSubject() {}, async createTopic() {}, error: "", ...over,
	};
};

describe("placement choice", () => {
	it("needs a subject, defaults to scratch, and practice needs no start mode", () => {
		const { lib, ml, dp } = library();
		assert.equal(placementFromChoice(lib, emptyChoice), null);
		assert.match(missingPlacement(lib, emptyChoice), /Choose a subject/);
		assert.equal(missingPlacement(lib, { subjectId: ml, topicIds: [], startMode: "" }), "");
		assert.equal(placementFromChoice(lib, { subjectId: ml, topicIds: [], startMode: "" })?.startMode, "scratch");
		assert.deepEqual(placementFromChoice(lib, { subjectId: ml, topicIds: [dp], startMode: "scratch" }), { subjectId: ml, topicId: dp, topicIds: [dp], startMode: "scratch" });
		assert.deepEqual(placementFromChoice(lib, { subjectId: ml, topicIds: [], startMode: "check" }), { subjectId: ml, startMode: "check" });
		assert.equal(missingPlacement(lib, { subjectId: ml, topicIds: [], startMode: "" }, true), "");
		assert.equal(placementFromChoice(lib, { subjectId: ml, topicIds: [], startMode: "" }, true)?.startMode, "check");
	});

	it("accepts several topics and refuses any stale or wrong-subject one", () => {
		const { lib, ml, dp, rl, alg } = library();
		assert.deepEqual(placementFromChoice(lib, { subjectId: ml, topicIds: [dp, rl], startMode: "scratch" }), { subjectId: ml, topicIds: [dp, rl], startMode: "scratch" });
		assert.equal(placementFromChoice(lib, { subjectId: "sub_gone", topicIds: [], startMode: "scratch" }), null);
		assert.match(missingPlacement(lib, { subjectId: "sub_gone", topicIds: [], startMode: "scratch" }), /no longer exists/);
		assert.equal(placementFromChoice(lib, { subjectId: ml, topicIds: ["top_gone"], startMode: "scratch" }), null);
		assert.equal(placementFromChoice(lib, { subjectId: ml, topicIds: [dp, rl], startMode: "scratch" })?.topicId, undefined);
		assert.equal(placementFromChoice(lib, { subjectId: ml, topicIds: [dp, `top_${alg}`], startMode: "scratch" }), null);
	});

	it("remembers the last subject and every topic that still exist, never the start mode", () => {
		const { lib, ml, dp, rl } = library();
		assert.deepEqual(restoreChoice(lib, { subjectId: ml, topicIds: [dp, rl], startMode: "scratch" }), { subjectId: ml, topicIds: [dp, rl], startMode: "" });
		assert.deepEqual(restoreChoice(lib, { subjectId: ml, topicId: dp, startMode: "scratch" }), { subjectId: ml, topicIds: [dp], startMode: "" }, "the old single-id shape still reads");
		assert.deepEqual(restoreChoice(lib, { subjectId: ml, topicIds: [dp, "top_gone"] }), { subjectId: ml, topicIds: [dp], startMode: "" });
		assert.deepEqual(restoreChoice(lib, { subjectId: "sub_gone", topicIds: [dp] }), emptyChoice);
		assert.deepEqual(restoreChoice(lib, null), emptyChoice);
	});

	it("labels the scope as Subject, Subject › Topic, or Subject › 3 topics", () => {
		const { lib, ml, dp, rl, gr } = library();
		assert.equal(placementLabel(lib, { subjectId: ml }), "Machine Learning");
		assert.equal(placementLabel(lib, { subjectId: ml, topicId: dp }), "Machine Learning › Dynamic programming");
		assert.equal(placementLabel(lib, { subjectId: ml, topicIds: [dp, rl, gr] }), "Machine Learning › 3 topics");
	});
});

describe("picker search and order helpers", () => {
	it("puts the last-used subject and topic first, then name/order", () => {
		const { lib, ml, alg, rl } = library();
		assert.equal(orderedSubjects(lib)[0]!.name, "Algorithms");
		assert.equal(orderedSubjects(lib, ml)[0]!.id, ml);
		assert.equal(orderedSubjects(lib, alg)[0]!.id, alg);
		assert.equal(orderedTopics(lib, ml)[0]!.name, "Dynamic programming");
		assert.equal(orderedTopics(lib, ml, rl)[0]!.id, rl);
	});

	it("filters case-insensitively and ignores surrounding spaces", () => {
		assert.ok(matchesQuery("Dynamic Programming", "  dynamic  "));
		assert.ok(!matchesQuery("Machine Learning", "graphs"));
		assert.ok(matchesQuery("Machine Learning", ""));
	});
});

describe("sidebar grouping", () => {
	const chat = (id: string, at: string, placement?: { subjectId: string; topicId?: string; topicIds?: string[] }) => ({ id, updatedAt: at, placement });

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
		assert.deepEqual(mlGroup.topics.map((t) => t.topic.name), ["Dynamic programming", "Reinforcement learning", "Graph theory"]);
		assert.deepEqual(mlGroup.topics[0]!.chats.map((c) => c.id), ["c2", "c1"]);
		assert.deepEqual(g.unfiled.map((c) => c.id), ["c6", "c5", "c4"], "no placement, a deleted subject and a deleted topic are all unfiled");
		assert.equal(g.subjects.find((s) => s.subject.id === alg)!.chats.length, 0, "empty subjects still appear");
	});

	it("files a multi-topic chat under every selected topic but walks it only once", () => {
		const { lib, ml, dp, rl } = library();
		const multi = chat("m", "2026-11-01T00:00:00Z", { subjectId: ml, topicIds: [dp, rl] });
		const g = groupChats(lib, [multi, chat("stale", "2026-11-02T00:00:00Z", { subjectId: ml, topicIds: [dp, "top_gone"] })]);
		const mlGroup = g.subjects.find((s) => s.subject.id === ml)!;
		assert.deepEqual(mlGroup.topics.find((t) => t.topic.id === dp)!.chats.map((c) => c.id), ["m"]);
		assert.deepEqual(mlGroup.topics.find((t) => t.topic.id === rl)!.chats.map((c) => c.id), ["m"]);
		assert.deepEqual(g.unfiled.map((c) => c.id), ["stale"], "a stale id in the list makes the whole placement unfiled");
		assert.deepEqual(displayOrder(g).map((c) => c.id), ["m", "stale"]);
	});
});

describe("context picker view", () => {
	it("the compact bar shows the subject and the topic summary, not rows of pills", () => {
		const { lib, ml, dp, rl } = library();
		const html = renderToStaticMarkup(<ContextPickerBar state={state({ library: lib, choice: { subjectId: ml, topicIds: [dp, rl], startMode: "" } })} />);
		assert.match(html, /data-testid="context-bar"/);
		assert.match(html, /data-testid="context-subject-button"/);
		assert.match(html, /data-testid="context-topics-button"/);
		assert.match(html, /Machine Learning/);
		assert.match(html, /2 topics/);
		assert.ok(!html.includes("placement-pills"), "the old pill rows are gone");
		assert.equal(topicButtonLabel(state()), "Whole subject");
		assert.equal(topicButtonLabel(state({ library: lib, choice: { subjectId: ml, topicIds: [dp], startMode: "" } })), "Dynamic programming");
		assert.equal(topicButtonLabel(state({ library: lib, choice: { subjectId: ml, topicIds: [dp, rl], startMode: "" } })), "2 topics");
	});

	it("renders two searchable columns, Whole subject first, checkboxes and a Done footer", () => {
		const { lib, ml, dp } = library();
		const html = renderToStaticMarkup(<ContextPanel state={state({ library: lib, choice: { subjectId: ml, topicIds: [dp], startMode: "" } })} />);
		assert.match(html, /data-testid="context-panel"/);
		assert.match(html, /data-testid="context-search-subject"/);
		assert.match(html, /data-testid="context-search-topic"/);
		assert.match(html, /data-testid="context-column-subject"/);
		assert.match(html, /data-testid="context-column-topics"/);
		assert.match(html, /data-testid="context-subject-list"/);
		assert.match(html, /data-testid="context-topic-list"/);
		assert.match(html, /data-testid="context-new-subject"/);
		assert.match(html, /data-testid="context-new-topic"/);
		assert.match(html, /data-testid="context-done"/);
		assert.match(html, /data-testid="context-summary"[^>]*>Machine Learning › Dynamic programming/);
		assert.ok(html.indexOf('data-testid="context-topic-whole"') < html.indexOf(`data-testid="context-topic-${dp}"`), "Whole subject is first");
		assert.match(html, /aria-checked="true"/);
		assert.match(html, /files · \d topics/);
		assert.match(html, /files<\/span>/);
		assert.match(html, /data-testid="context-tabs"/);
	});

	it("opens focused on the clicked column", () => {
		const html = renderToStaticMarkup(<ContextPanel state={state()} focus="topics" />);
		assert.match(html, /aria-selected="true"[^>]*data-testid="context-tab-topics"/);
		assert.match(html, /data-testid="context-tab-subject"/);
	});

	it("shows the missing-choice hint only when asked", () => {
		assert.ok(!renderToStaticMarkup(<ContextPickerBar state={state()} />).includes("Choose a subject"));
		assert.match(renderToStaticMarkup(<ContextPickerBar state={state({ missing: "Choose a subject for this chat." })} showMissing />), /Choose a subject/);
	});

	it("with no subject the topic button is disabled and the panel still offers a new subject", () => {
		const bar = renderToStaticMarkup(<ContextPickerBar state={state({ library: emptyLibrary(), choice: emptyChoice })} />);
		assert.match(bar, /data-testid="context-subject-button"/);
		assert.match(bar, /data-testid="context-topics-button"[^>]*disabled/);
		const panel = renderToStaticMarkup(<ContextPanel state={state({ library: emptyLibrary(), choice: emptyChoice })} />);
		assert.match(panel, /data-testid="context-new-subject"/);
		assert.match(panel, /Whole subject/);
	});
});
