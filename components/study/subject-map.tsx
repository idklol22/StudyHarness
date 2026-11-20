"use client";

/**
 * The 2D subject map (owner 2026-11-20): an Obsidian-style force graph on canvas. Subjects are hubs,
 * topics branch off them, ideas hang off their topic; subjects that share ideas are joined by a faint
 * dashed link. Wheel zooms toward the pointer (never the page), dragging the background pans,
 * nodes can be dragged and released back into the simulation, hover focuses a node's neighbourhood.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type ForceGraph from "force-graph";
import type { ForceLink } from "d3-force";
import { tokenHex } from "@/components/graph-view";
import { ZOOM_MAX } from "@/components/pan-zoom";
import { useServerEvent } from "@/components/server-events";
import { useAppearance } from "@/components/settings/appearance";
import { findMapIdea, layoutStudyMap, subjectColor, type MapLayout, type StudyMap } from "@/src/core";
import { IdeaCard } from "./idea-card";
import {
	nodeColor,
	nodeRadius,
	selectVisibleLabels,
	shortLabel,
	type LabelCandidate,
} from "./subject-map-graph";

type D3Force = typeof import("d3-force");
type GraphInstance = ForceGraph<GraphNode, GraphLink>;

interface GraphNode {
	id: string;
	kind: "subject" | "topic" | "idea";
	label: string;
	x?: number;
	y?: number;
	r: number;
	color: string;
	subjectId: string;
	href: string;
	parentId?: string;
}

interface GraphLink {
	id: string;
	source: string | GraphNode;
	target: string | GraphNode;
	kind: "hub" | "leaf" | "cross";
	weight: number;
	ideas: string[];
}

interface Focus {
	id: string | null;
	ids: Set<string>;
}

const NO_FOCUS: Focus = { id: null, ids: new Set() };
const LEAF_R = nodeRadius("idea");

function endpointId(end: string | GraphNode): string {
	return typeof end === "string" ? end : end.id;
}

function endpointNode(end: string | GraphNode): GraphNode | null {
	return typeof end === "string" ? null : end;
}

function buildGraphData(layout: MapLayout, map: StudyMap): { nodes: GraphNode[]; links: GraphLink[] } {
	const hues = new Map(map.subjects.map((s) => [s.id, subjectColor(map.subjects, s.id)]));
	const nodes: GraphNode[] = layout.nodes.map((n) => ({
		id: n.id,
		kind: n.kind,
		label: n.label,
		x: n.x,
		y: n.y,
		r: nodeRadius(n.kind),
		color: nodeColor(hues.get(n.subjectId) ?? 205, n.kind),
		subjectId: n.subjectId,
		href: n.href,
		...(n.parentId ? { parentId: n.parentId } : {}),
	}));
	const present = new Set(nodes.map((n) => n.id));
	// Keep every link endpoint inside the node set; force-graph's d3-force throws "node not found" otherwise.
	const links: GraphLink[] = layout.edges
		.filter((e) => present.has(e.from) && present.has(e.to))
		.map((e) => ({
			id: `${e.from}>${e.to}`,
			source: e.from,
			target: e.to,
			kind: e.from === e.subjectId ? "hub" : "leaf",
			weight: 1,
			ideas: [],
		}));
	for (const l of layout.links) {
		if (!present.has(l.a) || !present.has(l.b)) continue;
		links.push({ id: `${l.a}<>${l.b}`, source: l.a, target: l.b, kind: "cross", weight: l.weight, ideas: l.ideas });
	}
	return { nodes, links };
}

function buildAdjacency(links: readonly GraphLink[]): Map<string, Set<string>> {
	const adjacency = new Map<string, Set<string>>();
	for (const l of links) {
		const a = endpointId(l.source), b = endpointId(l.target);
		if (!adjacency.has(a)) adjacency.set(a, new Set());
		if (!adjacency.has(b)) adjacency.set(b, new Set());
		adjacency.get(a)!.add(b);
		adjacency.get(b)!.add(a);
	}
	return adjacency;
}

function focusFor(id: string | null, adjacency: ReadonlyMap<string, Set<string>>): Focus {
	if (!id) return NO_FOCUS;
	const ids = new Set(adjacency.get(id) ?? []);
	ids.add(id);
	return { id, ids };
}

function applyForces(graph: GraphInstance, d3: D3Force, reduced: boolean): void {
	// Configure the existing link force rather than replacing it. force-graph feeds `graphData` to the
	// simulation on the next tick (its updates are debounced), and `d3Force`'s setter initialises a brand
	// new force against the simulation's *current* nodes — still the previous, often empty, set. A link
	// whose node has not landed yet then throws "node not found". The simulation re-initialises this force
	// with the fresh nodes and links on its next update, so leave the links to it.
	const link = graph.d3Force("link") as unknown as ForceLink<GraphNode, GraphLink> | undefined;
	if (link) {
		link
			.id((n) => n.id)
			.distance((l) => (l.kind === "hub" ? 60 : l.kind === "leaf" ? 40 : 140))
			.strength((l) => (l.kind === "cross" ? 0.02 : 0.5));
	}
	// -120 for an idea, scaled up for the bigger hubs; gentle cooling so it settles instead of snapping.
	graph.d3Force("charge", d3.forceManyBody<GraphNode>().strength((n) => -120 * (n.r / LEAF_R)));
	graph.d3Force("center", d3.forceCenter(0, 0));
	graph.d3Force("collide", d3.forceCollide<GraphNode>().radius((n) => n.r + 4).strength(0.8));
	graph.d3AlphaDecay(reduced ? 0.08 : 0.012);
	graph.d3VelocityDecay(0.62);
	graph.cooldownTime(Infinity);
	graph.warmupTicks(reduced ? 80 : 24);
	graph.cooldownTicks(reduced ? 0 : 240);
}

/** `subjectId`: show only that subject (the subject page); otherwise every subject.
 *  `compact`: the subject page's top map — a smaller fit control, same graph. */
export function SubjectMap({ subjectId, compact = false }: { subjectId?: string; compact?: boolean } = {}) {
	const router = useRouter();
	const routerRef = useRef(router);
	routerRef.current = router;
	const { resolvedMode } = useAppearance();
	const [map, setMap] = useState<StudyMap | null>(null);
	const [failed, setFailed] = useState(false);
	const [hoverId, setHoverId] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [ready, setReady] = useState(false);

	const box = useRef<HTMLDivElement>(null);
	const host = useRef<HTMLDivElement>(null);
	const graph = useRef<GraphInstance | null>(null);
	const d3 = useRef<D3Force | null>(null);
	const size = useRef({ w: 0, h: 0 });
	const adjacency = useRef(new Map<string, Set<string>>());
	const focus = useRef<Focus>(NO_FOCUS);
	const labels = useRef(new Map<string, number>());
	const theme = useRef({ label: "#888888", bright: "#dddddd", edge: "#666666", bg: "#000000", font: "system-ui" });
	const selectedRef = useRef<string | null>(null);
	const minZoom = useRef(0.02);
	const zoom = useRef(1);
	const reducedRef = useRef(false);
	const fitted = useRef(false);
	const draggedAt = useRef(0);
	const lastBackgroundClick = useRef({ t: 0, x: 0, y: 0 });
	const wheelAnimation = useRef<number | null>(null);
	const fitRef = useRef<() => void>(() => {});

	const load = useCallback(async () => {
		try {
			const res = await fetch("/api/study/map", { cache: "no-store" });
			if (!res.ok) throw new Error("bad");
			const full = ((await res.json()) as { map: StudyMap }).map;
			setMap(subjectId ? { subjects: full.subjects.filter((s) => s.id === subjectId), links: [] } : full);
			setFailed(false);
		} catch { setFailed(true); }
	}, [subjectId]);
	useEffect(() => { void load(); }, [load]);
	useServerEvent("sources-changed", () => { void load(); });
	useServerEvent("chats-changed", () => { void load(); });
	useServerEvent("activity-changed", () => { void load(); });

	const layout = useMemo(() => (map ? layoutStudyMap(map) : null), [map]);
	const graphData = useMemo(() => (map && layout ? buildGraphData(layout, map) : null), [map, layout]);

	const redraw = useCallback(() => {
		const g = graph.current;
		if (g) g.zoom(g.zoom()); // force-graph redraws on a (no-op) zoom setter; hover/selection live in refs
	}, []);

	const fit = useCallback((animated = true) => {
		const g = graph.current;
		if (!g) return;
		const bbox = g.getGraphBbox();
		const { w, h } = size.current;
		if (!bbox || !w || !h) return;
		const pad = compact ? 18 : 28;
		const dx = Math.max(1, bbox.x[1] - bbox.x[0]);
		const dy = Math.max(1, bbox.y[1] - bbox.y[0]);
		const k = Math.max(0.02, Math.min((w - 2 * pad) / dx, (h - 2 * pad) / dy, 1.5));
		minZoom.current = k;
		g.minZoom(k).maxZoom(ZOOM_MAX);
		const ms = animated && !reducedRef.current ? 320 : 0;
		g.centerAt((bbox.x[0] + bbox.x[1]) / 2, (bbox.y[0] + bbox.y[1]) / 2, ms);
		g.zoom(k, ms);
	}, [compact]);
	fitRef.current = fit;

	useEffect(() => {
		const el = box.current;
		if (!el) return;
		const measure = () => {
			size.current = { w: el.clientWidth, h: el.clientHeight };
			graph.current?.width(Math.max(1, size.current.w)).height(Math.max(1, size.current.h));
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	useEffect(() => {
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => {
			reducedRef.current = media.matches;
			if (graph.current && d3.current) applyForces(graph.current, d3.current, media.matches);
		};
		update();
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);

	useEffect(() => {
		theme.current = {
			label: tokenHex("--muted-foreground"),
			bright: tokenHex("--foreground"),
			edge: tokenHex("--border"),
			bg: tokenHex("--background"),
			font: getComputedStyle(document.body).fontFamily || "system-ui",
		};
		redraw();
	}, [resolvedMode, redraw]);

	// The graph is created only in the browser, on demand: force-graph touches canvas/document on import.
	useEffect(() => {
		const el = host.current;
		if (!el) return;
		let cancelled = false;
		let instance: GraphInstance | null = null;
		void (async () => {
			const [{ default: ForceGraph }, force] = await Promise.all([import("force-graph"), import("d3-force")]);
			if (cancelled) return;
			d3.current = force;
			const g = new ForceGraph<GraphNode, GraphLink>(el);
			instance = g;
			graph.current = g;
			g
				.width(Math.max(1, size.current.w))
				.height(Math.max(1, size.current.h))
				.backgroundColor("rgba(0,0,0,0)")
				.nodeId("id")
				.nodeVal((n) => (nodeRadius(n.kind) ** 2) / 16)
				.nodeCanvasObjectMode(() => "replace")
				.nodeCanvasObject((n, ctx, scale) => {
					const x = n.x ?? 0, y = n.y ?? 0;
					const focused = focus.current;
					const nodeOpacity = focused.id && !focused.ids.has(n.id) ? 0.15 : 1;
					const chosen = selectedRef.current === n.id;
					ctx.save();
					ctx.globalAlpha = nodeOpacity;
					if (n.kind === "subject") {
						ctx.globalAlpha = nodeOpacity * 0.14;
						ctx.fillStyle = n.color;
						ctx.beginPath();
						ctx.arc(x, y, n.r + 7 / scale, 0, 2 * Math.PI);
						ctx.fill();
						ctx.globalAlpha = nodeOpacity;
					}
					ctx.fillStyle = n.color;
					ctx.beginPath();
					ctx.arc(x, y, chosen ? n.r + 3 / scale : n.r, 0, 2 * Math.PI);
					ctx.fill();
					if (n.kind !== "idea" || chosen) {
						ctx.strokeStyle = focused.id && focused.ids.has(n.id) ? theme.current.bright : n.color;
						ctx.lineWidth = (chosen ? 2 : 1.5) / scale;
						ctx.stroke();
					}
					const labelOpacity = labels.current.get(n.id);
					if (labelOpacity) {
						const fontPx = n.kind === "subject" ? 15 : n.kind === "topic" ? 11 : 10;
						ctx.font = `${n.kind === "subject" ? 600 : 400} ${fontPx / scale}px ${theme.current.font}`;
						ctx.textAlign = "center";
						ctx.textBaseline = "top";
						ctx.lineWidth = 3 / scale;
						ctx.strokeStyle = theme.current.bg;
						ctx.globalAlpha = nodeOpacity * labelOpacity;
						ctx.strokeText(shortLabel(n.label), x, y + (n.r + 5) / scale);
						ctx.fillStyle = focused.id && focused.ids.has(n.id) ? theme.current.bright : theme.current.label;
						ctx.fillText(shortLabel(n.label), x, y + (n.r + 5) / scale);
					}
					ctx.restore();
				})
				.nodePointerAreaPaint((n, paint, ctx) => {
					ctx.fillStyle = paint;
					ctx.beginPath();
					ctx.arc(n.x ?? 0, n.y ?? 0, n.r + 2, 0, 2 * Math.PI);
					ctx.fill();
				})
				.linkCanvasObjectMode(() => "replace")
				.linkCanvasObject((l, ctx, scale) => {
					const a = endpointNode(l.source), b = endpointNode(l.target);
					if (!a || !b) return;
					const focused = focus.current;
					const lit = focused.id !== null && (a.id === focused.id || b.id === focused.id);
					const opacity = focused.id ? (lit ? 1 : 0.15) : l.kind === "cross" ? 0.35 : 0.55;
					ctx.save();
					ctx.globalAlpha = opacity;
					ctx.strokeStyle = lit ? theme.current.bright : l.kind === "cross" ? theme.current.edge : theme.current.label;
					ctx.lineWidth = (lit ? 2 : 1) / scale;
					if (l.kind === "cross") ctx.setLineDash([6 / scale, 5 / scale]);
					ctx.beginPath();
					ctx.moveTo(a.x ?? 0, a.y ?? 0);
					ctx.lineTo(b.x ?? 0, b.y ?? 0);
					ctx.stroke();
					if (l.kind === "cross" && lit) {
						ctx.setLineDash([]);
						ctx.font = `${11 / scale}px ${theme.current.font}`;
						ctx.textAlign = "center";
						ctx.textBaseline = "bottom";
						ctx.lineWidth = 3 / scale;
						ctx.strokeStyle = theme.current.bg;
						const x = ((a.x ?? 0) + (b.x ?? 0)) / 2, y = ((a.y ?? 0) + (b.y ?? 0)) / 2;
						const text = `${l.weight} shared`;
						ctx.strokeText(text, x, y - 4 / scale);
						ctx.fillStyle = theme.current.bright;
						ctx.fillText(text, x, y - 4 / scale);
					}
					ctx.restore();
				})
				.onRenderFramePre((_ctx, scale) => {
					const candidates: LabelCandidate[] = g.graphData().nodes.map((n) => ({
						id: n.id,
						kind: n.kind,
						label: n.label,
						x: n.x ?? 0,
						y: n.y ?? 0,
						r: n.r,
						...(n.parentId ? { parentId: n.parentId } : {}),
					}));
					labels.current = new Map(
						selectVisibleLabels(candidates, scale, focus.current.ids).map((l) => [l.id, l.opacity]),
					);
				})
				.enableZoomInteraction(false) // wheel is handled below, with preventDefault on a non-passive listener
				.enablePanInteraction(true)
				.enableNodeDrag(true)
				.onZoom((t) => { zoom.current = t.k; })
				.onNodeHover((n) => {
					focus.current = focusFor(n?.id ?? null, adjacency.current);
					setHoverId(n?.id ?? null);
					redraw();
				})
				.onNodeClick((n) => {
					if (Date.now() - draggedAt.current < 200) return;
					if (n.kind === "idea") {
						selectedRef.current = n.id;
						setSelected(n.id);
						redraw();
					} else routerRef.current.push(n.href);
				})
				.onNodeDragEnd(() => {
					draggedAt.current = Date.now();
					graph.current?.d3ReheatSimulation();
				})
				.onBackgroundClick((e) => {
					const now = Date.now();
					const prev = lastBackgroundClick.current;
					if (now - prev.t < 350 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 24) {
						fitRef.current();
						lastBackgroundClick.current = { t: 0, x: 0, y: 0 };
					} else lastBackgroundClick.current = { t: now, x: e.clientX, y: e.clientY };
					selectedRef.current = null;
					setSelected(null);
				});
			applyForces(g, force, reducedRef.current);
			setReady(true);
		})();
		return () => {
			cancelled = true;
			instance?._destructor();
			graph.current = null;
			setReady(false);
		};
	}, [redraw]);

	// Data changes keep the learner's own pan/zoom; only the first load is fitted.
	useEffect(() => {
		if (!ready || !graphData) return;
		const g = graph.current;
		if (!g) return;
		adjacency.current = buildAdjacency(graphData.links);
		g.graphData(graphData);
		if (d3.current) applyForces(g, d3.current, reducedRef.current);
		if (!fitted.current && graphData.nodes.length) {
			const raf = requestAnimationFrame(() => {
				fitted.current = true;
				fit(false);
			});
			return () => cancelAnimationFrame(raf);
		}
		redraw();
	}, [ready, graphData, fit, redraw]);

	// Wheel: captured with passive:false so the page can never scroll under the graph.
	useEffect(() => {
		const el = box.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			// The idea card scrolls itself; the rest of the map never lets the wheel reach the page.
			const hit = e.target as HTMLElement | null;
			if (hit?.closest('[data-testid="map-idea-card"]')) return;
			e.preventDefault();
			e.stopPropagation();
			const g = graph.current;
			if (!g) return;
			const rect = el.getBoundingClientRect();
			const x = e.clientX - rect.left, y = e.clientY - rect.top;
			const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * rect.height : e.deltaY;
			const factor = Math.exp(-Math.max(-120, Math.min(120, delta)) * 0.002);
			const targetZoom = Math.min(ZOOM_MAX, Math.max(minZoom.current, zoom.current * factor));
			const apply = (k: number) => {
				const before = g.screen2GraphCoords(x, y);
				g.zoom(k);
				const after = g.screen2GraphCoords(x, y);
				const c = g.centerAt();
				g.centerAt(c.x + before.x - after.x, c.y + before.y - after.y);
			};
			if (wheelAnimation.current !== null) cancelAnimationFrame(wheelAnimation.current);
			const from = zoom.current;
			if (reducedRef.current || Math.abs(targetZoom - from) < 0.001) {
				apply(targetZoom);
				return;
			}
			const start = performance.now();
			const step = (now: number) => {
				const t = Math.min(1, (now - start) / 160);
				apply(from + (targetZoom - from) * (1 - Math.pow(1 - t, 3)));
				wheelAnimation.current = t < 1 ? requestAnimationFrame(step) : null;
			};
			wheelAnimation.current = requestAnimationFrame(step);
		};
		el.addEventListener("wheel", onWheel, { capture: true, passive: false });
		return () => {
			el.removeEventListener("wheel", onWheel, true);
			if (wheelAnimation.current !== null) cancelAnimationFrame(wheelAnimation.current);
		};
	}, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key.toLowerCase() !== "f" || e.metaKey || e.ctrlKey || e.altKey) return;
			const t = e.target as HTMLElement | null;
			if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
			e.preventDefault();
			fitRef.current();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const picked = selected && map ? findMapIdea(map, selected) : undefined;
	const names = useMemo(() => new Map((map?.subjects ?? []).map((s) => [s.id, s.name])), [map]);
	const hoverLinks = useMemo(
		() => (graphData?.links ?? []).filter((l) =>
			l.kind === "cross" && hoverId && (endpointId(l.source) === hoverId || endpointId(l.target) === hoverId)),
		[graphData, hoverId],
	);
	const closeCard = () => {
		selectedRef.current = null;
		setSelected(null);
		redraw();
	};

	if (failed && !map) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">Could not load your subjects.</div>;
	return (
		<div ref={box} data-testid="subject-map" className="absolute inset-0 touch-none select-none overflow-hidden">
			<div ref={host} className="absolute inset-0" role="img" aria-label="Your subjects, topics and ideas" />
			{map && !map.subjects.length && (
				<div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground" data-testid="subject-map-empty">
					<p>Nothing here yet. Start a chat below and pick “New subject”, or add files to a subject: each subject becomes a hub with its topics and their key ideas around it.</p>
				</div>
			)}
			{graphData && graphData.nodes.length > 0 && (
				<>
					{compact ? (
						<button type="button" onClick={() => fit()} data-testid="subject-map-fit" title="Zoom to fit (F)" className="lh-no-drag absolute right-2 top-2 z-10 rounded-md border bg-card/90 px-2 py-1 text-xs text-muted-foreground shadow transition-colors hover:text-foreground">⤢ Fit</button>
					) : (
						<div className="lh-no-drag absolute bottom-3 left-3 z-10 flex max-w-xs flex-col gap-2 text-xs">
							{hoverLinks.length > 0 && (
								<div className="rounded-xl border bg-card/90 p-2.5 shadow-lg backdrop-blur" data-testid="map-links">
									{hoverLinks.map((l) => (
										<p key={l.id} className="mb-1 last:mb-0"><span className="font-medium">{names.get(endpointId(l.source) === hoverId ? endpointId(l.target) : endpointId(l.source))}</span> <span className="text-muted-foreground">· {l.weight} shared · {l.ideas.slice(0, 5).join(", ")}</span></p>
									))}
								</div>
							)}
							<button type="button" onClick={() => fit()} data-testid="subject-map-fit" className="w-fit rounded-md border bg-card/90 px-2.5 py-1 text-muted-foreground shadow transition-colors hover:text-foreground">Fit to screen</button>
						</div>
					)}
					{picked && (
						<div className="lh-no-drag overscroll-contain absolute bottom-3 left-3 z-10 flex max-h-[min(26rem,calc(100%-5rem))] w-[380px] max-w-[calc(100%-1.5rem)] flex-col">
							<IdeaCard picked={picked} onClose={closeCard} />
						</div>
					)}
				</>
			)}
		</div>
	);
}
