import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSideAskInput, resolveFollowUpSpec, SideChatInputError, type ChatSettings, type SideChatAnchor, type UserSettings } from "../src/core";

const anchor: SideChatAnchor = { messageId: "msg_1", partId: "msg_1-t0", blockIndex: 0, blockText: "A paragraph." };
const picked = { provider: "claude-code", id: "haiku" };

describe("follow-up model resolution", () => {
	it("an explicit override wins outright, with no thinking level", () => {
		const chat: ChatSettings = { model: { provider: "strong", id: "session-model" }, thinkingLevel: "high" };
		const record: UserSettings = {
			version: 1,
			agent: {
				models: { sideQuestion: { model: { provider: "side", id: "side-model" }, thinkingLevel: "low" } },
				smallTasks: { followUpModel: "cheap", openRouter: { enabled: true, model: { provider: "openrouter", id: "or-cheap" } } },
			},
			models: { strong: { model: { provider: "strong", id: "slot" } }, cheap: { model: { provider: "cheap", id: "slot" } } },
		};
		assert.deepEqual(resolveFollowUpSpec(picked, chat, record, true), { provider: "claude-code", id: "haiku" });
	});

	it("an absent override delegates to the Settings side-question chain", () => {
		const sideQuestion: UserSettings = { version: 1, agent: { models: { sideQuestion: { model: { provider: "side", id: "s" }, thinkingLevel: "low" } } } };
		assert.deepEqual(resolveFollowUpSpec(undefined, undefined, sideQuestion), { provider: "side", id: "s", thinkingLevel: "low" });

		const cheap: UserSettings = {
			version: 1,
			agent: { smallTasks: { followUpModel: "cheap" } },
			models: { strong: { model: { provider: "strong", id: "s" } }, cheap: { model: { provider: "cheap", id: "c" } } },
		};
		assert.deepEqual(resolveFollowUpSpec(undefined, undefined, cheap), { provider: "cheap", id: "c", thinkingLevel: undefined });

		const routed: UserSettings = {
			version: 1,
			agent: { smallTasks: { followUpModel: "cheap", openRouter: { enabled: true, model: { provider: "openrouter", id: "or-cheap" } } } },
			models: { cheap: { model: { provider: "cheap", id: "c" } } },
		};
		assert.deepEqual(resolveFollowUpSpec(undefined, undefined, routed, true), { provider: "openrouter", id: "or-cheap", thinkingLevel: "off" });
	});

	it("returns null when nothing is configured", () => {
		assert.equal(resolveFollowUpSpec(undefined, undefined, null), null);
	});
});

describe("side ask model payload", () => {
	it("accepts and preserves a valid model on an anchor body", () => {
		const input = parseSideAskInput({ anchor, text: "why?", quotes: [], model: picked });
		assert.deepEqual(input.model, picked);
		assert.equal(input.anchor?.blockIndex, 0);
	});

	it("accepts and preserves a valid model on a threadId body and on a retry", () => {
		assert.deepEqual(parseSideAskInput({ threadId: "side_x", text: "more", model: picked }).model, picked);
		assert.deepEqual(parseSideAskInput({ threadId: "side_x", retry: true, model: picked }).model, picked);
		assert.equal(parseSideAskInput({ threadId: "side_x", text: "more" }).model, undefined, "absence keeps Settings resolution");
	});

	it("rejects malformed provider or id with the single input error", () => {
		for (const model of [
			null,
			"claude-code:haiku",
			{},
			{ provider: "", id: "haiku" },
			{ provider: "has spaces", id: "haiku" },
			{ provider: "x".repeat(65), id: "haiku" },
			{ provider: "claude-code", id: "" },
			{ provider: "claude-code", id: "   " },
			{ provider: "claude-code", id: "x".repeat(201) },
			{ provider: "claude-code" },
		]) {
			assert.throws(() => parseSideAskInput({ threadId: "side_x", text: "q", model }), (error: unknown) =>
				error instanceof SideChatInputError && error.message === "model is invalid", JSON.stringify(model));
		}
	});
});
