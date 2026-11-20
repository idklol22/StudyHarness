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

	it("only produces MCQs and flashcards on explicit request", () => {
		assert.match(prompt, /Do not volunteer multiple-choice questions or flashcards/);
		assert.match(prompt, /always give the full set requested in your reply/);
		assert.match(prompt, /Never offer to make them instead of making them/);
	});

	it("keeps plain mode free of the doctrine flashcard header", () => {
		assert.doesNotMatch(prompt, /Flashcards:/);
		assert.ok(prompt.includes("study_context"));
		assert.ok(prompt.includes("save_chat_notes"));
	});
});
