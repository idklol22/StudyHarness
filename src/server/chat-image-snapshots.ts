/** Persist learner-submitted pictures in the chat's existing snapshot store.
 *  Messages already carry native base64 blocks; snapshots give tools and a
 *  reloaded session a stable SHA-256 identity for the same bytes. */
import { createHash } from "node:crypto";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { TurnInput } from "../core/input-events.ts";
import { imageDimensions } from "../core/image-dimensions.ts";
import type { ChatStore } from "../core/ports.ts";

const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Walk an input event's explicit native image blocks. Unknown shapes are
 *  ignored — input-events has already validated the accepted channels. */
export function submittedImagesOf(value: unknown): ImageContent[] {
	const found: ImageContent[] = [];
	const walk = (node: unknown) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) { for (const item of node) walk(item); return; }
		const item = node as Record<string, unknown>;
		if (item.type === "image" && typeof item.data === "string" && base64.test(item.data)
			&& (item.mimeType === "image/png" || item.mimeType === "image/jpeg")) {
			found.push({ type: "image", data: item.data, mimeType: item.mimeType });
			return;
		}
		for (const child of Object.values(item)) walk(child);
	};
	walk(value);
	return found;
}

/** Snapshot identities are content hashes; the store enforces the same rule.
 *  Returns the ids saved (deduped by the store itself). */
export function saveSubmittedImageSnapshots(
	chatId: string,
	images: readonly Readonly<ImageContent>[],
	store: Pick<ChatStore, "saveImageSnapshot">,
): string[] {
	const ids: string[] = [];
	for (const image of images) {
		if (image.mimeType !== "image/png" && image.mimeType !== "image/jpeg") continue;
		const bytes = Buffer.from(image.data, "base64");
		if (!bytes.length || bytes.toString("base64") !== image.data) continue;
		const dimensions = imageDimensions(bytes, image.mimeType);
		if (!dimensions) continue;
		const snapshotId = createHash("sha256").update(bytes).digest("hex");
		store.saveImageSnapshot(chatId, snapshotId, {
			mimeType: image.mimeType,
			data: image.data,
			width: dimensions.width,
			height: dimensions.height,
		});
		ids.push(snapshotId);
	}
	return ids;
}

export function saveTurnImageSnapshots(chatId: string, input: TurnInput, store: Pick<ChatStore, "saveImageSnapshot">): string[] {
	return saveSubmittedImageSnapshots(chatId, submittedImagesOf(input), store);
}
