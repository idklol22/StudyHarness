"use client";

/**
 * The notes viewer (Study overhaul, Phase E): iPad-style class-note pages for a topic or a subject.
 * The agent's elements render as paper-and-pen handwriting (headings, bullets, stickies, boxes, worked steps and
 * screenshots of the material with circles/arrows/highlights); the learner draws on top (pen, highlighter) and adds
 * their own stickies. Their ink is stored apart from the agent's pages, so regenerating or editing notes never touches it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useServerEvent } from "@/components/server-events";
import { DownloadIcon, EraserIcon, HighlighterIcon, MousePointer2Icon, PenLineIcon, SparklesIcon, StickyNoteIcon, Undo2Icon } from "lucide-react";
import { PAGE_H, PAGE_W, type Element, type Notebook, type NotePage } from "@/src/core";
import { markShapes } from "./notes-geometry";

const HAND = "var(--font-hand), 'Segoe Print', 'Bradley Hand', cursive";

type Tool = "view" | "pen" | "highlighter" | "sticky";
const INK = "#1d4ed8";
const BOX: Record<string, { label: string; color: string }> = {
	definition: { label: "Definition", color: "#2563eb" }, exam: { label: "Exam!", color: "#dc2626" }, revisit: { label: "Revisit", color: "#d97706" },
	mistake: { label: "Mistake", color: "#be123c" }, idea: { label: "Idea", color: "#059669" },
};

function ElementView({ el, imageUrl }: { el: Element; imageUrl: (materialId: string, page: number) => string }) {
	const box: React.CSSProperties = { position: "absolute", left: el.x, top: el.y, width: el.w, minHeight: el.h };
	switch (el.type) {
		case "heading": return <div style={{ ...box, fontSize: 30, fontWeight: 700, lineHeight: "36px", color: "#111827", borderBottom: "3px solid #fde047" }}>{el.text}</div>;
		case "text": return <div style={{ ...box, fontSize: 20, lineHeight: "26px", color: INK, whiteSpace: "pre-wrap" }}>{el.text}</div>;
		case "bullets": return <ul style={{ ...box, fontSize: 20, lineHeight: "26px", color: INK, listStyle: "none", margin: 0, padding: 0 }}>{el.items.map((t, i) => <li key={i} style={{ paddingLeft: 28, position: "relative" }}><span style={{ position: "absolute", left: 6 }}>•</span>{t}</li>)}</ul>;
		case "box": {
			const k = BOX[el.kind] ?? BOX.idea!;
			return (
				<div style={{ ...box, border: `2.5px solid ${k.color}`, borderRadius: 14, padding: "10px 14px", fontSize: 20, lineHeight: "26px", color: "#1f2937", background: `${k.color}12` }}>
					<div style={{ color: k.color, fontWeight: 700, fontSize: 17 }}>{el.title ?? k.label}</div>{el.text}
				</div>
			);
		}
		case "steps": return (
			<div style={{ ...box, border: "2px dashed #94a3b8", borderRadius: 12, padding: "8px 12px", fontSize: 20, lineHeight: "26px", color: INK }}>
				{el.title && <div style={{ fontWeight: 700, color: "#334155" }}>{el.title}</div>}
				<ol style={{ margin: 0, paddingLeft: 26 }}>{el.steps.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}</ol>
			</div>
		);
		case "sticky": return <div style={{ ...box, transform: `rotate(${el.tilt}deg)`, background: "#fef08a", padding: "10px 12px", fontSize: 17, lineHeight: "23px", color: "#422006", boxShadow: "2px 3px 6px rgba(0,0,0,.18)" }}>{el.text}</div>;
		case "figure": {
			const figH = Math.round(el.w / el.aspect);
			return (
				<div style={{ ...box }}>
					<div style={{ position: "relative", width: el.w, height: figH, border: "1px solid #cbd5e1", background: "#fff", boxShadow: "1px 2px 5px rgba(0,0,0,.12)" }}>
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img src={imageUrl(el.materialId, el.page)} alt={el.caption ?? `Page ${el.page}`} width={el.w} height={figH} style={{ display: "block", width: "100%", height: "100%" }} />
						<svg width={el.w} height={figH} viewBox={`0 0 ${el.w} ${figH}`} style={{ position: "absolute", inset: 0, overflow: "visible" }} fill="none" stroke="#dc2626" strokeLinecap="round" strokeLinejoin="round">
							{el.marks.flatMap((m, mi) => markShapes(m, el.w, figH).map((s, si) => s.kind === "path"
								? <path key={`${mi}-${si}`} d={s.d} strokeWidth={s.width ?? 3} fill={s.fill ?? "none"} fillOpacity={s.opacity} stroke={s.fill ? "none" : "#dc2626"} />
								: <text key={`${mi}-${si}`} x={s.x} y={s.y} fill="#dc2626" stroke="none" fontSize={18} fontWeight={700} style={{ fontFamily: "inherit" }}>{s.text}</text>))}
						</svg>
					</div>
					{el.caption && <div style={{ fontSize: 15, color: "#475569", marginTop: 4 }}>{el.caption}</div>}
				</div>
			);
		}
	}
}

export interface PageHandlers {
	onStroke(pageId: string, stroke: { tool: "pen" | "highlighter"; color: string; width: number; points: Array<[number, number]> }): void;
	onSticky(pageId: string, x: number, y: number): void;
	onRemoveSticky(pageId: string, id: string): void;
}

/** One page at a given scale, with the learner's ink layer on top. */
export function NotePageView({ page, number, notebook, scale, tool, handlers, imageUrl }: { page: NotePage; number: number; notebook: Notebook; scale: number; tool: Tool; handlers?: PageHandlers; imageUrl: (materialId: string, page: number) => string }) {
	const layer = notebook.learner[page.id];
	const [drawing, setDrawing] = useState<Array<[number, number]> | null>(null);
	const ref = useRef<HTMLDivElement>(null);
	const at = (e: React.PointerEvent): [number, number] => {
		const r = ref.current!.getBoundingClientRect();
		return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
	};
	const drawingTool = tool === "pen" || tool === "highlighter";
	const color = tool === "highlighter" ? "#facc15" : "#111827";
	const width = tool === "highlighter" ? 18 : 2.5;
	const path = (pts: Array<[number, number]>) => "M" + pts.map(([x, y]) => `${x},${y}`).join(" L");
	return (
		<div style={{ width: PAGE_W * scale, height: PAGE_H * scale }} className="mx-auto mb-6 shrink-0 overflow-hidden rounded-sm shadow-lg print:mb-0 print:shadow-none" data-testid="note-page">
			<div
				ref={ref}
				style={{ fontFamily: HAND, width: PAGE_W, height: PAGE_H, transform: `scale(${scale})`, transformOrigin: "top left", position: "relative", background: "#fffdf7", backgroundImage: "repeating-linear-gradient(transparent 0 25px, #e5e7eb 25px 26px)", backgroundPositionY: 48, touchAction: drawingTool ? "none" : "auto" }}
			>
				<div style={{ position: "absolute", left: 40, top: 0, bottom: 0, width: 2, background: "#fca5a5", opacity: 0.6 }} />
				{page.elements.map((el) => <ElementView key={el.id} el={el} imageUrl={imageUrl} />)}
				<div style={{ position: "absolute", right: 24, bottom: 14, fontSize: 14, color: "#94a3b8" }}>{number}</div>
				{layer?.stickies.map((s) => (
					<button key={s.id} type="button" title="Click to remove" onClick={() => handlers?.onRemoveSticky(page.id, s.id)} style={{ position: "absolute", left: s.x, top: s.y, maxWidth: 200, background: "#bbf7d0", padding: "8px 10px", fontSize: 16, lineHeight: "21px", textAlign: "left", color: "#14532d", boxShadow: "2px 3px 6px rgba(0,0,0,.18)", cursor: handlers ? "pointer" : "default" }}>{s.text}</button>
				))}
				<svg
					width={PAGE_W} height={PAGE_H} viewBox={`0 0 ${PAGE_W} ${PAGE_H}`}
					style={{ position: "absolute", inset: 0, pointerEvents: handlers && (drawingTool || tool === "sticky") ? "auto" : "none", cursor: tool === "sticky" ? "copy" : drawingTool ? "crosshair" : "default" }}
					fill="none" strokeLinecap="round" strokeLinejoin="round"
					onPointerDown={(e) => {
						if (!handlers) return;
						if (tool === "sticky") { const [x, y] = at(e); handlers.onSticky(page.id, x, y); return; }
						if (!drawingTool) return;
						e.currentTarget.setPointerCapture?.(e.pointerId);
						setDrawing([at(e)]);
					}}
					onPointerMove={(e) => { if (drawing) setDrawing((d) => (d ? [...d, at(e)] : d)); }}
					onPointerUp={() => { if (drawing && handlers && drawing.length > 0) handlers.onStroke(page.id, { tool: tool as "pen" | "highlighter", color, width, points: drawing }); setDrawing(null); }}
				>
					{layer?.strokes.map((s, i) => <path key={i} d={path(s.points)} stroke={s.color} strokeWidth={s.width} opacity={s.tool === "highlighter" ? 0.4 : 1} />)}
					{drawing && <path d={path(drawing)} stroke={color} strokeWidth={width} opacity={tool === "highlighter" ? 0.4 : 1} />}
				</svg>
			</div>
		</div>
	);
}

export const pageImageUrl = (materialId: string, page: number) => `/api/study/pages/${encodeURIComponent(materialId)}/${page}`;

async function call(body: unknown): Promise<{ notebook?: Notebook; added?: number; error?: string }> {
	try {
		const res = await fetch("/api/study/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
		return await res.json();
	} catch { return { error: "Could not reach the app." }; }
}

/** The notes section of a subject/topic page: toolbar, pages, generate, export. */
export function NotesPanel({ subjectId, topicId, label }: { subjectId: string; topicId?: string; label: string }) {
	const scope = { subjectId, ...(topicId ? { topicId } : {}) };
	const [book, setBook] = useState<Notebook | null>(null);
	const [tool, setTool] = useState<Tool>("view");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const holder = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(0.8);
	const query = new URLSearchParams({ subjectId, ...(topicId ? { topicId } : {}) }).toString();

	const load = useCallback(async () => {
		try {
			const res = await fetch(`/api/study/notes?${query}`);
			const data = await res.json() as { notebook?: Notebook; error?: string };
			if (data.notebook) setBook(data.notebook); else setError(data.error ?? "Could not load the notes.");
		} catch { setError("Could not reach the app."); }
	}, [query]);
	useEffect(() => { void load(); }, [load]);
	// The agent writes notes while it teaches: the server announces it and the pages refresh in place.
	useServerEvent("sources-changed", () => { void load(); });
	useLayoutEffect(() => {
		const el = holder.current;
		if (!el) return;
		const fit = () => setScale(Math.min(1, Math.max(0.3, (el.clientWidth - 4) / PAGE_W)));
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(el);
		return () => ro.disconnect();
	}, [book !== null]);

	const apply = async (body: Record<string, unknown>) => {
		const r = await call({ ...scope, ...body });
		if (r.notebook) { setBook(r.notebook); setError(""); } else setError(r.error ?? "That did not work.");
		return r;
	};
	const handlers: PageHandlers = {
		onStroke: (pageId, stroke) => void apply({ action: "stroke", pageId, stroke }),
		onSticky: (pageId, x, y) => { const text = window.prompt("Sticky note"); if (text?.trim()) void apply({ action: "sticky", pageId, x, y, text }); setTool("view"); },
		onRemoveSticky: (pageId, id) => void apply({ action: "remove-sticky", pageId, id }),
	};
	const btn = "inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs transition-colors hover:bg-accent disabled:opacity-50";
	const tools: Array<[Tool, React.ReactNode, string]> = [["view", <MousePointer2Icon key="v" className="size-3.5" />, "View"], ["pen", <PenLineIcon key="p" className="size-3.5" />, "Pen"], ["highlighter", <HighlighterIcon key="h" className="size-3.5" />, "Highlight"], ["sticky", <StickyNoteIcon key="s" className="size-3.5" />, "Sticky"]];
	const first = book?.pages[0];
	return (
		<section id="notes" className="mt-6" data-testid="notes-section">
			<div className="mb-2 flex flex-wrap items-center gap-2">
				<h2 className="mr-auto text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Notes</h2>
				{first && tools.map(([t, icon, name]) => (
					<button key={t} type="button" aria-pressed={tool === t} onClick={() => setTool(t)} className={`${btn} ${tool === t ? "bg-accent" : ""}`}>{icon}{name}</button>
				))}
				{first && <button type="button" className={btn} onClick={() => { const p = book!.pages.findLast((x) => (book!.learner[x.id]?.strokes.length ?? 0) > 0); if (p) void apply({ action: "undo", pageId: p.id }); }}><Undo2Icon className="size-3.5" /><EraserIcon className="size-3.5" />Undo ink</button>}
				<button type="button" disabled={busy} className={btn} data-testid="generate-notes" onClick={async () => { setBusy(true); const r = await apply({ action: "generate" }); setBusy(false); if (r.added) setTool("view"); }}>
					<SparklesIcon className="size-3.5" />{busy ? "Writing notes…" : first ? "Add to notes" : `Generate notes for ${label}`}
				</button>
				{first && <a className={btn} href={`/study-notes/print?${query}`} target="_blank" rel="noreferrer"><DownloadIcon className="size-3.5" />Export PDF</a>}
			</div>
			{error && <p role="alert" className="mb-2 rounded-md border border-destructive/40 bg-card px-3 py-2 text-xs text-destructive">{error}</p>}
			<div ref={holder} className="rounded-lg border bg-muted/30 p-2">
				{!book ? <p className="p-4 text-sm text-muted-foreground">Loading…</p>
					: !first ? <p className="p-4 text-sm text-muted-foreground">No notes yet. Generate them from the material and your chats, or ask in a chat to keep notes as you learn.</p>
					: book.pages.map((p, i) => <NotePageView key={p.id} page={p} number={i + 1} notebook={book} scale={scale} tool={tool} handlers={handlers} imageUrl={pageImageUrl} />)}
			</div>
		</section>
	);
}
