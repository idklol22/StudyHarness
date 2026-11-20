/** Pure image-attachment rules shared by the chat composer, the follow-up
 *  window and the server admission paths. Browser-safe: no node builtins.
 *
 *  The transport contract is the existing native ImageContent block — the
 *  same one plugin submissions already use. This module only decides WHAT is
 *  attachable and how a picture is shaped before it becomes native content.
 */
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

export const CHAT_IMAGE_LIMITS = Object.freeze({
	/** At most six pictures per message (composer + follow-up alike). */
	maxCount: 6,
	/** Original file size ceiling, before client-side downscaling. */
	maxBytes: 10 * 1024 * 1024,
	/** Longest edge of the bytes actually sent/stored. */
	maxSide: 2000,
	/** Canvas quality for lossy output. Screenshots stay lossless PNG. */
	jpegQuality: 0.85,
});

export const CHAT_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ChatImageMimeType = typeof CHAT_IMAGE_MIME_TYPES[number];
const MIME_SET: ReadonlySet<string> = new Set(CHAT_IMAGE_MIME_TYPES);

export function isChatImageMimeType(value: unknown): value is ChatImageMimeType {
	return typeof value === "string" && MIME_SET.has(value.toLowerCase());
}

/** Files that can become an inline image. OS drag payloads sometimes carry
 *  no MIME type, so a known raster extension is accepted as a fallback — the
 *  browser decode below still decides whether the bytes are really a picture.
 */
export function isImageFile(file: { type?: unknown; name?: unknown }): boolean {
	const type = typeof file.type === "string" ? file.type.toLowerCase() : "";
	if (isChatImageMimeType(type)) return true;
	// A declared but unsupported image type is authoritative — an extension
	// must not smuggle an SVG (or any other non-raster format) past it.
	if (type.startsWith("image/")) return false;
	const name = typeof file.name === "string" ? file.name.toLowerCase() : "";
	return /\.(png|jpe?g|webp|gif)$/.test(name);
}

export interface ImageAttachmentCandidate {
	readonly type?: unknown;
	readonly name?: unknown;
	readonly size?: unknown;
}

export interface ImageRejection<T> {
	readonly file: T;
	readonly reason: string;
}
export interface ImageAttachmentValidation<T> {
	readonly accepted: T[];
	readonly rejected: ImageRejection<T>[];
}

/** Count/size/type validation as one pure fold: existing attachments count
 *  toward the six-image ceiling, bad candidates are reported and skipped
 *  rather than poisoning the whole drop, and order is preserved. */
export function validateImageAttachments<T extends ImageAttachmentCandidate>(
	files: readonly T[],
	existingCount = 0,
	limits: Readonly<Pick<typeof CHAT_IMAGE_LIMITS, "maxCount" | "maxBytes">> = CHAT_IMAGE_LIMITS,
): ImageAttachmentValidation<T> {
	const accepted: T[] = [];
	const rejected: ImageRejection<T>[] = [];
	let count = Math.max(0, existingCount);
	for (const file of files) {
		if (!isImageFile(file)) {
			rejected.push({ file, reason: "Only PNG, JPEG, WebP or GIF images can be attached." });
		} else if (typeof file.size === "number" && Number.isFinite(file.size) && file.size > limits.maxBytes) {
			rejected.push({ file, reason: "Images must be 10 MB or smaller." });
		} else if (count >= limits.maxCount) {
			rejected.push({ file, reason: `At most ${limits.maxCount} images can be attached.` });
		} else {
			accepted.push(file);
			count++;
		}
	}
	return { accepted, rejected };
}

/** Integer long-side fit. A picture already within the cap is never scaled
 *  up; a degenerate size is refused rather than producing a 0-wide canvas. */
export function downscaleDimensions(width: number, height: number, maxSide: number = CHAT_IMAGE_LIMITS.maxSide): { width: number; height: number } {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !Number.isFinite(maxSide) || maxSide <= 0) {
		throw new RangeError("Image dimensions must be positive finite numbers");
	}
	if (width <= maxSide && height <= maxSide) return { width: Math.round(width), height: Math.round(height) };
	const scale = maxSide / Math.max(width, height);
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

/** Screenshots are PNG and stay PNG (lossless text/lines); photographs and
 *  other browser formats become JPEG at the prescribed quality. */
export function outputImageMimeType(mimeType: string): "image/png" | "image/jpeg" {
	return mimeType.toLowerCase() === "image/png" ? "image/png" : "image/jpeg";
}

export function imageDataUrl(image: Readonly<ImageContent>): string {
	return `data:${image.mimeType};base64,${image.data}`;
}

/** The one text+images → native model-content conversion, used by plain chat
 *  messages and by follow-up turns. Text-only input keeps its historic string
 *  shape; image-bearing input becomes explicit native content blocks. */
export function learnerModelContent(text: string, images?: readonly Readonly<ImageContent>[]): string | (TextContent | ImageContent)[] {
	if (!images?.length) return text;
	return [
		...(text ? [{ type: "text" as const, text }] : []),
		...images.map(image => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })),
	];
}

/** Count ceiling for image blocks arriving on the wire (byte/format checking
 *  stays with the existing strict native validator and server processing). */
export function limitImageContents<T>(images: readonly T[], maxCount: number = CHAT_IMAGE_LIMITS.maxCount): T[] {
	if (images.length > maxCount) throw new Error(`At most ${maxCount} images can be attached.`);
	return [...images];
}
