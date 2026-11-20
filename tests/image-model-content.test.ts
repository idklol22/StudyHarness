/** Image bytes must reach EVERY engine as native image content. The seams are
 *  the existing input parser, native message conversion, side-turn map, pi
 *  context normalizer and the Claude Code stream-json transcript builder. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAssistantMessageEventStream, createFauxCore, fauxAssistantMessage, type ImageContent, type TranscriptContext } from "@earendil-works/pi-ai";
import { inputAppends, parseChatInput } from "../src/core/input-events.ts";
import { newUserMessage, toLlmMessages } from "../src/core/native-messages.ts";
import { newSideQuestion, parseSideAskInput, sideChatModelTurns } from "../src/core/side-chat.ts";
import { toClaudeInput, toStreamJsonLine } from "../src/agent/claude-code/transcript.ts";
import { sideChatModelMessages, streamSideAnswer } from "../src/agent/side-chat.ts";
import type { PiEngine } from "../src/agent/models.ts";

const image: ImageContent = { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" };
const anchor = { messageId: "msg_a", partId: "msg_a-t0", blockIndex: 0, blockText: "A passage." };

test("chat text input becomes native image content and survives the Claude Code stream-json path", () => {
	const input = parseChatInput({ type: "text", text: "", images: [image] });
	const appended = inputAppends({ messages: [] }, input);
	assert.equal(appended[0]!.role, "user");
	const llm = toLlmMessages(appended);
	assert.deepEqual(llm[0]!.content, [image]);
	const claude = toClaudeInput(llm);
	assert.deepEqual(claude.userContent, [{ type: "image", source: { type: "base64", media_type: "image/png", data: image.data } }]);
	const line = JSON.parse(toStreamJsonLine(claude.userContent));
	assert.equal(line.type, "user");
	assert.deepEqual(line.message.content[0].source, { type: "base64", media_type: "image/png", data: image.data });
});

test("side ask transport, thread replay and model messages carry the image block", () => {
	const ask = parseSideAskInput({ threadId: "side_x", text: "", images: [image] });
	assert.deepEqual(ask.images, [image]);
	const question = newSideQuestion(ask.text, ask.quotes, ask.images);
	assert.deepEqual(question.images, [image]);
	const turns = sideChatModelTurns({ id: "side_x", anchor, open: true, createdAt: "now", messages: [question] }, "LESSON");
	assert.deepEqual(turns[0]!.images, [image]);
	const messages = sideChatModelMessages(turns, { api: "anthropic-messages", provider: "claude-code", id: "sonnet" });
	const content = messages[0]!.content as ImageContent[];
	assert.ok(Array.isArray(content));
	assert.deepEqual(content.filter(block => block.type === "image"), [image]);
	assert.deepEqual(toClaudeInput(messages).userContent.filter(block => block.type === "image"), [
		{ type: "image", source: { type: "base64", media_type: "image/png", data: image.data } },
	]);
});

test("side-chat stream passes images into the provider context, engine-agnostically", async () => {
	const faux = createFauxCore({});
	let seen: TranscriptContext | undefined;
	const engine: PiEngine = { model: { ...faux.getModel(), input: ["text", "image"] }, streamFn: (_model, context) => {
		seen = context as TranscriptContext;
		const stream = createAssistantMessageEventStream();
		stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("ok") });
		return stream;
	} };
	const question = newSideQuestion("look at this", [], [image]);
	const turns = sideChatModelTurns({ id: "side_y", anchor, open: true, createdAt: "now", messages: [question] }, "LESSON");
	const result = await streamSideAnswer({ engine, instructions: "brief", turns });
	assert.equal(result.outcome, "done");
	const last = seen!.messages.at(-1)!;
	assert.equal(last.role, "user");
	assert.deepEqual((last.content as ImageContent[]).filter(block => block.type === "image"), [image]);
});

test("plain chat messages with images also survive the native replay used by every engine", () => {
	const message = newUserMessage("", [image]);
	assert.deepEqual(toLlmMessages([message])[0]!.content, [image]);
});
