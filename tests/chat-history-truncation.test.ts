/** Token diet: big tool results from earlier learner turns are shrunk in the history sent to the model. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Message } from "@earendil-works/pi-ai";
import { STALE_TOOL_RESULT_CHARS, truncateStaleToolResults } from "../src/core/native-messages.ts";

const user = (text: string): Message => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });
const result = (toolName: string, text: string, extra: unknown[] = []): Message => ({ role: "toolResult", toolCallId: `c-${toolName}`, toolName, content: [{ type: "text", text }, ...extra] as never, isError: false, timestamp: 1 });
const textOf = (m: Message) => (m.content as Array<{ type: string; text?: string }>).map((b) => b.text ?? `<${b.type}>`).join("");

describe("truncateStaleToolResults", () => {
	const big = "p".repeat(STALE_TOOL_RESULT_CHARS + 500);

	it("replaces a large page-text result from an earlier turn with a short note", () => {
		const out = truncateStaleToolResults([user("q1"), result("study_material", big), user("q2")]);
		assert.equal(textOf(out[1]!), "[page text omitted; re-read with study_material]");
	});

	it("drops images of earlier turns and notes other tools generically", () => {
		const out = truncateStaleToolResults([user("q1"), result("show_figure", "ok", [{ type: "image", data: "x", mimeType: "image/png" }]), result("web", big), user("q2")]);
		assert.match(textOf(out[1]!), /show_figure output omitted/);
		assert.match(textOf(out[2]!), /web output omitted/);
	});

	it("keeps results of the current turn and small results", () => {
		const input = [user("q1"), result("study_context", "short"), user("q2"), result("study_material", big)];
		const out = truncateStaleToolResults(input);
		assert.equal(textOf(out[1]!), "short");
		assert.equal(textOf(out[3]!), big);
	});

	it("is deterministic (a stable prefix for prompt caching) and does not mutate its input", () => {
		const input = [user("q1"), result("study_material", big), user("q2")];
		const a = truncateStaleToolResults(input);
		assert.deepEqual(truncateStaleToolResults(input), a);
		assert.equal(textOf(input[1]!), big);
	});
});
