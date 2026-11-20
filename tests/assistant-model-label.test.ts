import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { assistantViewModel, projectView, type LhMessage } from "../src/core";
import { prettyModel } from "../components/usage-format";

let seq = 0;
function assistant(provider?: string, model?: string, responseModel?: string): LhMessage {
	const base = fauxAssistantMessage("A lesson.");
	const message = { ...base, id: `msg_a${seq++}` } as LhMessage & { provider?: unknown; model?: unknown; responseModel?: unknown };
	if (provider === undefined) delete message.provider; else message.provider = provider;
	if (model === undefined) delete message.model; else message.model = model;
	if (responseModel !== undefined) message.responseModel = responseModel;
	return message as LhMessage;
}
function user(text: string): LhMessage {
	return { role: "user", content: text, timestamp: Date.now(), id: `msg_u${seq++}` } as LhMessage;
}
function toolResult(): LhMessage {
	return { role: "toolResult", toolCallId: "c1", toolName: "quiz", content: [{ type: "text", text: "ok" }], details: null, isError: false, timestamp: Date.now(), id: `msg_r${seq++}` } as LhMessage;
}

describe("assistant model label", () => {
	it("stamps native assistant messages with provider:model, ignoring responseModel", () => {
		assert.equal(assistantViewModel(assistant("claude-code", "haiku", "claude-3.5-2024")), "claude-code:haiku");
		assert.equal(assistantViewModel(assistant("openrouter", "deepseek/deepseek-r1")), "openrouter:deepseek/deepseek-r1");
	});

	it("returns nothing for legacy stamps or non-assistant messages", () => {
		assert.equal(assistantViewModel(assistant(undefined, "haiku")), undefined);
		assert.equal(assistantViewModel(assistant("claude-code", undefined)), undefined);
		assert.equal(assistantViewModel(assistant("", "haiku")), undefined);
		assert.equal(assistantViewModel(user("hello")), undefined);
		assert.equal(assistantViewModel(toolResult()), undefined);
	});

	it("formats qualified stamps as short name · provider", () => {
		assert.equal(prettyModel("claude-code:haiku", true), "haiku · claude-code");
		assert.equal(prettyModel("openrouter:deepseek/deepseek-r1", true), "deepseek-r1 · openrouter");
		assert.equal(prettyModel("haiku"), "haiku");
	});

	it("sets one group model, keeping the last known step's stamp", () => {
		const first = assistant("claude-code", "sonnet");
		const second = assistant("openrouter", "haiku");
		const legacy = assistant(undefined, undefined);
		const view = projectView([user("question"), first, toolResult(), second, legacy]);
		const groups = view.filter((message) => message.role === "assistant");
		assert.equal(groups.length, 1, "the steps share one view group");
		assert.equal(groups[0]!.model, "openrouter:haiku", "last known model wins; a legacy step does not clear it");
		assert.equal(view[0]!.model, undefined, "user messages never carry a model");
	});

	it("omits the field for a purely legacy assistant group", () => {
		const view = projectView([assistant(undefined, undefined)]);
		assert.equal("model" in view[0]!, false);
	});
});
