"use client";

import { useCallback, useRef, useState } from "react";
import type { ImageContent } from "@earendil-works/pi-ai";
import { XIcon } from "lucide-react";
import { imageDataUrl } from "@/src/core/chat-images";
import { prepareImageFiles } from "./chat-image-input";

/** Thumbnails live directly above the input and are removed one at a time. */
export function ImageAttachments({ images, onRemove, error }: {
	images: readonly Readonly<ImageContent>[];
	onRemove: (index: number) => void;
	error?: string;
}) {
	if (!images.length && !error) return null;
	return <div data-testid="image-attachments" className="flex flex-wrap items-center gap-2 px-1.5 pt-1.5">
		{images.map((image, index) => (
			<div key={`${index}-${image.data.slice(0, 24)}`} data-testid="composer-image" className="relative size-14 shrink-0 overflow-hidden rounded-md border bg-muted">
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img src={imageDataUrl(image)} alt={`Attached image ${index + 1}`} draggable={false} className="size-full object-cover" />
				<button type="button" data-testid="remove-image" aria-label={`Remove image ${index + 1}`} title="Remove image"
					onClick={() => onRemove(index)}
					className="absolute top-0 right-0 flex size-5 items-center justify-center rounded-bl-md bg-background/85 text-foreground hover:bg-destructive hover:text-destructive-foreground">
					<XIcon aria-hidden="true" className="size-3" />
				</button>
			</div>
		))}
		{error && <span role="alert" className="font-ui text-xs text-destructive">{error}</span>}
	</div>;
}

export interface ImageAttachmentState {
	images: ImageContent[];
	/** Synchronous mirror for send handlers that cannot wait for a render. */
	imagesRef: { readonly current: ImageContent[] };
	error: string;
	add: (files: readonly File[]) => Promise<void>;
	addContent: (image: ImageContent) => void;
	remove: (index: number) => void;
	clear: () => void;
}

/** One per composer. A ref is the authoritative list so two near-simultaneous
 *  pastes cannot lose each other; onChange fires in the same tick as commit,
 *  before a synchronous send reads the parent's ref. */
export function useImageAttachments(onChange?: (images: ImageContent[]) => void): ImageAttachmentState {
	const [images, setImages] = useState<ImageContent[]>([]);
	const [error, setError] = useState("");
	const current = useRef<ImageContent[]>([]);
	const notify = useRef(onChange); notify.current = onChange;
	const commit = useCallback((next: ImageContent[]) => {
		current.current = next;
		setImages(next);
		notify.current?.(next);
	}, []);
	const add = useCallback(async (files: readonly File[]) => {
		if (!files.length) return;
		const prepared = await prepareImageFiles(files, current.current.length);
		if (!prepared.images.length) { setError(prepared.errors[0] ?? "Could not attach that image."); return; }
		commit([...current.current, ...prepared.images]);
		setError(prepared.errors[0] ?? "");
	}, [commit]);
	const addContent = useCallback((image: ImageContent) => {
		commit([...current.current, image]);
		setError("");
	}, [commit]);
	const remove = useCallback((index: number) => {
		commit(current.current.filter((_, i) => i !== index));
		setError("");
	}, [commit]);
	const clear = useCallback(() => { commit([]); setError(""); }, [commit]);
	return { images, imagesRef: current, error, add, addContent, remove, clear };
}
