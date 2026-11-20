/**
 * Pure tests for the 2D subject graph's node mapping and label decluttering
 * (components/study/subject-map-graph.ts). No DOM, no canvas — just the
 * decisions the renderer runs every frame.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	IDEA_LABEL_ZOOM,
	nodeColor,
	nodeRadius,
	selectVisibleLabels,
	shortLabel,
	type LabelCandidate,
} from "../components/study/subject-map-graph.ts";

describe("node mapping", () => {
	it("sizes subjects, topics and ideas as large, medium and small", () => {
		assert.equal(nodeRadius("subject"), 34);
		assert.equal(nodeRadius("topic"), 18);
		assert.equal(nodeRadius("idea"), 7);
	});

	it("uses the subject hue with lighter tints for children", () => {
		assert.equal(nodeColor(205, "subject"), "hsl(205 26% 58%)");
		assert.equal(nodeColor(205, "topic"), "hsl(205 26% 72%)");
		assert.equal(nodeColor(205, "idea"), "hsl(205 26% 84%)");
	});

	it("truncates long labels", () => {
		assert.equal(shortLabel("Short"), "Short");
		assert.equal(shortLabel("x".repeat(30)), `${"x".repeat(23)}…`);
	});
});

describe("selectVisibleLabels", () => {
	const base: LabelCandidate[] = [
		{ id: "s", kind: "subject", label: "OS", x: 100, y: 100, r: 34 },
		{ id: "t", kind: "topic", label: "Memory", x: 250, y: 100, r: 18 },
		{ id: "i", kind: "idea", label: "Paging", x: 400, y: 100, r: 7, parentId: "t" },
	];

	it("always labels subjects and topics, never idle ideas", () => {
		const labels = selectVisibleLabels(base, 1);
		assert.deepEqual(labels.map((l) => l.id), ["s", "t"]);
	});

	it("fades ideas in past 1.6×", () => {
		const labels = selectVisibleLabels(base, IDEA_LABEL_ZOOM);
		assert.deepEqual(labels.map((l) => l.id), ["s", "t", "i"]);
		const idea = labels.find((l) => l.id === "i");
		assert.ok(idea && idea.opacity > 0 && idea.opacity <= 1);
		assert.deepEqual(selectVisibleLabels(base, 1.2).map((l) => l.id), ["s", "t"]);
	});

	it("shows an idea when it or its topic is in the hover focus", () => {
		assert.deepEqual(selectVisibleLabels(base, 1, new Set(["i"])).map((l) => l.id), ["s", "t", "i"]);
		assert.equal(selectVisibleLabels(base, 1, new Set(["t"])).find((l) => l.id === "i")?.opacity, 1);
	});

	it("keeps the higher-priority node when two labels collide", () => {
		const colliding: LabelCandidate[] = [
			{ id: "s", kind: "subject", label: "OS", x: 100, y: 100, r: 34 },
			{ id: "t", kind: "topic", label: "Memory", x: 100, y: 118, r: 18 },
		];
		assert.deepEqual(selectVisibleLabels(colliding, 1).map((l) => l.id), ["s"]);
	});

	it("picks the biggest of two colliding labels of the same kind", () => {
		const colliding: LabelCandidate[] = [
			{ id: "small", kind: "idea", label: "A", x: 10, y: 23, r: 7, parentId: "t" },
			{ id: "big", kind: "idea", label: "B", x: 10, y: 10, r: 20, parentId: "t" },
		];
		assert.deepEqual(selectVisibleLabels(colliding, 2, new Set(["t"])).map((l) => l.id), ["big"]);
	});

	it("drops later colliding labels but keeps distant ones", () => {
		const crowded: LabelCandidate[] = [
			{ id: "t1", kind: "topic", label: "Long topic name", x: 10, y: 10, r: 18 },
			{ id: "t2", kind: "topic", label: "Long topic name", x: 25, y: 10, r: 18 },
			{ id: "t3", kind: "topic", label: "Elsewhere", x: 600, y: 10, r: 18 },
		];
		assert.deepEqual(selectVisibleLabels(crowded, 1).map((l) => l.id), ["t1", "t3"]);
	});
});
