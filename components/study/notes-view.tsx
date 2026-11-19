"use client";

/**
 * The notes viewer (Study overhaul, Phase E): iPad-style class-note pages for a topic or a subject.
 * Dark paper, light ink (owner 2026-11-19, on screen and in the PDF). The agent's elements render as handwriting (headings, bullets, stickies, boxes, worked steps and
 * screenshots of the material with circles/arrows/highlights); the learner draws on top (pen, highlighter) and adds
 * their own stickies. Their ink is stored apart from the agent's pages, so regenerating or editing notes never touches it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useServerEvent } from "@/components/server-events";
import { DownloadIcon, EraserIcon, HighlighterIcon, MousePointer2Icon, PenLineIcon, SparklesIcon, StickyNoteIcon, Undo2Icon } from "lucide-react";
import { MAX_NOTE_PAGES, MAX_SOURCE_PAGES, PAGE_H, PAGE_W, drawDiagram, normalizeCoverage, type Material, type Element, type Notebook, type NotePage } from "@/src/core";
import { markShapes } from "./notes-geometry";
import { RichText, renderLatex } from "./rich-text";

const MIN_NOTE_PAGES = 8;
const HAND = "var(--font-hand), 'Segoe Print', 'Bradley Hand', cursive";

type Tool = "view" | "pen" | "highlighter" | "sticky";
const INK = "#93c5fd";
const BOX: Record<string, { label: string; color: string }> = {
	definition: { label: "Definition", color: "#60a5fa" }, exam: { label: "Exam!", color: "#f87171" }, revisit: { label: "Revisit", color: "#fbbf24" },
	mistake: { label: "Mistake", color: "#fb7185" }, idea: { label: "Idea", color: "#34d399" },
};

function ElementView({ el, imageUrl }: { el: Element; imageUrl: (materialId: string, page: number) => string }) {
	const box: React.CSSProperties = { position: "absolute", left: el.x, top: el.y, width: el.w, minHeight: el.h };
	switch (el.type) {
		case "heading": return <div style={{ ...box, fontSize: 30, fontWeight: 700, lineHeight: "36px", color: "#f3f4f6", borderBottom: "3px solid #a16207" }}>{el.text}</div>;
		case "text": return <div style={{ ...box, fontSize: 20, lineHeight: "26px", color: INK, whiteSpace: "pre-wrap" }}><RichText text={el.text} /></div>;
		case "bullets": return <ul style={{ ...box, fontSize: 20, lineHeight: "26px", color: INK, listStyle: "none", margin: 0, padding: 0 }}>{el.items.map((t, i) => <li key={i} style={{ paddingLeft: 28, position: "relative" }}><span style={{ position: "absolute", left: 6 }}>•</span><RichText text={t} /></li>)}</ul>;
		case "box": {
			const k = BOX[el.kind] ?? BOX.idea!;
			return (
				<div style={{ ...box, border: `2.5px solid ${k.color}`, borderRadius: 14, padding: "10px 14px", fontSize: 20, lineHeight: "26px", color: "#e5e7eb", background: `${k.color}12` }}>
					<div style={{ color: k.color, fontWeight: 700, fontSize: 17 }}>{el.title ?? k.label}</div><RichText text={el.text} />
				</div>
			);
		}
		case "steps": return (
			<div style={{ ...box, border: "2px dashed #71717a", borderRadius: 12, padding: "8px 12px", fontSize: 20, lineHeight: "26px", color: INK }}>
				{el.title && <div style={{ fontWeight: 700, color: "#cbd5e1" }}>{el.title}</div>}
				<ol style={{ margin: 0, paddingLeft: 26 }}>{el.steps.map((s, i) => <li key={i} style={{ marginBottom: 4 }}><RichText text={s} /></li>)}</ol>
			</div>
		);
		case "sticky": return <div style={{ ...box, transform: `rotate(${el.tilt}deg)`, background: "#4a3f0b", padding: "10px 12px", fontSize: 17, lineHeight: "23px", color: "#fef3c7", boxShadow: "2px 3px 6px rgba(0,0,0,.18)" }}><RichText text={el.text} /></div>;
		case "math": return (
			<div style={{ ...box, color: "#f3f4f6" }}>
				<div style={{ fontSize: 22, fontFamily: "initial", overflowX: "auto" }} dangerouslySetInnerHTML={{ __html: renderLatex(el.latex, true) }} />
				{el.text && <div style={{ fontSize: 17, lineHeight: "23px", color: INK }}><RichText text={el.text} /></div>}
			</div>
		);
		case "diagram": {
			const shapes = drawDiagram(el.diagram, el.w);
			const TONES = ["#93c5fd", "#34d399", "#fbbf24", "#fb7185", "#a78bfa", "#22d3ee"];
			const arrowId = `ah-${el.id}`;
			return (
				<div style={{ ...box }}>
					{el.title && <div style={{ fontSize: 20, fontWeight: 700, color: "#cbd5e1", lineHeight: "26px", marginBottom: 4 }}>{el.title}</div>}
					<svg width={el.w} height={shapes.h} viewBox={`0 0 ${el.w} ${shapes.h}`} role="img" aria-label={el.title ?? `${el.diagram.kind === "flow" ? "Flowchart" : "Mind map"}`} fontFamily={HAND} style={{ overflow: "visible" }}>
						<defs><marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#a1a1aa" /></marker></defs>
						{shapes.arrows.map((a, i) => (
							<g key={i}>
								<polyline points={a.points.map((p) => p.join(",")).join(" ")} fill="none" stroke="#a1a1aa" strokeWidth={2} strokeLinecap="round" markerEnd={a.arrow ? `url(#${arrowId})` : undefined} />
								{a.label && <text x={a.lx} y={a.ly} fontSize={14} fill="#a1a1aa">{a.label}</text>}
							</g>
						))}
						{shapes.boxes.map((b, i) => {
							const color = b.shape === "center" ? "#f3f4f6" : TONES[b.tone % TONES.length]!;
							const fill = b.shape === "center" ? "#a16207" : b.shape === "decision" ? "#3b2a06" : `${color}14`;
							const size = b.shape === "leaf" ? 12 : b.shape === "branch" ? 14 : 15;
							return (
								<g key={i}>
									{b.shape === "decision"
										? <polygon points={`${b.x + b.w / 2},${b.y} ${b.x + b.w},${b.y + b.h / 2} ${b.x + b.w / 2},${b.y + b.h} ${b.x},${b.y + b.h / 2}`} fill={fill} stroke="#fbbf24" strokeWidth={2} />
										: <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={b.shape === "box" ? 10 : b.h / 2} fill={fill} stroke={color} strokeWidth={b.shape === "leaf" ? 1.5 : 2.2} />}
									<text textAnchor="middle" fontSize={size} fill="#e5e7eb" fontWeight={b.shape === "center" ? 700 : 500}>
										{b.lines.map((line, li) => <tspan key={li} x={b.x + b.w / 2} y={b.y + b.h / 2 + (li - (b.lines.length - 1) / 2) * (size + 2) + size * 0.35}>{line}</tspan>)}
									</text>
								</g>
							);
						})}
					</svg>
				</div>
			);
		}
		case "figure": {
			const figH = Math.round(el.w / el.aspect);
			return (
				<div style={{ ...box }}>
					<div style={{ position: "relative", width: el.w, height: figH, border: "1px solid #3f3f46", background: "#fff", boxShadow: "1px 2px 5px rgba(0,0,0,.12)" }}>
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img src={imageUrl(el.materialId, el.page)} alt={el.caption ?? `Page ${el.page}`} width={el.w} height={figH} style={{ display: "block", width: "100%", height: "100%" }} />
						<svg width={el.w} height={figH} viewBox={`0 0 ${el.w} ${figH}`} style={{ position: "absolute", inset: 0, overflow: "visible" }} fill="none" stroke="#f87171" strokeLinecap="round" strokeLinejoin="round">
							{el.marks.flatMap((m, mi) => markShapes(m, el.w, figH).map((s, si) => s.kind === "path"
								? <path key={`${mi}-${si}`} d={s.d} strokeWidth={s.width ?? 3} fill={s.fill ?? "none"} fillOpacity={s.opacity} stroke={s.fill ? "none" : "#f87171"} />
								: <text key={`${mi}-${si}`} x={s.x} y={s.y} fill="#f87171" stroke="none" fontSize={18} fontWeight={700} style={{ fontFamily: "inherit" }}>{s.text}</text>))}
						</svg>
					</div>
					{el.caption && <div style={{ fontSize: 15, color: "#a1a1aa", marginTop: 4 }}><RichText text={el.caption} /></div>}
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
	const color = tool === "highlighter" ? "#facc15" : "#f3f4f6";
	const width = tool === "highlighter" ? 18 : 2.5;
	const path = (pts: Array<[number, number]>) => "M" + pts.map(([x, y]) => `${x},${y}`).join(" L");
	return (
		<div style={{ width: PAGE_W * scale, height: PAGE_H * scale }} className="mx-auto mb-6 shrink-0 overflow-hidden rounded-sm shadow-lg print:mb-0 print:shadow-none" data-testid="note-page">
			<div
				ref={ref}
				style={{ fontFamily: HAND, width: PAGE_W, height: PAGE_H, transform: `scale(${scale})`, transformOrigin: "top left", position: "relative", background: "#17181c", backgroundImage: "repeating-linear-gradient(transparent 0 25px, #262830 25px 26px)", backgroundPositionY: 48, touchAction: drawingTool ? "none" : "auto" }}
			>
				<div style={{ position: "absolute", left: 40, top: 0, bottom: 0, width: 2, background: "#7f3b3b", opacity: 0.6 }} />
				{page.elements.map((el) => <ElementView key={el.id} el={el} imageUrl={imageUrl} />)}
				<div style={{ position: "absolute", right: 24, bottom: 14, fontSize: 14, color: "#71717a" }}>{number}</div>
				{layer?.stickies.map((s) => (
					<button key={s.id} type="button" title="Click to remove" onClick={() => handlers?.onRemoveSticky(page.id, s.id)} style={{ position: "absolute", left: s.x, top: s.y, maxWidth: 200, background: "#14532d", padding: "8px 10px", fontSize: 16, lineHeight: "21px", textAlign: "left", color: "#bbf7d0", boxShadow: "2px 3px 6px rgba(0,0,0,.18)", cursor: handlers ? "pointer" : "default" }}>{s.text}</button>
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

interface NotebookTab { id: string; title: string; createdAt: string; target?: number }

/**
 * The notes section of a subject/topic page. A subject or topic can hold several notebooks (one PDF each, at most
 * 32 pages): tabs switch between them; "New notes" asks how many pages (a slider) and writes a new notebook from all
 * the scope's files and chats. Pen, highlighter and stickies draw on the open notebook; Export prints it as a PDF.
 */
export function NotesPanel({ subjectId, topicId, label, files = [], chats = [] }: { subjectId: string; topicId?: string; label: string; /** The files the notes may cover. */ files?: readonly Material[]; /** The chats they may draw on. */ chats?: ReadonlyArray<{ id: string; title: string }> }) {
	const scope = { subjectId, ...(topicId ? { topicId } : {}) };
	const [book, setBook] = useState<Notebook | null>(null);
	const [notebooks, setNotebooks] = useState<NotebookTab[]>([]);
	const [notebookId, setNotebookId] = useState<string | null>(null);
	const [tool, setTool] = useState<Tool>("view");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [composing, setComposing] = useState(false);
	const [pages, setPages] = useState(MIN_NOTE_PAGES);
	const [title, setTitle] = useState("");
	// What the notes cover: picked files with page ranges (≤ MAX_SOURCE_PAGES in total), chats, and what the agent knows.
	const [picked, setPicked] = useState<Record<string, { on: boolean; from: number; to: number }>>({});
	const [chatOn, setChatOn] = useState<Record<string, boolean>>({});
	const [knowledge, setKnowledge] = useState(true);
	const range = (m: Material) => ({ from: m.pages?.from ?? 1, to: m.pages?.to ?? m.pageCount });
	// Default selection: the files in order, from their first page, up to the limit (the learner adjusts from there).
	const fileKey = files.map((m) => m.id).join(",");
	useEffect(() => {
		const defaults = normalizeCoverage(files);
		setPicked(Object.fromEntries(files.map((m) => { const c = defaults.find((d) => d.materialId === m.id); return [m.id, c ? { on: true, from: c.from, to: c.to } : { on: false, from: m.pages?.from ?? 1, to: m.pages?.to ?? m.pageCount }]; })));
	}, [fileKey]);
	const pick = (m: Material) => picked[m.id] ?? { on: false, ...range(m) };
	const selection = files.filter((m) => pick(m).on).map((m) => ({ materialId: m.id, from: pick(m).from, to: pick(m).to }));
	const total = selection.reduce((n, c) => n + Math.max(0, c.to - c.from + 1), 0);
	const chosenChats = chats.filter((c) => chatOn[c.id] ?? true).map((c) => c.id);
	const holder = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(0.8);
	const base = { subjectId, ...(topicId ? { topicId } : {}) };
	const query = new URLSearchParams({ ...base, ...(notebookId ? { notebookId } : {}) }).toString();

	const take = (data: { notebook?: Notebook; notebooks?: NotebookTab[]; notebookId?: string | null; error?: string }) => {
		if (data.notebook) { setBook(data.notebook); setError(""); } else setError(data.error ?? "Could not load the notes.");
		if (data.notebooks) setNotebooks(data.notebooks);
		if (data.notebookId !== undefined) setNotebookId(data.notebookId);
	};
	const load = useCallback(async (id: string | null) => {
		try {
			const res = await fetch(`/api/study/notes?${new URLSearchParams({ ...base, ...(id ? { notebookId: id } : {}) }).toString()}`);
			take(await res.json());
		} catch { setError("Could not reach the app."); }
	}, [subjectId, topicId]);
	useEffect(() => { void load(null); }, [load]);
	// The agent writes notes while it teaches: the server announces it and the open notebook refreshes in place.
	useServerEvent("sources-changed", () => { void load(notebookId); });
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
		const r = await call({ ...scope, ...(notebookId ? { notebookId } : {}), ...body }) as { notebook?: Notebook; notebooks?: NotebookTab[]; notebookId?: string | null; added?: number; error?: string };
		take(r);
		return r;
	};
	const create = async () => {
		setBusy(true);
		const r = await call({ ...scope, action: "generate", pages, coverage: selection, chats: chosenChats, knowledge, ...(title.trim() ? { title: title.trim() } : {}) }) as { notebook?: Notebook; notebooks?: NotebookTab[]; notebookId?: string | null; added?: number; error?: string };
		setBusy(false);
		take(r);
		if (r.added) { setComposing(false); setTitle(""); setTool("view"); }
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
				<button type="button" disabled={busy} className={btn} data-testid="generate-notes" aria-expanded={composing} onClick={() => setComposing((c) => !c)}>
					<SparklesIcon className="size-3.5" />{busy ? "Writing notes…" : notebooks.length ? "New notes" : `Create notes for ${label}`}
				</button>
				{first && <a className={btn} href={`/study-notes/print?${query}`} target="_blank" rel="noreferrer"><DownloadIcon className="size-3.5" />Export PDF</a>}
			</div>
			{composing && (
				<form className="mb-3 flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm" data-testid="new-notes-form" onSubmit={(e) => { e.preventDefault(); void create(); }}>
					<label className="flex items-center gap-3">
						<span className="w-28 shrink-0 text-xs text-muted-foreground">How many pages?</span>
						<input type="range" min={MIN_NOTE_PAGES} max={MAX_NOTE_PAGES} step={1} value={pages} onChange={(e) => setPages(Number(e.target.value))} aria-label="Pages" data-testid="notes-pages" className="flex-1 accent-primary" />
						<span className="w-16 shrink-0 text-right tabular-nums">{pages} pages</span>
					</label>
					<label className="flex items-center gap-3">
						<span className="w-28 shrink-0 text-xs text-muted-foreground">Title (optional)</span>
						<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${label} — notes`} maxLength={80} className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring" />
					</label>
					<fieldset className="flex flex-col gap-1" data-testid="notes-coverage">
						<legend className="mb-1 flex w-full items-center justify-between text-xs text-muted-foreground">
							<span>Files to cover (at most {MAX_SOURCE_PAGES} pages or slides per notebook)</span>
							<span className={`tabular-nums ${total > MAX_SOURCE_PAGES ? "font-medium text-destructive" : ""}`} data-testid="notes-coverage-total">{total} / {MAX_SOURCE_PAGES}</span>
						</legend>
						{files.length === 0 && <span className="text-xs text-muted-foreground">No files yet.</span>}
						{files.map((m) => {
							const p = pick(m), r = range(m);
							const set = (patch: Partial<typeof p>) => setPicked((cur) => ({ ...cur, [m.id]: { ...p, ...patch } }));
							return (
								<div key={m.id} className="flex flex-wrap items-center gap-2 text-xs">
									<label className="flex min-w-0 flex-1 items-center gap-2">
										<input type="checkbox" checked={p.on} onChange={(e) => set({ on: e.target.checked })} />
										<span className="truncate">{m.fileName}</span>
									</label>
									<span className="text-muted-foreground">pages</span>
									<input type="number" min={r.from} max={p.to} value={p.from} disabled={!p.on} onChange={(e) => set({ from: Math.max(r.from, Math.min(p.to, Number(e.target.value) || r.from)) })} aria-label={`First page of ${m.fileName}`} className="h-7 w-16 rounded-md border border-border bg-background px-1.5 tabular-nums disabled:opacity-50" />
									<span className="text-muted-foreground">to</span>
									<input type="number" min={p.from} max={r.to} value={p.to} disabled={!p.on} onChange={(e) => set({ to: Math.min(r.to, Math.max(p.from, Number(e.target.value) || r.to)) })} aria-label={`Last page of ${m.fileName}`} className="h-7 w-16 rounded-md border border-border bg-background px-1.5 tabular-nums disabled:opacity-50" />
								</div>
							);
						})}
					</fieldset>
					<fieldset className="flex flex-col gap-1 text-xs" data-testid="notes-sources">
						<legend className="mb-1 text-muted-foreground">Also use</legend>
						<label className="flex items-center gap-2"><input type="checkbox" checked={knowledge} onChange={(e) => setKnowledge(e.target.checked)} />What the agent knows about {label}</label>
						{chats.map((c) => (
							<label key={c.id} className="flex items-center gap-2"><input type="checkbox" checked={chatOn[c.id] ?? true} onChange={(e) => setChatOn((cur) => ({ ...cur, [c.id]: e.target.checked }))} /><span className="truncate">Chat: {c.title}</span></label>
						))}
						{chats.length === 0 && <span className="text-muted-foreground">No chats here yet.</span>}
					</fieldset>
					<p className="text-xs text-muted-foreground">A new notebook of about {pages} pages. Progress shows in the activity panel; the files list shows which pages each notebook covers.</p>
					<div className="flex gap-2">
						<button type="submit" disabled={busy || total > MAX_SOURCE_PAGES || (!total && !chosenChats.length && !knowledge)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"><SparklesIcon className="size-3.5" />{busy ? "Writing notes…" : `Write ${pages} page${pages === 1 ? "" : "s"}`}</button>
						<button type="button" disabled={busy} onClick={() => setComposing(false)} className={btn}>Cancel</button>
					</div>
				</form>
			)}
			{notebooks.length > 1 && (
				<div role="tablist" aria-label="Notebooks" className="mb-2 flex flex-wrap gap-1" data-testid="notebook-tabs">
					{notebooks.map((n) => (
						<button key={n.id} type="button" role="tab" aria-selected={n.id === notebookId} onClick={() => { setNotebookId(n.id); void load(n.id); }} className={`rounded-full border px-3 py-1 text-xs transition-colors ${n.id === notebookId ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>{n.title}</button>
					))}
				</div>
			)}
			{error && <p role="alert" className="mb-2 rounded-md border border-destructive/40 bg-card px-3 py-2 text-xs text-destructive">{error}</p>}
			<div ref={holder} className="rounded-lg border bg-muted/30 p-2">
				{!book ? <p className="p-4 text-sm text-muted-foreground">Loading…</p>
					: !first ? <p className="p-4 text-sm text-muted-foreground">No notes yet. Create them from the material and your chats, or ask in a chat to keep notes as you learn.</p>
					: book.pages.map((p, i) => <NotePageView key={p.id} page={p} number={i + 1} notebook={book} scale={scale} tool={tool} handlers={handlers} imageUrl={pageImageUrl} />)}
			</div>
		</section>
	);
}
