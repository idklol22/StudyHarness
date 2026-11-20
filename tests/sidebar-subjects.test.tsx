/**
 * The Round 5 sidebar Subjects panel: pure row counts/order/label formatting plus a static
 * render of the presentational view (same classic-JSX shim as the other UI tests — no browser).
 * The connected panel's localStorage/POST/navigation seams stay in the component; what's pinned
 * here is the markup a learner sees and the data feeding it.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createSubject, createTopic, emptyLibrary, type Library, type Material } from "../src/core/study/model.ts";
import { groupChats } from "../components/study/group-chats.ts";
import {
	formatSubjectMeta,
	subjectCounts,
	subjectRows,
	SubjectPanelView,
	type SubjectRowData,
} from "../components/study/subject-panel.tsx";

function fixture(): { lib: Library; ml: string; dp: string; rl: string; alg: string } {
	let lib = emptyLibrary();
	const ml = createSubject(lib, "Machine Learning"); lib = ml.library;
	const alg = createSubject(lib, "Algorithms"); lib = alg.library;
	const dp = createTopic(lib, ml.subject.id, "Dynamic programming"); lib = dp.library;
	const rl = createTopic(lib, ml.subject.id, "Reinforcement learning"); lib = rl.library;
	const material: Material = {
		id: "m1",
		sha256: "a".repeat(64),
		fileName: "notes.pdf",
		pageCount: 3,
		bytes: 100,
		scope: { subjectId: ml.subject.id },
		addedAt: "2026-01-01T00:00:00.000Z",
	};
	lib = { ...lib, materials: [material] };
	return { lib, ml: ml.subject.id, dp: dp.topic.id, rl: rl.topic.id, alg: alg.subject.id };
}

const chat = (id: string, at: string, placement?: { subjectId: string; topicId?: string }) => ({ id, updatedAt: at, placement });

function rows(): { lib: Library; ml: string; dp: string; alg: string; data: SubjectRowData[] } {
	const { lib, ml, dp, alg } = fixture();
	const grouped = groupChats(lib, [
		chat("c1", "2026-11-01T00:00:00Z", { subjectId: ml, topicId: dp }),
		chat("c2", "2026-11-03T00:00:00Z", { subjectId: ml, topicId: dp }),
		chat("c3", "2026-11-02T00:00:00Z", { subjectId: ml }),
	]);
	return { lib, ml, dp, alg, data: subjectRows(lib, grouped) };
}

const view = (rowsData: SubjectRowData[], lib: Library, over: Partial<React.ComponentProps<typeof SubjectPanelView>> = {}) =>
	renderToStaticMarkup(
		<SubjectPanelView
			rows={rowsData}
			library={lib}
			collapsed={new Set()}
			pathname="/"
			adding=""
			onToggle={() => {}}
			onAddSubject={() => {}}
			onAddTopic={() => {}}
			onNewChat={() => {}}
			onCancelAdd={() => {}}
			onCreateSubject={() => {}}
			onCreateTopic={() => {}}
			onChanged={() => {}}
			{...over}
		/>,
	);

describe("subject row counts and label formatting", () => {
	it("counts files, topics and chats (a subject's chats include its topics' chats)", () => {
		const { lib, ml, alg } = rows();
		const grouped = groupChats(lib, []);
		assert.deepEqual(subjectCounts(lib, grouped, ml), { files: 1, topics: 2, chats: 0 }, "counts work before chats load");
		assert.deepEqual(subjectCounts(lib, grouped, alg), { files: 0, topics: 0, chats: 0 }, "an empty subject still counts");

		const withChats = rows();
		const mlRow = withChats.data.find((r) => r.subject.id === withChats.ml)!;
		assert.deepEqual(mlRow.counts, { files: 1, topics: 2, chats: 3 }, "2 topic chats + 1 subject chat");
	});

	it("rows are in name order and carry each topic's chat count", () => {
		const { data, ml, dp } = rows();
		assert.deepEqual(data.map((r) => r.subject.name), ["Algorithms", "Machine Learning"]);
		const mlRow = data.find((r) => r.subject.id === ml)!;
		assert.deepEqual(mlRow.topics.map((t) => [t.topic.name, t.chatCount]), [
			["Dynamic programming", 2],
			["Reinforcement learning", 0],
		]);
		assert.equal(mlRow.topics.find((t) => t.topic.id === dp)!.chatCount, 2);
	});

	it("the quiet meta pluralizes each count", () => {
		assert.equal(formatSubjectMeta({ files: 1, topics: 2, chats: 3 }), "1 file · 2 topics · 3 chats");
		assert.equal(formatSubjectMeta({ files: 0, topics: 0, chats: 0 }), "0 files · 0 topics · 0 chats");
		assert.equal(formatSubjectMeta({ files: 2, topics: 1, chats: 1 }), "2 files · 1 topic · 1 chat");
	});
});

describe("Subjects panel markup", () => {
	it("shows a clear Subjects header with a visible New subject action and coloured, roomy rows", () => {
		const { data, lib, ml } = rows();
		const html = view(data, lib);
		assert.match(html, /data-testid="subjects-panel"/);
		assert.match(html, />Subjects</);
		assert.match(html, /data-testid="add-subject"/);
		assert.match(html, /New subject<\/button>/, "the action has a visible label, not just an icon");

		assert.match(html, new RegExp(`data-testid="subject-${ml}"`));
		assert.match(html, new RegExp(`href="/subjects/${ml}"`));
		assert.match(html, /min-h-10/, "roomy (~40px) rows");
		assert.match(html, /text-sm/, "14px names");
		assert.match(html, /1 file · 2 topics · 3 chats/, "quiet counts");
		assert.match(html, /hsl\(\d+ 26% var\(--lh-subject-l, 58%\)\)/, "the colour dot uses the shared subject colour");
	});

	it("quick actions are in the markup without any hover state", () => {
		const { data, lib } = rows();
		const html = view(data, lib);
		assert.match(html, /aria-label="New topic in Machine Learning"/);
		assert.match(html, /aria-label="New chat in Machine Learning"/);
		assert.match(html, /aria-label="Change colour for Machine Learning"/);
		assert.doesNotMatch(html, /opacity-0/, "no hover-only actions — that was the old tree's problem");
	});

	it("topics render one level deep with links and chat counts, and collapse hides them", () => {
		const { data, lib, ml, dp } = rows();
		const open = view(data, lib);
		assert.match(open, new RegExp(`data-testid="topic-${dp}"`));
		assert.match(open, new RegExp(`href="/subjects/${ml}/${dp}"`));
		assert.match(open, /2 chats/);

		const collapsed = view(data, lib, { collapsed: new Set([ml]) });
		assert.doesNotMatch(collapsed, new RegExp(`data-testid="topic-${dp}"`), "collapsed subjects hide their topics");
		assert.match(collapsed, new RegExp(`data-testid="subject-${ml}"`), "the subject row remains");
	});

	it("the add-subject action reveals an inline input; an empty library has an empty hint", () => {
		const { data, lib } = rows();
		assert.match(view(data, lib, { adding: "subject" }), /aria-label="New subject name"/);
		assert.match(view([], emptyLibrary()), /No subjects yet/);
	});
});
