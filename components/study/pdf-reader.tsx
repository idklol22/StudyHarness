"use client";

/**
 * The in-app reader page (task 1a): a real page, not a modal. PDF pages come from the managed copy via
 * /api/study/materials/<id>/file and are painted by pdf.js with a selectable text layer; text materials reuse
 * the same shell and show their stored page text instead.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowLeftIcon, MinusIcon, PanelLeftIcon, PlusIcon, SearchIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import type { Library } from "@/src/core";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask, TextLayer } from "pdfjs-dist";

type PdfLib = typeof import("pdfjs-dist");
type Size = { width: number; height: number };

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
const pageKey = (materialId: string) => `lh.reader.page.${materialId}`;

function rememberedPage(materialId: string): number {
	if (typeof window === "undefined") return 1;
	try {
		const n = Number(window.localStorage.getItem(pageKey(materialId)));
		return Number.isInteger(n) && n > 0 ? n : 1;
	} catch { return 1; }
}

/** A small page preview, rendered only while it is near the thumbnail rail's viewport. */
function Thumbnail({ doc, page, width, height, root }: { doc: PDFDocumentProxy; page: number; width: number; height: number; root: HTMLElement | null }) {
	const holder = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const [near, setNear] = useState(false);

	useEffect(() => {
		const el = holder.current;
		if (!el || !root) return;
		const io = new IntersectionObserver(([entry]) => setNear(Boolean(entry?.isIntersecting)), { root, rootMargin: "200px 0px" });
		io.observe(el);
		return () => io.disconnect();
	}, [root]);

	useEffect(() => {
		if (!near) return;
		let cancelled = false;
		let task: RenderTask | undefined;
		void (async () => {
			const pdfPage = await doc.getPage(page);
			if (cancelled || !canvas.current) return;
			const viewport = pdfPage.getViewport({ scale: width / pdfPage.getViewport({ scale: 1 }).width });
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			const el = canvas.current;
			el.width = Math.max(1, Math.floor(viewport.width * dpr));
			el.height = Math.max(1, Math.floor(viewport.height * dpr));
			el.style.width = `${viewport.width}px`;
			el.style.height = `${viewport.height}px`;
			const ctx = el.getContext("2d");
			if (!ctx) return;
			task = pdfPage.render({ canvas: el, canvasContext: ctx, viewport, transform: [dpr, 0, 0, dpr, 0, 0], background: "#ffffff" });
			await task.promise.catch(() => {});
		})();
		return () => { cancelled = true; try { task?.cancel(); } catch { /* already finished */ } };
	}, [doc, near, page, width]);

	return (
		<div ref={holder} style={{ width, height }} className="overflow-hidden rounded-sm border border-border bg-white">
			<canvas ref={canvas} className="block bg-white" aria-label={`Page ${page} thumbnail`} />
		</div>
	);
}

/** One PDF page: a device-pixel canvas under pdf.js's text layer. Rendered only when near the viewport. */
function PdfPage({ lib, doc, page, size, scale, active }: { lib: PdfLib; doc: PDFDocumentProxy; page: number; size: Size; scale: number; active: boolean }) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const textLayer = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!active) return;
		let cancelled = false;
		let renderTask: RenderTask | undefined;
		let layer: TextLayer | undefined;
		void (async () => {
			const pdfPage: PDFPageProxy = await doc.getPage(page);
			if (cancelled || !canvas.current || !textLayer.current) return;
			const viewport = pdfPage.getViewport({ scale });
			const dpr = window.devicePixelRatio || 1;
			const el = canvas.current;
			el.width = Math.max(1, Math.floor(viewport.width * dpr));
			el.height = Math.max(1, Math.floor(viewport.height * dpr));
			el.style.width = `${viewport.width}px`;
			el.style.height = `${viewport.height}px`;
			const ctx = el.getContext("2d");
			if (!ctx) return;
			renderTask = pdfPage.render({ canvas: el, canvasContext: ctx, viewport, transform: [dpr, 0, 0, dpr, 0, 0], background: "#ffffff" });
			await renderTask.promise;
			if (cancelled || !textLayer.current) return;
			const content = await pdfPage.getTextContent();
			if (cancelled || !textLayer.current) return;
			textLayer.current.replaceChildren();
			layer = new lib.TextLayer({ textContentSource: content, container: textLayer.current, viewport });
			await layer.render();
		})().catch(() => { /* the canvas stays visible even when text extraction fails */ });
		return () => {
			cancelled = true;
			try { renderTask?.cancel(); } catch { /* already finished */ }
			try { layer?.cancel(); } catch { /* already finished */ }
		};
	}, [active, doc, lib, page, scale]);

	return (
		<div className="relative bg-white" style={{ width: size.width * scale, height: size.height * scale }}>
			<canvas ref={canvas} className="absolute inset-0 block bg-white" aria-label={`Page ${page}`} />
			<div ref={textLayer} className="textLayer" style={{ "--total-scale-factor": scale } as CSSProperties} />
		</div>
	);
}

/** A virtual page of a markdown/text material. */
function TextPage({ materialId, page, cache, onText }: { materialId: string; page: number; cache: Map<number, string>; onText: (page: number, text: string) => void }) {
	const [text, setText] = useState<string | null>(() => cache.get(page) ?? null);
	useEffect(() => {
		let cancelled = false;
		const cached = cache.get(page);
		if (cached !== undefined) { setText(cached); return; }
		setText(null);
		void fetch(`/api/study/pages/${encodeURIComponent(materialId)}/${page}?format=text`)
			.then((r) => r.ok ? r.json() as Promise<{ text?: string }> : Promise.reject(new Error("Could not load this page.")))
			.then((d) => {
				const value = d.text ?? "";
				if (cancelled) return;
				cache.set(page, value);
				onText(page, value);
				setText(value);
			})
			.catch(() => { if (!cancelled) setText("Could not load this page."); });
		return () => { cancelled = true; };
	}, [cache, materialId, onText, page]);
	return <div className="whitespace-pre-wrap font-sans text-sm leading-relaxed" data-testid="reader-text-page">{text ?? "Loading…"}</div>;
}

/** The route page: the embeddable reader full-height under the app's top bar. */
export function PdfReader({ subjectId, materialId, startPage }: { subjectId: string; materialId: string; startPage?: number }) {
	return <PdfReaderView materialId={materialId} page={startPage} backHref={`/subjects/${encodeURIComponent(subjectId)}#files`} />;
}

/**
 * The reader core, embeddable. `compact` (the chat side panel): a thinner toolbar, thumbnails collapsed, keys
 * scoped to the view instead of the window. `jumpKey` re-scrolls to `page` when the host re-opens the same file.
 */
export function PdfReaderView({ materialId, page: startPage, compact = false, backHref, jumpKey }: { materialId: string; page?: number; compact?: boolean; backHref?: string; jumpKey?: number }) {
	const [library, setLibrary] = useState<Library | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [lib, setLib] = useState<PdfLib | null>(null);
	const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
	const [pdfTotal, setPdfTotal] = useState(0);
	const [sizes, setSizes] = useState<Size[]>([]);
	const [scale, setScale] = useState(1);
	const [railOpen, setRailOpen] = useState(!compact);
	const [rendered, setRendered] = useState<Set<number>>(() => new Set([startPage && startPage > 0 ? Math.floor(startPage) : rememberedPage(materialId)]));
	const [current, setCurrent] = useState(() => startPage && startPage > 0 ? Math.floor(startPage) : rememberedPage(materialId));
	const [pageInput, setPageInput] = useState(String(current));
	const [searchQuery, setSearchQuery] = useState("");
	const [searchMatches, setSearchMatches] = useState<number[]>([]);
	const [searchIndex, setSearchIndex] = useState(0);
	const [searched, setSearched] = useState(false);
	const [searching, setSearching] = useState(false);

	const rootEl = useRef<HTMLDivElement>(null);
	const scrollBox = useRef<HTMLDivElement>(null);
	const [railEl, setRailEl] = useState<HTMLElement | null>(null);
	const searchBox = useRef<HTMLInputElement>(null);
	const pageEls = useRef<Map<number, HTMLElement>>(new Map());
	const currentRef = useRef(current);
	const initialScrolled = useRef(false);
	const raf = useRef<number | null>(null);
	const textCache = useRef<Map<number, string>>(new Map());
	const lastQuery = useRef("");

	const material = library?.materials.find((m) => m.id === materialId);
	const isText = material?.kind === "text";
	const materialKey = material?.id;
	const materialSha = material?.sha256;
	const total = isText ? material?.pageCount ?? 0 : pdfTotal;
	const ready = Boolean(material) && (isText || (Boolean(doc) && sizes.length === pdfTotal));

	useEffect(() => {
		let cancelled = false;
		void fetch("/api/study/library", { cache: "no-store" })
			.then((r) => r.ok ? r.json() as Promise<{ library: Library }> : Promise.reject(new Error("Could not load the library.")))
			.then((d) => { if (!cancelled) setLibrary(d.library); })
			.catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load this page."); });
		return () => { cancelled = true; };
	}, []);

	useEffect(() => {
		if (!materialKey || !materialSha || isText) return;
		let cancelled = false;
		let task: ReturnType<PdfLib["getDocument"]> | undefined;
		void (async () => {
			try {
				const pdfjs = await import("pdfjs-dist");
				if (cancelled) return;
				pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;
				task = pdfjs.getDocument({ url: `/api/study/materials/${encodeURIComponent(materialKey)}/file` });
				const document = await task.promise;
				if (cancelled) { void task.destroy(); return; }
				const measured: Size[] = [];
				for (let n = 1; n <= document.numPages; n++) {
					const page = await document.getPage(n);
					const viewport = page.getViewport({ scale: 1 });
					measured.push({ width: viewport.width, height: viewport.height });
					if (cancelled) return;
				}
				setLib(pdfjs);
				setDoc(document);
				setPdfTotal(document.numPages);
				setSizes(measured);
			} catch (reason) {
				if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not open this PDF.");
			}
		})();
		return () => {
			cancelled = true;
			void task?.destroy();
			setLib(null); setDoc(null); setPdfTotal(0); setSizes([]);
		};
	}, [isText, materialKey, materialSha]);

	useEffect(() => {
		if (!total) return;
		const clamped = Math.min(total, Math.max(1, currentRef.current));
		if (clamped !== currentRef.current) { currentRef.current = clamped; setCurrent(clamped); }
	}, [total]);

	useEffect(() => {
		currentRef.current = current;
		setPageInput(String(current));
		setRendered((prev) => prev.has(current) ? prev : new Set(prev).add(current));
	}, [current]);

	// Refs for the current DOM, refreshed whenever the page set changes (the nodes themselves stay stable).
	useEffect(() => {
		const box = scrollBox.current;
		if (!box) return;
		pageEls.current = new Map(Array.from(box.querySelectorAll<HTMLElement>("[data-page]")).map((el) => [Number(el.dataset.page), el]));
	}, [ready, total]);

	useEffect(() => {
		if (!ready) return;
		const box = scrollBox.current;
		if (!box) return;
		const io = new IntersectionObserver((entries) => {
			setRendered((prev) => {
				let next = prev;
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					const n = Number((entry.target as HTMLElement).dataset.page);
					if (Number.isInteger(n) && !next.has(n)) {
						if (next === prev) next = new Set(prev);
						next.add(n);
					}
				}
				return next;
			});
		}, { root: box, rootMargin: "600px 0px" });
		for (const el of pageEls.current.values()) io.observe(el);
		return () => io.disconnect();
	}, [ready, total]);

	const goToPage = useCallback((n: number, behavior: ScrollBehavior = "smooth") => {
		if (!total) return;
		const target = Math.min(total, Math.max(1, Math.floor(n)));
		currentRef.current = target;
		setCurrent(target);
		const box = scrollBox.current;
		const el = pageEls.current.get(target) ?? box?.querySelector<HTMLElement>(`[data-page="${target}"]`);
		if (!box || !el) return;
		const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
		box.scrollTo({ top: Math.max(0, top - 12), behavior });
	}, [total]);

	// A host re-opening this file at another page (panel citations) scrolls the live reader.
	const lastJump = useRef({ jumpKey, startPage });
	useEffect(() => {
		const prev = lastJump.current;
		lastJump.current = { jumpKey, startPage };
		if (prev.jumpKey === jumpKey && prev.startPage === startPage) return;
		if (ready && startPage && startPage > 0) goToPage(startPage);
	}, [goToPage, jumpKey, ready, startPage]);

	// Jump to ?page (or the remembered page) once, before scroll tracking starts.
	useEffect(() => {
		if (!ready || !total) return;
		const id = requestAnimationFrame(() => {
			const box = scrollBox.current;
			const el = pageEls.current.get(currentRef.current) ?? box?.querySelector<HTMLElement>(`[data-page="${currentRef.current}"]`);
			if (box && el) {
				const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
				box.scrollTop = Math.max(0, top - 12);
			}
			initialScrolled.current = true;
		});
		return () => cancelAnimationFrame(id);
	}, [ready, total]);

	const onScroll = useCallback(() => {
		if (!initialScrolled.current || raf.current !== null) return;
		raf.current = requestAnimationFrame(() => {
			raf.current = null;
			const box = scrollBox.current;
			if (!box) return;
			const view = box.getBoundingClientRect();
			let best = currentRef.current, bestArea = 0;
			for (const [n, el] of pageEls.current) {
				const rect = el.getBoundingClientRect();
				const height = Math.max(0, Math.min(rect.bottom, view.bottom) - Math.max(rect.top, view.top));
				const area = height * Math.max(0, Math.min(rect.width, view.width));
				if (area > bestArea) { bestArea = area; best = n; }
			}
			if (best !== currentRef.current) { currentRef.current = best; setCurrent(best); }
		});
	}, []);

	useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);

	useEffect(() => {
		if (!initialScrolled.current || !total) return;
		try { window.localStorage.setItem(pageKey(materialId), String(current)); } catch { /* best effort */ }
	}, [current, materialId, total]);

	const rememberText = useCallback((n: number, text: string) => { textCache.current.set(n, text); }, []);

	const runSearch = useCallback(async () => {
		const query = searchQuery.trim().toLowerCase();
		if (!query || !total) return;
		if (lastQuery.current === query && searchMatches.length) {
			const next = (searchIndex + 1) % searchMatches.length;
			setSearchIndex(next);
			goToPage(searchMatches[next] ?? 1);
			return;
		}
		setSearching(true);
		try {
			const matches: number[] = [];
			for (let n = 1; n <= total; n++) {
				let text = textCache.current.get(n);
				if (text === undefined) {
					if (doc) {
						const page = await doc.getPage(n);
						const content = await page.getTextContent();
						text = content.items.map((item) => "str" in item ? String(item.str) : "").join(" ");
					} else if (isText) {
						const response = await fetch(`/api/study/pages/${encodeURIComponent(materialId)}/${n}?format=text`);
						const data = await response.json() as { text?: string };
						text = data.text ?? "";
					} else break;
					textCache.current.set(n, text);
				}
				if (text.toLowerCase().includes(query)) matches.push(n);
			}
			lastQuery.current = query;
			setSearchMatches(matches);
			setSearchIndex(0);
			setSearched(true);
			if (matches[0]) goToPage(matches[0]);
		} finally { setSearching(false); }
	}, [doc, goToPage, isText, materialId, searchIndex, searchMatches.length, searchQuery, total]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const mod = event.ctrlKey || event.metaKey;
			if (mod && event.key.toLowerCase() === "f") { event.preventDefault(); searchBox.current?.focus(); return; }
			if (mod && ["=", "+", "-", "_"].includes(event.key)) {
				event.preventDefault();
				const out = event.key === "-" || event.key === "_";
				setScale((s) => clampScale(out ? s / 1.2 : s * 1.2));
				return;
			}
			const target = event.target as HTMLElement | null;
			if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
			if (event.key === "ArrowRight" || event.key === "PageDown") { event.preventDefault(); goToPage(currentRef.current + 1); }
			else if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); goToPage(currentRef.current - 1); }
		};
		const host: HTMLElement | Window | null = compact ? rootEl.current : window;
		host?.addEventListener("keydown", onKey as EventListener);
		return () => host?.removeEventListener("keydown", onKey as EventListener);
	}, [compact, goToPage]);

	const commitPage = () => {
		const n = Number(pageInput);
		if (Number.isInteger(n) && n > 0) goToPage(n);
		else setPageInput(String(current));
	};
	const fitWidth = () => {
		const box = scrollBox.current;
		const size = sizes[current - 1];
		if (!box || !size) return;
		setScale(clampScale((box.clientWidth - 64) / size.width));
	};
	const fitPage = () => {
		const box = scrollBox.current;
		const size = sizes[current - 1];
		if (!box || !size) return;
		setScale(clampScale(Math.min((box.clientWidth - 64) / size.width, (box.clientHeight - 64) / size.height)));
	};
	const back = backHref ?? "/";
	const shownError = error ?? (library && !material ? "That file no longer exists." : null);
	const thumbWidth = 130;

	const toolbar = (
		<>
				{!compact && <Link href={back} aria-label="Back to subject" className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-3.5" />Back</Link>}
				{compact ? <span className="min-w-0 flex-1" /> : <h1 className="min-w-0 flex-1 truncate font-title text-xl tracking-tight" title={material?.fileName}>{material?.fileName ?? "Reader"}</h1>}
				{!shownError && (
					<div className="flex shrink-0 items-center gap-2 text-xs">
						<label className="flex items-center gap-1 tabular-nums">
							<input
								aria-label="Page number"
								data-testid="reader-page-input"
								type="number"
								min={1}
								max={total || undefined}
								value={pageInput}
								onChange={(e) => setPageInput(e.target.value)}
								onBlur={commitPage}
								onKeyDown={(e) => { if (e.key === "Enter") commitPage(); }}
								className="w-12 rounded border border-border bg-background px-1 py-0.5 text-center tabular-nums"
							/>
							<span className="text-muted-foreground">/ {total || "—"}</span>
						</label>
						{!isText && (
							<>
								<button type="button" aria-label="Zoom out" data-testid="reader-zoom-out" onClick={() => setScale((s) => clampScale(s / 1.2))} className="rounded border border-border p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><MinusIcon className="size-3.5" /></button>
								<button type="button" aria-label="Zoom in" data-testid="reader-zoom-in" onClick={() => setScale((s) => clampScale(s * 1.2))} className="rounded border border-border p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><PlusIcon className="size-3.5" /></button>
								<button type="button" data-testid="reader-fit-width" onClick={fitWidth} className="rounded border border-border px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground">Fit width</button>
								{!compact && <button type="button" data-testid="reader-fit-page" onClick={fitPage} className="rounded border border-border px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground">Fit page</button>}
							</>
						)}
						<label className="flex items-center gap-1 rounded border border-border px-2">
							<SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
							<input
								ref={searchBox}
								aria-label="Search pages"
								data-testid="reader-search"
								value={searchQuery}
								onChange={(e) => { setSearchQuery(e.target.value); setSearched(false); setSearchMatches([]); lastQuery.current = ""; }}
								onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
								placeholder="Search"
								className={`${compact ? "h-6 w-20" : "h-8 w-28"} bg-transparent text-xs outline-none placeholder:text-muted-foreground`}
							/>
						</label>
						{searched && <span className="tabular-nums text-muted-foreground" data-testid="reader-search-results">{searching ? "Searching…" : `${searchMatches.length ? searchIndex + 1 : 0} of ${searchMatches.length} pages`}</span>}
						<button type="button" aria-label={railOpen ? "Hide thumbnails" : "Show thumbnails"} data-testid="reader-toggle-thumbnails" onClick={() => setRailOpen((open) => !open)} className="rounded border border-border p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><PanelLeftIcon className="size-3.5" /></button>
					</div>
				)}
		</>
	);

	return (
		<div ref={rootEl} tabIndex={compact ? -1 : undefined} className={`flex min-w-0 flex-col bg-background outline-none ${compact ? "h-full min-h-0" : "h-dvh"}`} data-testid="pdf-reader">
			{compact ? <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-1">{toolbar}</div> : <TopBar>{toolbar}</TopBar>}

			{shownError ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm">
					<p className="text-muted-foreground">{shownError}</p>
					<Link href={back} className="rounded-md border border-border px-3 py-1.5 hover:bg-accent">Back</Link>
				</div>
			) : !ready ? (
				<div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">Loading…</div>
			) : (
				<div className="flex min-h-0 flex-1">
					{railOpen && (
						<aside ref={setRailEl} aria-label="Page thumbnails" data-testid="reader-thumbnails" className="w-[150px] shrink-0 overflow-y-auto border-r border-border bg-card p-2">
							<ul className="flex flex-col items-center gap-2">
								{Array.from({ length: total }, (_, i) => i + 1).map((n) => {
									const size = sizes[n - 1];
									const height = size ? Math.round(thumbWidth * size.height / size.width) : 90;
									return (
										<li key={n}>
											<button
												type="button"
												aria-label={`Go to page ${n}`}
												aria-current={current === n ? "page" : undefined}
												onClick={() => goToPage(n)}
												className={`flex flex-col items-center gap-1 rounded border p-1 text-[11px] tabular-nums ${current === n ? "border-primary bg-accent" : "border-transparent text-muted-foreground hover:bg-accent"}`}
											>
												{!isText && doc && size
													? <Thumbnail doc={doc} page={n} width={thumbWidth} height={height} root={railEl} />
													: <span className="flex h-16 w-[130px] items-center justify-center rounded-sm border border-border bg-background">{n}</span>}
												<span>{n}</span>
											</button>
										</li>
									);
								})}
							</ul>
						</aside>
					)}
					<div ref={scrollBox} onScroll={onScroll} data-testid="reader-pages" className="min-w-0 flex-1 overflow-auto">
						<div className={`flex min-h-full flex-col items-center gap-4 ${compact ? "px-3 py-3" : "px-8 py-6"}`}>
							{Array.from({ length: total }, (_, i) => i + 1).map((n) => {
								const size = sizes[n - 1];
								const shown = rendered.has(n);
								return (
									<div key={n} data-page={n} className="flex w-full justify-center" aria-label={`Page ${n}`}>
										{isText ? (
											<div className="w-full max-w-3xl border border-border bg-card px-8 py-8 shadow-sm">
												{shown ? <TextPage materialId={materialId} page={n} cache={textCache.current} onText={rememberText} /> : <div className="h-24" />}
											</div>
										) : (
											<div className="w-fit max-w-full overflow-auto rounded-sm border border-border bg-card shadow-sm">
												{shown && lib && doc && size
													? <PdfPage lib={lib} doc={doc} page={n} size={size} scale={scale} active />
													: <div style={{ width: size ? Math.max(1, size.width * scale) : 320, height: size ? Math.max(1, size.height * scale) : 440 }} className="flex items-center justify-center bg-white text-xs text-muted-foreground">{n}</div>}
											</div>
										)}
										<span className="sr-only">Page {n}</span>
									</div>
								);
							})}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
