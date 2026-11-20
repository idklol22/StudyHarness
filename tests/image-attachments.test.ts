/** Pure attachment rules: size math, count/size/type admission, and the
 *  snapshot store shape. No DOM, no network. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	CHAT_IMAGE_LIMITS, downscaleDimensions, isImageFile, learnerModelContent,
	outputImageMimeType, validateImageAttachments,
} from "../src/core/chat-images.ts";
import { imageDimensions } from "../src/core/image-dimensions.ts";
import { saveSubmittedImageSnapshots, submittedImagesOf } from "../src/server/chat-image-snapshots.ts";

const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const file = (name: string, type: string, size: number) => ({ name, type, size });

test("downscale fits the long side to 2000px without scaling small images up", () => {
	assert.deepEqual(downscaleDimensions(150, 90), { width: 150, height: 90 });
	assert.deepEqual(downscaleDimensions(2000, 1000), { width: 2000, height: 1000 });
	assert.deepEqual(downscaleDimensions(4000, 2000), { width: 2000, height: 1000 });
	assert.deepEqual(downscaleDimensions(1000, 8000), { width: 250, height: 2000 });
	assert.deepEqual(downscaleDimensions(6000, 4000), { width: 2000, height: 1333 });
	assert.deepEqual(downscaleDimensions(3000, 3001, 1000), { width: 1000, height: 1000 });
	assert.throws(() => downscaleDimensions(0, 100), RangeError);
	assert.throws(() => downscaleDimensions(100, Number.NaN), RangeError);
});

test("attachment validation enforces type, 10 MB size and six-image count in order", () => {
	const good = file("board.png", "image/png", 1024);
	const alsoGood = file("photo.JPEG", "image/jpeg", 1024 * 1024);
	const webp = file("first.webp", "image/webp", 10);
	const gif = file("old.gif", "image/gif", 10);
	const oversized = file("huge.png", "image/png", CHAT_IMAGE_LIMITS.maxBytes + 1);
	const pdf = file("notes.pdf", "application/pdf", 10);
	const svg = file("drawing.svg", "image/svg+xml", 10);
	const result = validateImageAttachments([good, pdf, oversized, alsoGood, webp, gif, svg]);
	assert.deepEqual(result.accepted, [good, alsoGood, webp, gif]);
	assert.deepEqual(result.rejected.map(entry => entry.reason), [
		"Only PNG, JPEG, WebP or GIF images can be attached.",
		"Images must be 10 MB or smaller.",
		"Only PNG, JPEG, WebP or GIF images can be attached.",
	]);
	assert.equal(CHAT_IMAGE_LIMITS.maxBytes, 10 * 1024 * 1024);
	assert.equal(CHAT_IMAGE_LIMITS.jpegQuality, 0.85);
});

test("existing attachments count toward the ceiling and the boundary file is accepted", () => {
	const candidates = Array.from({ length: 7 }, (_, index) => file(`p${index}.png`, "image/png", CHAT_IMAGE_LIMITS.maxBytes));
	const first = validateImageAttachments(candidates);
	assert.equal(first.accepted.length, 6);
	assert.equal(first.rejected.length, 1);
	const second = validateImageAttachments([candidates[0]!], 6);
	assert.equal(second.accepted.length, 0);
	assert.match(second.rejected[0]!.reason, /At most 6 images/);
});

test("MIME type, extension fallback and output encoding follow the screenshot rule", () => {
	assert.equal(isImageFile(file("x.png", "", 1)), true);
	assert.equal(isImageFile(file("x.JPG", "", 1)), true);
	assert.equal(isImageFile(file("x.pdf", "application/pdf", 1)), false);
	assert.equal(isImageFile(file("x.png", "image/svg+xml", 1)), false);
	assert.equal(outputImageMimeType("image/png"), "image/png");
	assert.equal(outputImageMimeType("image/webp"), "image/jpeg");
	assert.equal(outputImageMimeType("image/jpeg"), "image/jpeg");
});

test("learner content preserves the text-only string shape and adds native image blocks", () => {
	const image = { type: "image" as const, mimeType: "image/png", data: "AAAA" };
	assert.equal(learnerModelContent("hello"), "hello");
	assert.equal(learnerModelContent(""), "");
	assert.deepEqual(learnerModelContent("", [image]), [image]);
	assert.deepEqual(learnerModelContent("hello", [image]), [{ type: "text", text: "hello" }, image]);
});

test("snapshot store gets stable SHA-256 ids, real dimensions and dedupe", () => {
	const saved: Array<{ id: string; image: unknown }> = [];
	const store = { saveImageSnapshot: (_chatId: string, id: string, image: unknown) => { saved.push({ id, image }); } };
	const image = { type: "image" as const, mimeType: "image/png", data: png1x1 };
	const ids = saveSubmittedImageSnapshots("chat-1", [image, image], store);
	assert.equal(ids.length, 2);
	assert.equal(ids[0], ids[1]);
	assert.match(ids[0]!, /^[a-f0-9]{64}$/);
	assert.equal(saved.length, 2, "the store itself dedupes; the helper hands it every occurrence");
	assert.deepEqual(saved[0]!.image, { mimeType: "image/png", data: png1x1, width: 1, height: 1 });
	const collected = submittedImagesOf({ type: "text", text: "", images: [image] });
	assert.deepEqual(collected, [image]);
	assert.deepEqual(saveSubmittedImageSnapshots("chat-1", [{ ...image, mimeType: "image/svg+xml" }], store), []);
});

test("image dimensions come from headers, never from a declared size", () => {
	assert.deepEqual(imageDimensions(Buffer.from(png1x1, "base64"), "image/png"), { width: 1, height: 1 });
	assert.equal(imageDimensions(new Uint8Array([1, 2, 3]), "image/png"), null);
	// Minimal JPEG SOF0 header: 2x3.
	const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x03, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00]);
	assert.deepEqual(imageDimensions(jpeg, "image/jpeg"), { width: 2, height: 3 });
});
