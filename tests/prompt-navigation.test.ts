/** T20 sticky prompt: pure extraction and active-index helpers. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	activePromptIndex,
	isPromptMessage,
	promptAnchorId,
	promptEntriesOf,
	promptLabel,
	promptTickTop,
	promptTooltipTop,
} from "../src/core/prompt-navigation.ts";
import type { LhViewMessage, LhViewPart } from "../src/core/view.ts";

const text = (value: string): LhViewPart => ({ type: "text", text: value });
const image = (): LhViewPart => ({ type: "image", data: "abc", mimeType: "image/png" });
const data = (type: string): LhViewPart => ({ type, data: {} });
const user = (id: string, ...parts: LhViewPart[]): LhViewMessage => ({ id, role: "user", parts });
const assistant = (id: string): LhViewMessage => ({ id, role: "assistant", parts: [text("reply")] });

describe("promptEntriesOf", () => {
	it("keeps authored text/image prompts and skips data-only and marker rows", () => {
		const messages: LhViewMessage[] = [
			user("u1", text("  Hello\n  world  ")),
			user("m1", data("data-graph-context")),
			user("m2", data("data-probe-handoff")),
			user("m3", text("teacher-facing"), data("data-subagent-artifact")),
			user("m4", text("steer"), data("data-subagent-aborted")),
			user("u2", image()),
			user("m5", data("data-plugin-problem-submission")),
			user("m6", data("data-practice-thinking")),
			user("m7", data("data-practice-next")),
			user("m8", data("data-compaction")),
			user("m9", data("data-compaction-cut")),
			assistant("a1"),
		];
		const entries = promptEntriesOf(messages);
		assert.deepEqual(entries.map((entry) => [entry.id, entry.text, entry.index]), [
			["u1", "Hello world", 0],
			["u2", "Image", 5],
		]);
		assert.equal(entries[0]!.anchorId, "prompt-u1");
		assert.equal(entries[1]!.anchorId, "prompt-u2");
		assert.equal(isPromptMessage(messages[0]!), true);
		assert.equal(isPromptMessage(messages[1]!), false);
		assert.equal(isPromptMessage(messages[2]!), false);
		assert.equal(isPromptMessage(messages[3]!), false);
		assert.equal(isPromptMessage(assistant("a2")), false);
	});

	it("collapses whitespace in labels and labels image-only prompts Image", () => {
		const entries = promptEntriesOf([
			user("u1", text(" one \t two\n\n three ")),
			user("u2", text("   "), image()),
			user("u3", text("with"), image(), text(" attachment")),
		]);
		assert.equal(entries[0]!.text, "one two three");
		assert.equal(entries[1]!.text, "Image");
		assert.equal(entries[2]!.text, "with attachment");
	});

	it("sets hasReply only when an assistant message precedes the next prompt", () => {
		const entries = promptEntriesOf([
			user("u1", text("first")),
			user("marker", data("data-compaction-cut")),
			assistant("a1"),
			user("u2", text("second")),
			user("marker2", data("data-practice-next")),
			user("u3", text("third")),
			assistant("a2"),
			user("u4", text("trailing")),
		]);
		assert.deepEqual(entries.map((entry) => entry.hasReply), [true, false, true, false]);
	});

	it("de-duplicates legacy ids by native id, keeping the first entry", () => {
		const entries = promptEntriesOf([
			user("dup", text("first")),
			assistant("a1"),
			user("dup", text("second")),
			assistant("a2"),
		]);
		assert.equal(entries.length, 1);
		assert.equal(entries[0]!.id, "dup");
		assert.equal(entries[0]!.text, "first");
		assert.equal(entries[0]!.index, 0);
		assert.equal(entries[0]!.hasReply, true);
	});
});

describe("activePromptIndex", () => {
	it("returns the last anchor at or above the viewport top", () => {
		assert.equal(activePromptIndex([10, 20, 30], 25), 1);
		assert.equal(activePromptIndex([10, 20, 30], 30), 2);
		assert.equal(activePromptIndex([10, 20, 30], 9), -1);
		assert.equal(activePromptIndex([], 100), -1);
	});

	it("uses the supplied order even when the input is unsorted", () => {
		assert.equal(activePromptIndex([30, 10, 20], 25), 2);
		assert.equal(activePromptIndex([20, 30, 10], 15), 2);
		assert.equal(activePromptIndex([20, 30, 10], 40), 2);
	});
});

describe("anchor and label helpers", () => {
	it("builds a stable prompt- anchor id", () => {
		assert.equal(promptAnchorId("msg_42"), "prompt-msg_42");
		assert.equal(promptAnchorId("msg_42"), promptAnchorId("msg_42"));
		assert.equal(promptAnchorId(""), "prompt-");
	});

	it("collapses whitespace and defaults to Image", () => {
		assert.equal(promptLabel("  a \t b\n c  "), "a b c");
		assert.equal(promptLabel(""), "Image");
		assert.equal(promptLabel(" \n\t "), "Image");
		assert.equal(promptLabel(), "Image");
	});
});

describe("promptTickTop", () => {
	it("centers the lone tick for a single prompt", () => {
		assert.equal(promptTickTop(0, 1), 50);
		assert.equal(promptTickTop(-3, 1), 50);
		assert.equal(promptTickTop(7, 1), 50);
	});

	it("spaces ticks evenly with the first at 0 and the last at 100", () => {
		assert.deepEqual([0, 1, 2, 3, 4].map((i) => promptTickTop(i, 5)), [0, 25, 50, 75, 100]);
		assert.equal(promptTickTop(0, 4), 0);
		assert.equal(promptTickTop(3, 4), 100);
		const thirds = [0, 1, 2, 3].map((i) => promptTickTop(i, 4));
		assert.ok(Math.abs(thirds[1]! - 100 / 3) < 1e-9);
		assert.ok(Math.abs(thirds[2]! - 200 / 3) < 1e-9);
	});

	it("clamps out-of-range indexes to the first/last tick", () => {
		assert.equal(promptTickTop(-5, 4), 0);
		assert.equal(promptTickTop(-1, 3), 0);
		assert.equal(promptTickTop(99, 4), 100);
		assert.equal(promptTickTop(4, 3), 100);
	});

	it("returns 50 when count is not positive", () => {
		assert.equal(promptTickTop(0, 0), 50);
		assert.equal(promptTickTop(-2, 0), 50);
		assert.equal(promptTickTop(3, -5), 50);
	});
});

describe("promptTooltipTop", () => {
	it("centers the tooltip when count is at most one", () => {
		assert.equal(promptTooltipTop(0, 1), 50);
		assert.equal(promptTooltipTop(4, 1), 50);
		assert.equal(promptTooltipTop(0, 0), 50);
		assert.equal(promptTooltipTop(2, -1), 50);
	});

	it("clamps the first and last tick to 8 and 92 but keeps middle ticks exact", () => {
		assert.equal(promptTooltipTop(0, 3), 8);
		assert.equal(promptTooltipTop(2, 3), 92);
		assert.equal(promptTooltipTop(1, 3), 50);
		assert.deepEqual([0, 1, 2, 3, 4].map((i) => promptTooltipTop(i, 5)), [8, 25, 50, 75, 92]);
		assert.ok(Math.abs(promptTooltipTop(1, 4) - 100 / 3) < 1e-9);
	});

	it("clamps the index before clamping the percent", () => {
		assert.equal(promptTooltipTop(-5, 4), 8);
		assert.equal(promptTooltipTop(99, 4), 92);
	});
});
