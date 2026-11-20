/** Client-side image intake: validate the dropped/pasted/picked files, draw
 *  them to a canvas at the shared long-side cap, and hand the app native
 *  ImageContent blocks. No server round trip on the way in. */
import type { ImageContent } from "@earendil-works/pi-ai";
import {
	CHAT_IMAGE_LIMITS, downscaleDimensions, outputImageMimeType, validateImageAttachments,
} from "@/src/core/chat-images";

type Drawable = { width: number; height: number; close?: () => void };

async function decode(file: Blob): Promise<{ source: Drawable; release: () => void }> {
	if (typeof createImageBitmap === "function") {
		const bitmap = await createImageBitmap(file);
		return { source: bitmap, release: () => bitmap.close() };
	}
	const url = URL.createObjectURL(file);
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		return { source: { width: image.naturalWidth, height: image.naturalHeight }, release: () => URL.revokeObjectURL(url) };
	} catch (error) {
		URL.revokeObjectURL(url);
		throw error;
	}
}

function base64Of(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunk) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
	}
	return btoa(binary);
}

async function canvasContent(canvas: HTMLCanvasElement, mimeType: "image/png" | "image/jpeg"): Promise<ImageContent> {
	const blob = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(result => result ? resolve(result) : reject(new Error("Could not encode the image.")), mimeType,
			mimeType === "image/jpeg" ? CHAT_IMAGE_LIMITS.jpegQuality : undefined);
	});
	return { type: "image", data: base64Of(new Uint8Array(await blob.arrayBuffer())), mimeType };
}

/** One file → one downscaled native block. PNG screenshots stay lossless;
 *  everything else is JPEG at 0.85. */
export async function imageFileToContent(file: File): Promise<ImageContent> {
	const { source, release } = await decode(file);
	try {
		const { width, height } = downscaleDimensions(source.width, source.height);
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas is unavailable in this browser.");
		const mimeType = outputImageMimeType(file.type || file.name);
		if (mimeType === "image/jpeg") {
			context.fillStyle = "#ffffff";
			context.fillRect(0, 0, width, height);
		}
		context.drawImage(source as CanvasImageSource, 0, 0, width, height);
		return await canvasContent(canvas, mimeType);
	} finally {
		release();
	}
}

export interface PreparedImages {
	images: ImageContent[];
	errors: string[];
}

/** The shared attachment entry point: count/size/type first, then decode.
 *  A bad file is reported and skipped; the rest of the batch still attaches. */
export async function prepareImageFiles(
	files: readonly File[],
	existingCount = 0,
): Promise<PreparedImages> {
	const { accepted, rejected } = validateImageAttachments(files, existingCount);
	const images: ImageContent[] = [];
	const errors = rejected.map(item => item.reason);
	for (const file of accepted) {
		try { images.push(await imageFileToContent(file)); }
		catch { errors.push(`Could not read ${file.name || "that image"}.`); }
	}
	return { images, errors };
}

export interface CropRect { x: number; y: number; width: number; height: number }

/** Crop a captured screen frame. Screenshots are PNG: text and hairlines must
 *  not acquire JPEG ringing. The shared long-side cap still applies. */
export async function cropImageContent(dataUrl: string, rect: CropRect): Promise<ImageContent> {
	const image = new Image();
	image.src = dataUrl;
	await image.decode();
	const width = Math.max(1, Math.min(rect.width, image.naturalWidth));
	const height = Math.max(1, Math.min(rect.height, image.naturalHeight));
	const sourceX = Math.max(0, Math.min(rect.x, image.naturalWidth - 1));
	const sourceY = Math.max(0, Math.min(rect.y, image.naturalHeight - 1));
	const target = downscaleDimensions(width, height);
	const canvas = document.createElement("canvas");
	canvas.width = target.width;
	canvas.height = target.height;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Canvas is unavailable in this browser.");
	context.drawImage(image, sourceX, sourceY, width, height, 0, 0, target.width, target.height);
	return canvasContent(canvas, "image/png");
}

/** IPC returns a PNG data URL; the browser path returns one from a canvas too. */
export function dataUrlToFile(dataUrl: string, name = "screenshot.png"): File {
	const [header, data] = dataUrl.split(",");
	const mimeType = header?.match(/^data:([^;]+);base64$/)![1] ?? "image/png";
	const bytes = Uint8Array.from(atob(data ?? ""), character => character.charCodeAt(0));
	return new File([bytes], name, { type: mimeType });
}
