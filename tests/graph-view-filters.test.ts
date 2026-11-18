/**
 * Legend/filters predicate tests — the pure half of the graph-view filters
 * panel (isNodeVisible); the sigma reducers just consume its verdict.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayCostTotals, graphGroups, hiddenByGroups, isNodeVisible } from "../components/graph-view.tsx";

const node = {
	name: "Money multiplier",
	statement: "The maximum ratio of broad money a bank can create from each unit of base money.",
};

describe("isNodeVisible (search predicate)", () => {
	it("is visible with an empty query", () => {
		assert.equal(isNodeVisible(node, ""), true);
	});

	it("search matches the statement case-insensitively", () => {
		assert.equal(isNodeVisible(node, "MONEY multiplier"), true);
	});

	it("search matches the statement when the name does not", () => {
		assert.equal(isNodeVisible(node, "MAXIMUM ratio"), true);
		assert.equal(isNodeVisible(node, " velocity"), false);
	});

	it("search matches the name when the statement does not", () => {
		assert.equal(isNodeVisible(node, "money MULTIPLIER"), true);
		assert.equal(isNodeVisible(node, " banking"), false);
	});

	it("whitespace-only query is no filter", () => {
		assert.equal(isNodeVisible(node, "   "), true);
	});


});

describe("displayCostTotals (naming-free cost fold)", () => {
	const stage = (dollars: number, unpricedRuns = 0) => ({
		runs: dollars > 0 ? 1 : 0,
		dollars,
		unpricedRuns,
		tokens: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			reasoningTokens: 0,
		},
	});
	const costs = {
		stages: {
			extraction: stage(1.25, 1),
			audit: stage(0.75),
			naming: stage(9.99, 2), // dead channel — must never reach the display
		},
	} as const;

	it("sums the live stages only — the dead namer's spend is invisible", () => {
		assert.equal(displayCostTotals(costs).totalDollars, 2);
	});

	it("unpriced counts fold the same two stages", () => {
		assert.equal(displayCostTotals(costs).unpricedRuns, 1);
	});
});

describe("graph groups (Obsidian legend, Study redesign 2026-11-18)", () => {
	const clusters = [
		{ id: "chat_a", label: "Lecture 3", members: ["n1", "n2", "n3"] },
		{ id: "src_b", label: null, members: ["n3", "n4"] },
		{ id: "chat_c", label: "Empty after dedupe", members: ["n1"] },
	];
	it("counts each node once, under the first group that lists it (its color)", () => {
		const groups = graphGroups(clusters);
		assert.deepEqual(groups.map((g) => [g.id, g.label, g.count]), [["chat_a", "Lecture 3", 3], ["src_b", "Untitled", 1]]);
	});
	it("live renames override labels", () => {
		assert.equal(graphGroups(clusters, new Map([["chat_a", "Renamed"]]))[0]?.label, "Renamed");
	});
	it("hiding a group hides exactly the nodes it colors", () => {
		assert.deepEqual([...hiddenByGroups(clusters, new Set(["src_b"]))], ["n4"]);
		assert.deepEqual([...hiddenByGroups(clusters, new Set(["chat_a"]))].sort(), ["n1", "n2", "n3"]);
		assert.equal(hiddenByGroups(clusters, new Set()).size, 0);
	});
});
