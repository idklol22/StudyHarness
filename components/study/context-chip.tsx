"use client";

/**
 * The one new-chat control (Study overhaul round 5, owner 2026-11-19): a single chip naming where the chat lives
 * and how it starts, e.g. "Algorithms › DP · From scratch". Clicking opens a popover over the composer: subject
 * search + inline create, topic list + Whole subject + inline create, the asked-every-time start mode, and a
 * shortcut to add files to that scope instead. All state/API work comes from the caller's useStudyPlacement hook —
 * this file only renders it. The popover owns Escape through the interaction layers (same law as the attach menu),
 * so the composer's Enter-to-send and the layered Escape ladder stay intact.
 */
import Link from "next/link";
import { cloneElement, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactElement, type RefObject } from "react";
import { createPortal } from "react-dom";
import { emptyLibrary, topicsOf, type ChatPlacement, type Library } from "@/src/core";
import { InteractionLayerOwner, useInteractionLayer, useInteractionLayers, useOptionalInteractionLayers } from "../interaction-layers";
import { INTERACTION_LAYER_Z_BASE } from "../host-dialog";
import { isInteractionScopeEligible } from "../plugin-input-focus";
import type { StartMode } from "./placement";
import type { PlacementState } from "./placement-picker";

/** Accepts a Choice (new chat) OR a ChatPlacement (existing chat): both carry scope + start mode. */
type ChipChoice = { subjectId: string; topicId?: string; startMode: StartMode | "" };

const MODE_LABEL: Record<StartMode, string> = { scratch: "From scratch", check: "Check what I know first" };

/** Pure: the chip's text. Mirrors placementLabel, adding the (never-defaulted) start mode. */
export function contextChipLabel(library: Library, choice: ChipChoice, practice = false): string {
	const subject = library.subjects.find((s) => s.id === choice.subjectId)?.name;
	const topic = choice.topicId ? library.topics.find((t) => t.id === choice.topicId)?.name : undefined;
	const scope = [subject, topic].filter(Boolean).join(" › ");
	const mode = practice ? "Practice" : choice.startMode ? MODE_LABEL[choice.startMode] : "";
	return [scope, mode].filter(Boolean).join(" · ");
}

const INPUT = "h-7 w-full rounded-md border border-border/60 bg-background px-2 text-[11px] text-foreground outline-none transition-colors hover:border-border focus-visible:border-ring";
const ITEM = "block w-full rounded px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

/** The popover's contents, pure (state in via props, events out via the same state object) so any harness can render
 *  it. `rootRef` / `style` are injected by the bound component for layering + anchoring. */
export function ContextChipPopover({ state, practice = false, showMissing = false, rootRef, style }: {
	state: PlacementState;
	practice?: boolean;
	showMissing?: boolean;
	rootRef?: RefObject<HTMLDivElement | null>;
	style?: CSSProperties;
}) {
	const [query, setQuery] = useState("");
	const [creating, setCreating] = useState<"" | "subject" | "topic">("");
	const [name, setName] = useState("");
	const subjects = state.library.subjects.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()));
	const topics = state.choice.subjectId ? topicsOf(state.library, state.choice.subjectId) : [];
	const subjectName = state.library.subjects.find((s) => s.id === state.choice.subjectId)?.name ?? "this subject";
	const submit = async (e: FormEvent) => {
		e.preventDefault();
		const value = name.trim();
		if (!value) return;
		if (creating === "subject") await state.createSubject(value);
		else if (creating === "topic") await state.createTopic(value);
		setName("");
		setCreating("");
	};
	return (
		<div
			ref={rootRef}
			data-testid="context-chip-popover"
			role="dialog"
			aria-label="Chat context"
			style={style}
			className="w-72 rounded-lg border bg-card p-2 text-foreground shadow-lg"
			onKeyDown={(e) => {
				const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
				const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
				const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : e.key === "ArrowDown" ? (index + 1) % buttons.length : e.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : -1;
				if (next >= 0) { e.preventDefault(); buttons[next]?.focus(); }
			}}
		>
			<input
				autoFocus
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder="Search subjects…"
				aria-label="Search subjects"
				data-testid="context-chip-subject-search"
				className={INPUT}
			/>
			<div data-testid="context-chip-subjects" role="listbox" aria-label="Subjects" className="mt-1 max-h-36 overflow-y-auto">
				{subjects.map((s) => (
					<button
						key={s.id}
						type="button"
						role="option"
						aria-selected={state.choice.subjectId === s.id}
						data-testid={`context-chip-subject-${s.id}`}
						onClick={() => { state.setSubject(s.id); setCreating(""); }}
						className={`${ITEM} ${state.choice.subjectId === s.id ? "bg-accent text-foreground" : ""}`}
					>
						{s.name}
					</button>
				))}
				{subjects.length === 0 && <p className="px-2 py-1 text-[11px] text-muted-foreground">No subjects found.</p>}
			</div>
			<button type="button" data-testid="context-chip-new-subject" onClick={() => { setCreating("subject"); setName(""); }} className={`${ITEM} mt-0.5 text-foreground`}>+ New subject</button>
			{creating === "subject" && (
				<form onSubmit={(e) => void submit(e)} data-testid="context-chip-create-subject" className="mt-1 flex items-center gap-1">
					<input
						autoFocus
						value={name}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setCreating(""); setName(""); } }}
						placeholder="New subject name"
						aria-label="New subject name"
						maxLength={120}
						className={INPUT}
					/>
					<button type="submit" disabled={!name.trim()} className="h-7 shrink-0 rounded-md border border-border/60 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40">Add</button>
				</form>
			)}
			{state.error && <p role="alert" data-testid="context-chip-error" className="mt-1 text-[11px] text-destructive">{state.error}</p>}
			{state.choice.subjectId && (
				<>
					<div className="my-1 border-t border-border/60" />
					<button
						type="button"
						role="option"
						aria-selected={!state.choice.topicId}
						data-testid="context-chip-whole-subject"
						onClick={() => state.setTopic("")}
						className={`${ITEM} ${!state.choice.topicId ? "bg-accent text-foreground" : ""}`}
					>
						Whole subject
					</button>
					<div data-testid="context-chip-topics" role="listbox" aria-label="Topics" className="max-h-36 overflow-y-auto">
						{topics.map((t) => (
							<button
								key={t.id}
								type="button"
								role="option"
								aria-selected={state.choice.topicId === t.id}
								data-testid={`context-chip-topic-${t.id}`}
								onClick={() => { state.setTopic(t.id); setCreating(""); }}
								className={`${ITEM} ${state.choice.topicId === t.id ? "bg-accent text-foreground" : ""}`}
							>
								{t.name}
							</button>
						))}
					</div>
					<button type="button" data-testid="context-chip-new-topic" onClick={() => { setCreating("topic"); setName(""); }} className={`${ITEM} text-foreground`}>+ New topic</button>
					{creating === "topic" && (
						<form onSubmit={(e) => void submit(e)} data-testid="context-chip-create-topic" className="mt-1 flex items-center gap-1">
							<input
								autoFocus
								value={name}
								onChange={(e) => setName(e.target.value)}
								onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setCreating(""); setName(""); } }}
								placeholder="New topic name"
								aria-label="New topic name"
								maxLength={120}
								className={INPUT}
							/>
							<button type="submit" disabled={!name.trim()} className="h-7 shrink-0 rounded-md border border-border/60 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40">Add</button>
						</form>
					)}
				</>
			)}
			{!practice && (
				<>
					<div className="my-1 border-t border-border/60" />
					<div role="radiogroup" aria-label="How to start" data-testid="context-chip-start-mode" className="flex flex-wrap gap-0.5">
						{([["scratch", "From scratch"], ["check", "Check what I know first"]] as const).map(([mode, label]) => (
							<button
								key={mode}
								type="button"
								role="radio"
								aria-checked={state.choice.startMode === mode}
								data-testid={`context-chip-mode-${mode}`}
								onClick={() => state.setStartMode(mode)}
								className={`rounded-sm px-2 py-0.5 text-[11px] transition-colors ${state.choice.startMode === mode ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
							>
								{label}
							</button>
						))}
					</div>
				</>
			)}
			{state.choice.subjectId && (
				<>
					<div className="my-1 border-t border-border/60" />
					<Link
						href={`/subjects/${state.choice.subjectId}${state.choice.topicId ? `/${state.choice.topicId}` : ""}#files`}
						data-testid="context-chip-add-files"
						className={`${ITEM} rounded-md border border-border/60 bg-background`}
					>
						Add files to {subjectName} instead
					</Link>
				</>
			)}
			{(showMissing && state.missing) && (
				<p role="alert" data-testid="context-chip-hint" className="mt-1 text-[11px] text-destructive">{state.missing}</p>
			)}
		</div>
	);
}

/** The popover, portaled through the interaction layer so Escape/Tab ownership follows the same ladder as the
 *  attach menu. Geometry is reanchored to the chip on scroll/resize; clicks outside dismiss it. */
function ContextChipPortal({ anchorRef, rootRef, open, close, children }: {
	anchorRef: RefObject<HTMLButtonElement | null>;
	rootRef: RefObject<HTMLDivElement | null>;
	open: boolean;
	close(): void;
	children: ReactElement<{ style?: CSSProperties; rootRef?: RefObject<HTMLDivElement | null> }>;
}) {
	const controller = useInteractionLayers();
	const owner = controller.ownerOf(anchorRef.current);
	const [at, setAt] = useState<{ left: number; top: number } | null>(null);
	const layer = useInteractionLayer({
		kind: "popup", enabled: open, rootRef, anchorRef, ownerId: owner?.id,
		onClose: (reason) => {
			close();
			if (reason === "escape" && controller.isPopupOrigin(anchorRef.current)) anchorRef.current?.focus();
			return "closed";
		},
	});
	const portal = controller.getPortalContainer(anchorRef.current, owner?.id);
	useLayoutEffect(() => {
		if (!open) { setAt(null); return; }
		const place = () => {
			const rect = anchorRef.current?.getBoundingClientRect();
			if (!rect) return;
			// The chip lives in the BOTTOM composer dock: a downward popover lands off-screen.
			// Open upward whenever there isn't room below it.
			const height = Math.min(rootRef.current?.offsetHeight || 340, window.innerHeight - 16);
			const below = window.innerHeight - rect.bottom;
			const top = below >= height + 8 ? rect.bottom + 4 : Math.max(8, rect.top - height - 4);
			setAt({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)), top });
		};
		place();
		window.addEventListener("scroll", place, true);
		window.addEventListener("resize", place);
		return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
	}, [open, anchorRef]);
	useEffect(() => {
		if (!open) return;
		const dismiss = (event: PointerEvent) => {
			if (isInteractionScopeEligible(rootRef.current, controller) && event.target instanceof Node && !rootRef.current?.contains(event.target) && !anchorRef.current?.contains(event.target)) close();
		};
		document.addEventListener("pointerdown", dismiss);
		return () => document.removeEventListener("pointerdown", dismiss);
	}, [open, close, controller, rootRef, anchorRef]);
	if (!portal) return null;
	return createPortal(
		<InteractionLayerOwner.Provider value={open ? layer.id : owner?.id ?? null}>
			{cloneElement(children, {
				rootRef,
				style: {
					...children.props.style,
					position: "fixed",
					zIndex: INTERACTION_LAYER_Z_BASE + (open ? layer.order : owner?.order ?? 0),
					maxHeight: "calc(100vh - 16px)",
					overflowY: "auto",
					...(at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: "hidden" as const }),
				},
			})}
		</InteractionLayerOwner.Provider>,
		portal,
	);
}

/** Contained fallback for a standalone render without the provider (no interaction layers to hand Escape to). */
function ContextChipFallback({ rootRef, close, children }: { rootRef: RefObject<HTMLDivElement | null>; close(): void; children: ReactElement<{ rootRef?: RefObject<HTMLDivElement | null> }> }) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
		const dismiss = (event: PointerEvent) => {
			if (event.target instanceof Node && !rootRef.current?.contains(event.target)) close();
		};
		document.addEventListener("keydown", onKey);
		document.addEventListener("pointerdown", dismiss);
		return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", dismiss); };
	}, [close, rootRef]);
	// Bottom-docked chip: open the contained fallback upward as well.
	return <div className="absolute bottom-full left-0 z-50 mb-1" onPointerDown={(e) => e.stopPropagation()}>{cloneElement(children, { rootRef })}</div>;
}

/** The bound chip: uses the SAME useStudyPlacement state the caller already owns. */
export function ContextChip({ state, practice = false, showMissing = false }: { state: PlacementState; practice?: boolean; showMissing?: boolean }) {
	const controller = useOptionalInteractionLayers();
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const label = contextChipLabel(state.library, state.choice, practice) || "Choose a subject";
	const popover = <ContextChipPopover state={state} practice={practice} showMissing={showMissing} />;
	return (
		<div
			className="relative mb-2 flex flex-wrap items-center gap-2"
			onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget) && !rootRef.current?.contains(e.relatedTarget)) setOpen(false); }}
		>
			<button
				ref={anchorRef}
				type="button"
				data-testid="context-chip"
				aria-label={`Chat context: ${label}`}
				aria-haspopup="dialog"
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
				className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 text-[11px] text-foreground transition-colors hover:border-border hover:bg-accent"
			>
				<span aria-hidden="true">◈</span>
				<span className="truncate">{label}</span>
			</button>
			{open && controller && <ContextChipPortal anchorRef={anchorRef} rootRef={rootRef} open close={() => setOpen(false)}>{popover}</ContextChipPortal>}
			{open && !controller && <ContextChipFallback rootRef={rootRef} close={() => setOpen(false)}>{popover}</ContextChipFallback>}
			{(showMissing && state.missing) && (
				<p role="alert" data-testid="context-chip-hint" className="basis-full text-[11px] text-destructive">{state.missing}</p>
			)}
		</div>
	);
}

/** Read-only chip for an EXISTING chat's dock: shows its placement, navigates to the subject/topic page.
 *  No editing: no popover, no PUT, no mutation. Names are enriched from the library when it arrives. */
export function ReadOnlyContextChip({ placement, practice = false, className = "" }: { placement: ChatPlacement; practice?: boolean; className?: string }) {
	const [library, setLibrary] = useState<Library>(emptyLibrary());
	useEffect(() => {
		let alive = true;
		fetch("/api/study/library", { cache: "no-store" })
			.then((r) => r.json() as Promise<{ library?: Library }>)
			.then((data) => { if (alive && data.library) setLibrary(data.library); })
			.catch(() => { /* offline: the ids still name the chip */ });
		return () => { alive = false; };
	}, []);
	const label = contextChipLabel(library, placement, practice) || placement.subjectId;
	const href = `/subjects/${placement.subjectId}${placement.topicId ? `/${placement.topicId}` : ""}`;
	return (
		<Link
			href={href}
			data-testid="chat-context-chip"
			title={`Open ${label}`}
			className={`mb-2 inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${className}`}
		>
			<span aria-hidden="true">◈</span>
			<span className="truncate">{label}</span>
		</Link>
	);
}
