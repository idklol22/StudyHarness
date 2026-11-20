import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

// ROOT-anchored shipped asset: no data-dir setup, no engine, no writes.
const prompt = fs.readFileSync(new URL("../src/agent/study-chat-prompt.md", import.meta.url), "utf8");

describe("study chat prompt: questions outside course theory", () => {
	it("asks for a full, descriptive answer when the files do not cover the question", () => {
		assert.match(prompt, /full, descriptive explanation/);
		assert.match(prompt, /outside their course files/);
	});

	it("no longer tells the agent to answer normally", () => {
		assert.doesNotMatch(prompt, /answer normally/);
	});

	it("keeps the unchanged instructions intact", () => {
		for (const invariant of [
			"study_context",
			"study_material",
			"show_figure",
			"save_chat_notes",
			"Never invent a citation",
		]) {
			assert.ok(prompt.includes(invariant), `missing unchanged instruction: ${invariant}`);
		}
	});
});
