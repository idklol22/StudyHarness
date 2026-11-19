"use client";

/**
 * View a file's pages or slides in the app (owner 2026-11-19: "it should be possible to view the slides"). PDF pages
 * come as images from /api/study/pages/…; a text file's pages are shown as text. Arrow keys / buttons page through;
 * Escape closes.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import type { Material } from "@/src/core";

export function SlideViewer({ material, startPage = 1, onClose }: { material: Material; startPage?: number; onClose: () => void }) {
	const first = material.pages?.from ?? 1, last = material.pages?.to ?? material.pageCount;
	const [page, setPage] = useState(Math.min(last, Math.max(first, startPage)));
	const [text, setText] = useState<string | null>(null);
	const go = useCallback((d: number) => setPage((p) => Math.min(last, Math.max(first, p + d))), [first, last]);
	useEffect(() => {
		const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); else if (e.key === "ArrowRight" || e.key === "PageDown") go(1); else if (e.key === "ArrowLeft" || e.key === "PageUp") go(-1); };
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
	}, [go, onClose]);
	useEffect(() => {
		if (material.kind !== "text") return;
		setText(null);
		void fetch(`/api/study/pages/${encodeURIComponent(material.id)}/${page}?format=text`).then((r) => r.json()).then((d: { text?: string }) => setText(d.text ?? "")).catch(() => setText("Could not load this page."));
	}, [material, page]);
	return (
		<div role="dialog" aria-modal="true" aria-label={`${material.fileName}, page ${page}`} data-testid="slide-viewer" className="fixed inset-0 z-50 flex flex-col bg-black/85 text-white" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
			<div className="flex items-center gap-3 px-4 py-3 text-sm">
				<span className="min-w-0 flex-1 truncate">{material.fileName}</span>
				<span className="tabular-nums text-white/70">{page} / {last}{first > 1 ? ` (pages ${first}–${last})` : ""}</span>
				<button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 hover:bg-white/10"><XIcon className="size-5" /></button>
			</div>
			<div className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-6" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
				<button type="button" aria-label="Previous page" disabled={page <= first} onClick={() => go(-1)} className="absolute left-3 rounded-full bg-white/10 p-2 hover:bg-white/20 disabled:opacity-30"><ChevronLeftIcon className="size-6" /></button>
				{material.kind === "text"
					? <pre className="max-h-full w-full max-w-3xl overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-900 p-6 font-sans text-sm leading-relaxed">{text ?? "Loading…"}</pre>
					// eslint-disable-next-line @next/next/no-img-element
					: <img key={page} src={`/api/study/pages/${encodeURIComponent(material.id)}/${page}`} alt={`Page ${page} of ${material.fileName}`} className="max-h-full max-w-full rounded bg-white object-contain shadow-2xl" />}
				<button type="button" aria-label="Next page" disabled={page >= last} onClick={() => go(1)} className="absolute right-3 rounded-full bg-white/10 p-2 hover:bg-white/20 disabled:opacity-30"><ChevronRightIcon className="size-6" /></button>
			</div>
		</div>
	);
}
