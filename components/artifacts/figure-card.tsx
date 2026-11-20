"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ToolCallCard } from "@/components/artifacts/tool-call-card";
import type { ArtifactPartProps, ImageSnapshot, ShowFigureDetails } from "@/src/core";
import { useImageSnapshot } from "./use-image-snapshot";

/**
 * The show_figure card: a crop from one of the learner's lecture PDFs, with
 * the caption and a link back to that page in the reader. Like show_image,
 * the bytes live in the chat's image snapshots, never in the transcript.
 * Clicking the picture opens a lightbox; Escape (or the backdrop) closes it.
 */

function isShowFigureDetails(value: unknown): value is ShowFigureDetails {
	const v = value as Partial<ShowFigureDetails> | null | undefined;
	return (
		typeof v?.snapshotId === "string" && /^[a-f0-9]{64}$/.test(v.snapshotId) &&
		v.mimeType === "image/png" &&
		typeof v.materialId === "string" && typeof v.subjectId === "string" &&
		typeof v.fileName === "string" && Number.isInteger(v.page) &&
		typeof v.width === "number" && typeof v.height === "number"
	);
}

const srcOf = (image: ImageSnapshot) => `data:${image.mimeType};base64,${image.data}`;

export function FigureCard({ part }: ArtifactPartProps) {
	if (part.state !== "output-available") return <ToolCallCard part={part} />;
	if (!isShowFigureDetails(part.output)) {
		return <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Figure shown, but it could not be displayed.</div>;
	}
	return <StoredFigureCard details={part.output} />;
}

function StoredFigureCard({ details }: { details: ShowFigureDetails }) {
	const { image, failed } = useImageSnapshot(details.snapshotId);
	const [lightbox, setLightbox] = useState(false);
	useEffect(() => {
		if (!lightbox) return;
		const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setLightbox(false); };
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [lightbox]);
	if (!image) return <div className="my-4 text-sm text-muted-foreground" role="status">{failed ? "Figure snapshot could not be loaded." : "Loading figure…"}</div>;
	const alt = details.caption || `Figure from ${details.fileName}, page ${details.page}`;
	const src = srcOf(image);
	const reader = `/subjects/${encodeURIComponent(details.subjectId)}/read/${encodeURIComponent(details.materialId)}?page=${details.page}`;
	return (
		<figure className="mx-auto my-4 w-fit max-w-full" data-testid="figure-card">
			<button type="button" aria-label="Open figure larger" className="block max-w-full cursor-zoom-in overflow-hidden rounded-md border" onClick={() => setLightbox(true)}>
				{/* An in-memory image from the record; no Next image optimization. */}
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img src={src} alt={alt} width={image.width} height={image.height} className="block max-h-[420px] max-w-full object-contain" draggable={false} />
			</button>
			<figcaption className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-muted-foreground">
				{details.caption && <span data-testid="figure-caption">{details.caption}</span>}
				{details.wholePage && <span className="text-xs italic" data-testid="figure-whole-page">(whole page)</span>}
				<Link href={reader} data-testid="figure-reader-link" className="text-xs underline underline-offset-2 hover:text-foreground">{details.fileName} · p. {details.page}</Link>
			</figcaption>
			{lightbox && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" role="dialog" aria-modal="true" aria-label="Figure enlarged" onClick={() => setLightbox(false)}>
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img src={src} alt={alt} className="max-h-[90vh] max-w-[92vw] object-contain" onClick={(event) => event.stopPropagation()} />
					<button type="button" aria-label="Close enlarged figure" className="absolute right-4 top-4 rounded-md bg-background/90 px-3 py-1.5 text-sm text-foreground" onClick={() => setLightbox(false)}>Close</button>
				</div>
			)}
		</figure>
	);
}
