/**
 * PROMPT NAVIGATION (T20): pure extraction of the user prompts that open a
 * turn, plus the active-prompt index used by the sticky row (and T21's rail).
 *
 * A "prompt" is a user message the learner actually wrote: it carries text or
 * an image, and it is NOT one of the user-role scaffolding messages the view
 * projects (probe handoffs, subagent steer/abort cards). Data-only markers —
 * graph context, compaction dividers, practice markers, plugin submissions —
 * have no text/image part and are skipped by the same rule.
 *
 * Pure and deterministic: no DOM, no React, no node deps. Client-safe.
 */

import type { LhViewMessage } from "./view.ts";

/** One learner-authored user turn in the view transcript. */
export interface PromptEntry {
	/** Native user message id (may be empty on legacy records). */
	id: string;
	/** DOM anchor for the original row: `prompt-${id}`. */
	anchorId: string;
	/** First text parts, whitespace-collapsed; "Image" when image-only. */
	text: string;
	/** Index in the LhViewMessage[] this entry was derived from. */
	index: number;
	/** An assistant message exists before the next prompt (or the end). */
	hasReply: boolean;
}

/** Part types that mark user-role scaffolding, never a learner prompt. */
const NON_PROMPT_PARTS = new Set([
	"data-probe-handoff",
	"data-subagent-artifact",
	"data-subagent-aborted",
]);

export function promptAnchorId(messageId: string): string {
	return `prompt-${messageId}`;
}

/** A user message that opens a turn: authored text or an image, and none of
 *  the marker parts that render as cards/dividers instead of a prompt. */
export function isPromptMessage(m: LhViewMessage): boolean {
	if (m.role !== "user") return false;
	let hasText = false;
	let hasImage = false;
	for (const part of m.parts) {
		if (NON_PROMPT_PARTS.has(part.type)) return false;
		if (part.type === "image") hasImage = true;
		else if (part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0) hasText = true;
	}
	return hasText || hasImage;
}

/** One-line label: collapse all whitespace runs, default to "Image" when the
 *  prompt carried no text (the image-only case, and legacy empty text). */
export function promptLabel(text?: string): string {
	return (text ?? "").replace(/\s+/g, " ").trim() || "Image";
}

/** Extract prompts in view order. Duplicate native ids keep only the first
 *  entry (so the DOM anchor stays unique); `hasReply` scans between this
 *  prompt and the next one, ignoring data-only user markers. */
export function promptEntriesOf(messages: readonly LhViewMessage[]): PromptEntry[] {
	const seen = new Set<string>();
	const entries: PromptEntry[] = [];

	for (let i = 0; i < messages.length; i++) {
		const message = messages[i]!;
		if (!isPromptMessage(message)) continue;
		if (seen.has(message.id)) continue;
		seen.add(message.id);
		const text = message.parts
			.filter((part) => part.type === "text" && typeof part.text === "string")
			.map((part) => part.text as string)
			.join(" ");
		entries.push({
			id: message.id,
			anchorId: promptAnchorId(message.id),
			text: promptLabel(text),
			index: i,
			hasReply: false,
		});
	}

	for (let e = 0; e < entries.length; e++) {
		const start = entries[e]!.index + 1;
		const end = e + 1 < entries.length ? entries[e + 1]!.index : messages.length;
		let hasReply = false;
		for (let i = start; i < end; i++) {
			if (messages[i]!.role === "assistant") {
				hasReply = true;
				break;
			}
		}
		entries[e]!.hasReply = hasReply;
	}

	return entries;
}

/** Last anchor at/above the viewport top, or -1 when none has been crossed.
 *  `tops` is consumed in the supplied order (never sorted): callers pass the
 *  entries' DOM order, and the LAST qualifying anchor wins. */
export function activePromptIndex(tops: readonly number[], viewportTop: number): number {
	let active = -1;
	for (let i = 0; i < tops.length; i++) {
		if (tops[i]! <= viewportTop) active = i;
	}
	return active;
}
