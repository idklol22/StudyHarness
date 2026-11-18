"use client";

/**
 * The plugin pane beside a session's conversation (Study redesign, owner 2026-11-18: "the live
 * notebook sits next to the conversation on the right"). Plugins register panes with
 * `registerSessionPanel`; the host owns the chrome:
 *   - a toggle in the session top bar (SessionPanelToggle), remembered per device;
 *   - a resizable right-hand pane (drag its left edge), width remembered per device;
 *   - one tab per registered pane, the last chosen tab remembered.
 * Each pane body mounts through the same PluginMountPoint as plugin views, keyed by session, so
 * switching sessions or closing the pane aborts the plugin's mount signal.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";
import { PluginMountPoint, usePlugins } from "@/components/plugins";
import { Hint } from "@/components/ui/hint";
import type { PluginSessionPanel } from "@/src/core";

const OPEN_KEY = "lh.session-panel.open.v1";
const WIDTH_KEY = "lh.session-panel.width.v1";
const TAB_KEY = "lh.session-panel.tab.v1";
export const SESSION_PANEL_MIN = 280;
export const SESSION_PANEL_MAX = 760;
const SESSION_PANEL_DEFAULT = 400;

interface PanelState { open: boolean; width: number; tab: string | null }

/** Clamp a stored/dragged width into the allowed range (pure; exported for tests). */
export function clampPanelWidth(width: unknown): number {
	return typeof width === "number" && Number.isFinite(width)
		? Math.min(SESSION_PANEL_MAX, Math.max(SESSION_PANEL_MIN, Math.round(width)))
		: SESSION_PANEL_DEFAULT;
}

// One tiny per-window store shared by the toggle and the pane.
let state: PanelState = { open: true, width: SESSION_PANEL_DEFAULT, tab: null };
let loaded = false;
const listeners = new Set<() => void>();
function load(): void {
	if (loaded || typeof window === "undefined") return;
	loaded = true;
	try {
		state = {
			open: localStorage.getItem(OPEN_KEY) !== "0",
			width: clampPanelWidth(Number(localStorage.getItem(WIDTH_KEY) ?? SESSION_PANEL_DEFAULT)),
			tab: localStorage.getItem(TAB_KEY),
		};
	} catch { /* storage blocked: defaults */ }
}
function set(patch: Partial<PanelState>): void {
	state = { ...state, ...patch };
	try {
		if (patch.open !== undefined) localStorage.setItem(OPEN_KEY, patch.open ? "1" : "0");
		if (patch.width !== undefined) localStorage.setItem(WIDTH_KEY, String(patch.width));
		if (patch.tab !== undefined && patch.tab !== null) localStorage.setItem(TAB_KEY, patch.tab);
	} catch { /* best-effort */ }
	for (const l of [...listeners]) l();
}
const SERVER_STATE: PanelState = { open: false, width: SESSION_PANEL_DEFAULT, tab: null };
function usePanelState(): PanelState {
	return useSyncExternalStore(
		(l) => { load(); listeners.add(l); return () => { listeners.delete(l); }; },
		() => { load(); return state; },
		() => SERVER_STATE,
	);
}

interface PanelEntry { key: string; pluginId: string; panel: PluginSessionPanel }
function usePanels(): PanelEntry[] {
	const { snapshot } = usePlugins();
	return useMemo(() => snapshot.plugins
		.filter((p) => p.info.enabled && p.phase === "active")
		.flatMap((p) => (p.sessionPanels ?? []).map((panel) => ({ key: `${p.info.id}/${panel.id}`, pluginId: p.info.id, panel }))), [snapshot]);
}

/** The top-bar toggle; renders nothing when no plugin offers a pane. */
export function SessionPanelToggle() {
	const panels = usePanels();
	const { open } = usePanelState();
	if (!panels.length) return null;
	const label = open ? "Hide the side panel" : `Show ${panels.length === 1 ? panels[0]!.panel.name : "the side panel"}`;
	return (
		<Hint label={label} side="bottom">
			<button
				type="button"
				data-testid="session-panel-toggle"
				aria-pressed={open}
				aria-label={label}
				onClick={() => set({ open: !open })}
				className="lh-no-drag flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
			>
				{open ? <PanelRightCloseIcon className="size-4" /> : <PanelRightOpenIcon className="size-4" />}
			</button>
		</Hint>
	);
}

/** The pane itself, a flex sibling right of the conversation. */
export function PluginSessionPanels({ sessionId, sessionKind }: { sessionId: string; sessionKind: "teaching" | "practice" }) {
	const panels = usePanels();
	const { open, width, tab } = usePanelState();
	const active = panels.find((p) => p.key === tab) ?? panels[0];
	const dragRef = useRef<{ x: number; width: number } | null>(null);
	const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		dragRef.current = { x: e.clientX, width };
	}, [width]);
	const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
		const d = dragRef.current;
		if (d) set({ width: clampPanelWidth(d.width + (d.x - e.clientX)) });
	}, []);
	const onPointerUp = useCallback(() => { dragRef.current = null; }, []);
	// The mount closure is stable per pane + session, so React re-renders never remount the plugin.
	const mount = useMemo(() => active
		? (container: HTMLElement, signal: AbortSignal) => active.panel.mount(container, { sessionId, sessionKind }, signal)
		: null, [active, sessionId, sessionKind]);
	useEffect(() => { if (active && tab !== active.key && tab !== null && !panels.some((p) => p.key === tab)) set({ tab: active.key }); }, [active, tab, panels]);
	if (!open || !active || !mount) return null;
	return (
		<aside
			aria-label={active.panel.name}
			data-testid="session-panel"
			style={{ width }}
			className="relative flex shrink-0 flex-col border-l border-border bg-background"
		>
			<div
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize the side panel"
				aria-valuemin={SESSION_PANEL_MIN}
				aria-valuemax={SESSION_PANEL_MAX}
				aria-valuenow={width}
				tabIndex={0}
				onKeyDown={(e) => {
					if (e.key === "ArrowLeft") { e.preventDefault(); set({ width: clampPanelWidth(width + 24) }); }
					if (e.key === "ArrowRight") { e.preventDefault(); set({ width: clampPanelWidth(width - 24) }); }
				}}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize outline-none hover:bg-primary/20 focus-visible:bg-primary/30"
			/>
			{panels.length > 1 && (
				<div role="tablist" aria-label="Side panels" className="flex shrink-0 gap-1 border-b border-border px-2 py-1.5">
					{panels.map((p) => (
						<button
							key={p.key}
							type="button"
							role="tab"
							aria-selected={p.key === active.key}
							onClick={() => set({ tab: p.key })}
							className={`rounded-md px-2.5 py-1 text-xs transition-colors ${p.key === active.key ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60"}`}
						>
							{p.panel.name}
						</button>
					))}
				</div>
			)}
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
				<PluginMountPoint key={`${active.key}:${sessionId}`} pluginId={active.pluginId} mount={mount} label={active.panel.name} />
			</div>
		</aside>
	);
}
