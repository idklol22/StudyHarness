"use client";

/**
 * The chat's right-hand panel: lecture PDFs, figures, saved notes and the subject's files open beside the
 * transcript instead of navigating away. State is a small store (panel-store.ts) held in context by the chat view.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLinkIcon, FileTextIcon, ImageIcon, FolderIcon, XIcon } from "lucide-react";
import { PdfReaderView } from "@/components/study/pdf-reader";
import { useImageSnapshot } from "@/components/artifacts/use-image-snapshot";
import type { Library, Material } from "@/src/core";
import type { CitationMaterial } from "./citations";
import { clampPanelFraction, emptyPanel, itemKey, loadPanel, PANEL_WIDTH_KEY, panelReducer, savePanel, type PanelItem } from "./panel-store";

export interface PanelMaterial extends CitationMaterial { subjectId: string; text: boolean }
export interface SidePanelApi {
	items: PanelItem[];
	activeKey: string | null;
	materials: PanelMaterial[];
	subjectId?: string;
	open: (item: PanelItem) => void;
	/** Opens a library file (PDF reader, or the text reader for notes) at a page. */
	openMaterial: (materialId: string, page?: number) => void;
	openFiles: () => void;
	close: (key: string) => void;
	focus: (key: string) => void;
	clear: () => void;
}
const SidePanelContext = createContext<SidePanelApi | null>(null);
export const useSidePanel = () => useContext(SidePanelContext);

const toPanelMaterial = (m: Material): PanelMaterial => ({ id: m.id, fileName: m.fileName, pageCount: m.pageCount, title: m.meta?.title, subjectId: m.scope.subjectId, text: m.kind === "text" });

export function SidePanelProvider({ chatId, subjectId, children }: { chatId: string; subjectId?: string; children: ReactNode }) {
	const [state, dispatch] = useReducer(panelReducer, emptyPanel);
	const [materials, setMaterials] = useState<PanelMaterial[]>([]);
	const loaded = useRef(false);

	useEffect(() => {
		dispatch({ type: "clear" });
		const saved = loadPanel(chatId);
		for (const item of saved.items) dispatch({ type: "open", item: { ...item, nonce: undefined } });
		if (saved.activeKey) dispatch({ type: "focus", key: saved.activeKey });
		loaded.current = true;
	}, [chatId]);
	useEffect(() => { if (loaded.current) savePanel(chatId, state); }, [chatId, state]);

	useEffect(() => {
		if (!subjectId) return;
		let cancelled = false;
		void fetch("/api/study/library", { cache: "no-store" })
			.then((r) => r.ok ? r.json() as Promise<{ library: Library }> : Promise.reject(new Error("library")))
			.then((d) => { if (!cancelled) setMaterials(d.library.materials.filter((m) => m.scope.subjectId === subjectId).map(toPanelMaterial)); })
			.catch(() => { /* citations simply stay plain text */ });
		return () => { cancelled = true; };
	}, [subjectId]);

	const open = useCallback((item: PanelItem) => dispatch({ type: "open", item }), []);
	const materialsRef = useRef(materials);
	materialsRef.current = materials;
	const openMaterial = useCallback((materialId: string, page?: number) => {
		const m = materialsRef.current.find((x) => x.id === materialId);
		dispatch({ type: "open", item: { kind: m?.text ? "note" : "pdf", id: materialId, title: m?.title ?? m?.fileName ?? "File", subjectId: m?.subjectId ?? subjectId, page } });
	}, [subjectId]);
	const api = useMemo<SidePanelApi>(() => ({
		items: state.items,
		activeKey: state.activeKey,
		materials,
		subjectId,
		open,
		openMaterial,
		openFiles: () => open({ kind: "files", id: "files", title: "Files", subjectId }),
		close: (key) => dispatch({ type: "close", key }),
		focus: (key) => dispatch({ type: "focus", key }),
		clear: () => dispatch({ type: "clear" }),
	}), [state, materials, subjectId, open, openMaterial]);
	return <SidePanelContext.Provider value={api}>{children}</SidePanelContext.Provider>;
}

/** A clickable "(file, p. N)" chip; plain text when no panel is available. */
export function CitationPill({ materialId, page, label }: { materialId: string; page: number; label: string }) {
	const panel = useSidePanel();
	if (!panel) return <span>{label}</span>;
	return (
		<button type="button" data-testid="citation-pill" title="Open in side panel" onClick={() => panel.openMaterial(materialId, page)}
			className="mx-0.5 inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 align-baseline text-xs text-foreground transition-colors hover:bg-accent">
			<FileTextIcon className="size-3 text-muted-foreground" aria-hidden />{label.replace(/^\(|\)$/g, "")}
		</button>
	);
}

const NARROW = 900;
const KIND_ICON = { pdf: FileTextIcon, note: FileTextIcon, figure: ImageIcon, files: FolderIcon } as const;

export function openFullPageHref(item: PanelItem, subjectId?: string): string | null {
	const sid = item.subjectId ?? subjectId;
	if (!sid) return null;
	if (item.kind === "files") return `/subjects/${encodeURIComponent(sid)}#files`;
	const material = item.kind === "figure" ? item.materialId : item.id;
	return material ? `/subjects/${encodeURIComponent(sid)}/read/${encodeURIComponent(material)}${item.page ? `?page=${item.page}` : ""}` : null;
}

/** Mount as a sibling right of the transcript column inside a flex row. */
export function SidePanel() {
	const panel = useSidePanel();
	const rootRef = useRef<HTMLElement>(null);
	const [fraction, setFraction] = useState(0.5);
	const [total, setTotal] = useState(1400);
	const [dragging, setDragging] = useState(false);

	useEffect(() => {
		try { const f = Number(window.localStorage.getItem(PANEL_WIDTH_KEY)); if (f > 0 && f < 1) setFraction(f); } catch { /* default */ }
	}, []);
	const hasItems = (panel?.items.length ?? 0) > 0;
	useEffect(() => {
		const parent = rootRef.current?.parentElement;
		if (!parent) return;
		const ro = new ResizeObserver(() => setTotal(parent.clientWidth));
		ro.observe(parent);
		setTotal(parent.clientWidth);
		return () => ro.disconnect();
	}, [hasItems]);

	const startDrag = useCallback((event: React.PointerEvent) => {
		event.preventDefault();
		const parent = rootRef.current?.parentElement;
		if (!parent) return;
		setDragging(true);
		const rect = parent.getBoundingClientRect();
		let last = fraction;
		const move = (e: PointerEvent) => { last = clampPanelFraction((rect.right - e.clientX) / rect.width, rect.width); setFraction(last); };
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			setDragging(false);
			try { window.localStorage.setItem(PANEL_WIDTH_KEY, String(last)); } catch { /* best effort */ }
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	}, [fraction]);

	if (!panel || !hasItems) return null;
	const narrow = total < NARROW;
	const active = panel.items.find((i) => itemKey(i) === panel.activeKey) ?? panel.items[panel.items.length - 1]!;
	const full = openFullPageHref(active, panel.subjectId);
	const onKeyDown = (event: ReactKeyboardEvent) => {
		if (event.key !== "Escape" || event.defaultPrevented) return;
		const t = event.target as HTMLElement;
		if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") { t.blur(); return; }
		event.stopPropagation();
		event.nativeEvent.stopImmediatePropagation();
		panel.clear();
	};

	return (
		<aside
			ref={rootRef}
			aria-label="Side panel"
			data-testid="side-panel"
			onKeyDown={onKeyDown}
			style={narrow ? undefined : { width: `${clampPanelFraction(fraction, total) * 100}%` }}
			className={narrow
				? "fixed inset-y-0 right-0 z-40 flex min-h-0 w-full min-w-0 flex-col overflow-hidden border-l border-border bg-background shadow-lg"
				: "relative flex h-full min-h-0 min-w-[320px] shrink-0 flex-col overflow-hidden border-l border-border bg-background"}
		>
			{!narrow && (
				<div role="separator" aria-orientation="vertical" aria-label="Resize side panel" data-testid="side-panel-divider" onPointerDown={startDrag}
					className={`absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize transition-colors hover:bg-border ${dragging ? "bg-border" : ""}`} />
			)}
			{dragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
			<div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
				<div role="tablist" aria-label="Open items" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
					{panel.items.map((item) => {
						const key = itemKey(item);
						const Icon = KIND_ICON[item.kind];
						const on = key === itemKey(active);
						return (
							<div key={key} className={`group flex max-w-[11rem] shrink-0 items-center rounded-md border text-xs ${on ? "border-border bg-accent text-foreground" : "border-transparent text-muted-foreground hover:bg-accent/60"}`}>
								<button type="button" role="tab" aria-selected={on} onClick={() => panel.focus(key)} className="flex min-w-0 items-center gap-1.5 py-1 pl-2 pr-1" title={item.title}>
									<Icon className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{item.title}</span>
								</button>
								<button type="button" aria-label={`Close ${item.title}`} onClick={() => panel.close(key)} className="mr-1 rounded p-0.5 hover:bg-background"><XIcon className="size-3" /></button>
							</div>
						);
					})}
				</div>
				{full && <Link href={full} title="Open full page" aria-label="Open full page" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><ExternalLinkIcon className="size-4" /></Link>}
				<button type="button" title="Close panel (Esc)" aria-label="Close side panel" onClick={panel.clear} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><XIcon className="size-4" /></button>
			</div>
			<div className="min-h-0 min-w-0 flex-1 overflow-hidden">
				{panel.items.map((item) => {
					const key = itemKey(item);
					return (
						<div key={key} role="tabpanel" hidden={key !== itemKey(active)} className="h-full min-h-0 min-w-0 overflow-hidden">
							<PanelBody item={item} />
						</div>
					);
				})}
			</div>
		</aside>
	);
}

function PanelBody({ item }: { item: PanelItem }) {
	if (item.kind === "files") return <FilesPicker />;
	if (item.kind === "figure") return <FigureView item={item} />;
	return <PdfReaderView materialId={item.id} page={item.page} jumpKey={item.nonce} compact />;
}

function FilesPicker() {
	const panel = useSidePanel();
	const [query, setQuery] = useState("");
	const files = (panel?.materials ?? []).filter((m) => `${m.fileName} ${m.title ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
	return (
		<div className="flex h-full flex-col gap-2 p-3" data-testid="panel-files">
			<input aria-label="Filter files" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter files" className="rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground" />
			<ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
				{files.map((m) => (
					<li key={m.id}>
						<button type="button" onClick={() => panel?.openMaterial(m.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
							<FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
							<span className="min-w-0 flex-1 truncate">{m.title ?? m.fileName}</span>
							<span className="shrink-0 text-xs tabular-nums text-muted-foreground">{m.pageCount} p.</span>
						</button>
					</li>
				))}
				{!files.length && <li className="px-2 py-3 text-sm text-muted-foreground">{panel?.materials.length ? "No files match." : "No files in this subject yet."}</li>}
			</ul>
		</div>
	);
}

function FigureView({ item }: { item: PanelItem }) {
	const panel = useSidePanel();
	const { image, failed } = useImageSnapshot(item.id);
	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="panel-figure">
			<div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-card p-4">
				{image
					// eslint-disable-next-line @next/next/no-img-element
					? <img src={`data:${image.mimeType};base64,${image.data}`} alt={item.caption || item.title} className="max-h-full max-w-full object-contain" draggable={false} />
					: <span className="text-sm text-muted-foreground" role="status">{failed ? "Figure snapshot could not be loaded." : "Loading figure…"}</span>}
			</div>
			<div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border px-3 py-2 text-sm">
				{item.caption && <span className="min-w-0 flex-1 text-muted-foreground">{item.caption}</span>}
				{item.materialId && (
					<button type="button" data-testid="figure-open-page" onClick={() => panel?.openMaterial(item.materialId!, item.page)} className="ml-auto shrink-0 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent">
						Open page{item.page ? ` ${item.page}` : ""}
					</button>
				)}
			</div>
		</div>
	);
}

/** Chat-header button: opens the subject's file picker in the panel. Renders only for chats with a subject. */
export function FilesButton() {
	const panel = useSidePanel();
	if (!panel?.subjectId) return null;
	return (
		<button type="button" data-testid="panel-files-button" title="Subject files" onClick={panel.openFiles}
			className="lh-no-drag flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border/80 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:border-border hover:text-foreground">
			<FolderIcon className="size-3.5" aria-hidden />Files
		</button>
	);
}

/** A saved-note card: opens the note in the panel, falling back to the reader page. */
export function SavedNoteLink({ materialId, subjectId, title, className, children }: { materialId: string; subjectId?: string; title: string; className?: string; children: ReactNode }) {
	const panel = useSidePanel();
	return (
		<a data-testid="saved-chat-notes-card" href={`/subjects/${subjectId}/read/${materialId}`} className={className}
			onClick={panel ? (event) => { event.preventDefault(); panel.open({ kind: "note", id: materialId, title, subjectId }); } : undefined}>
			{children}
		</a>
	);
}
