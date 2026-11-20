"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ImageContent } from "@earendil-works/pi-ai";
import { cropImageContent, type CropRect } from "./chat-image-input";

/** Drag a rectangle over the captured frame; Enter confirms, Escape cancels.
 *  The overlay owns Escape completely so the side window never closes under it. */
export function ScreenCropOverlay({ src, onConfirm, onCancel }: {
	src: string;
	onConfirm: (image: ImageContent) => void;
	onCancel: () => void;
}) {
	const imageRef = useRef<HTMLImageElement>(null);
	const overlayRef = useRef<HTMLDivElement>(null);
	const [rect, setRect] = useState<CropRect | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const origin = useRef<{ x: number; y: number } | null>(null);
	useEffect(() => { overlayRef.current?.focus({ preventScroll: true }); }, []);
	const point = (event: ReactPointerEvent<HTMLImageElement>) => {
		const image = imageRef.current!;
		const bounds = image.getBoundingClientRect();
		return {
			x: Math.round((event.clientX - bounds.left) * image.naturalWidth / bounds.width),
			y: Math.round((event.clientY - bounds.top) * image.naturalHeight / bounds.height),
		};
	};
	const confirm = async () => {
		if (!rect || rect.width < 1 || rect.height < 1 || busy) return;
		setBusy(true);
		try { onConfirm(await cropImageContent(src, rect)); }
		catch { setError("Could not crop that selection."); setBusy(false); }
	};
	return <div ref={overlayRef} tabIndex={-1} role="dialog" aria-label="Select screenshot region"
		data-testid="screen-crop-overlay"
		className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-black/85 p-4 text-white outline-none"
		onKeyDown={(event) => {
			event.stopPropagation();
			if (event.key === "Escape") { event.preventDefault(); onCancel(); }
			else if (event.key === "Enter") { event.preventDefault(); void confirm(); }
		}}>
		<p className="font-ui text-sm">Drag to select a region — Enter to attach, Esc to cancel.</p>
		<div className="relative max-h-[80vh] max-w-full overflow-hidden">
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img ref={imageRef} src={src} alt="Captured screen" draggable={false} className="block max-h-[80vh] max-w-full select-none"
				onPointerDown={(event) => {
					if (busy) return;
					const at = point(event);
					origin.current = at;
					setRect({ ...at, width: 0, height: 0 });
					event.currentTarget.setPointerCapture(event.pointerId);
				}}
				onPointerMove={(event) => {
					const start = origin.current;
					if (!start) return;
					const at = point(event);
					setRect({ x: Math.min(start.x, at.x), y: Math.min(start.y, at.y), width: Math.abs(at.x - start.x), height: Math.abs(at.y - start.y) });
				}}
				onPointerUp={() => { origin.current = null; }}
				onPointerCancel={() => { origin.current = null; }} />
			{rect && rect.width > 0 && rect.height > 0 && <div aria-hidden="true" className="pointer-events-none absolute border-2 border-primary bg-primary/20"
				style={{
					left: `${rect.x / (imageRef.current?.naturalWidth || 1) * 100}%`,
					top: `${rect.y / (imageRef.current?.naturalHeight || 1) * 100}%`,
					width: `${rect.width / (imageRef.current?.naturalWidth || 1) * 100}%`,
					height: `${rect.height / (imageRef.current?.naturalHeight || 1) * 100}%`,
				}} />}
		</div>
		{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
		<div className="flex gap-2">
			<button type="button" data-testid="crop-cancel" onClick={onCancel} className="rounded-md border border-white/30 px-3 py-1.5 font-ui text-xs hover:bg-white/10">Cancel</button>
			<button type="button" data-testid="crop-confirm" disabled={!rect || busy} onClick={() => void confirm()} className="rounded-md bg-primary px-3 py-1.5 font-ui text-xs text-primary-foreground disabled:opacity-40">Attach selection</button>
		</div>
	</div>;
}
