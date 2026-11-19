"use client";

/**
 * The home map of your studies (owner 2026-11-19): every subject is a hub in the middle of its own cluster, its
 * topics and direct chats/files branch off it, and a topic's chats and files hang off the topic. Subjects that share
 * ideas (or whose ideas connect) are joined by a dashed link that says how many. Drag to pan, scroll to zoom,
 * click anything to open it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useServerEvent } from "@/components/server-events";
import { fitGraphView, fitZoomFor, zoomedGraphView, type Viewport } from "@/components/pan-zoom";
import { IdeaCard } from "./idea-card";
import { findMapIdea, layoutStudyMap, type MapLink, type MapNode, type StudyMap } from "@/src/core";

const KIND_LABEL: Record<MapNode["kind"], string> = { subject: "Subject", topic: "Topic", idea: "Idea" };

/** `subjectId`: show only that subject (the subject page); otherwise every subject.
 *  `compact`: the subject page's top map — topic labels only, and a hovering topic shows its ideas as a floating list. */
export function SubjectMap({ subjectId, compact = false }: { subjectId?: string; compact?: boolean } = {}) {
	const [hoverNode, setHoverNode] = useState<MapNode | null>(null);
	const router = useRouter();
	const [map, setMap] = useState<StudyMap | null>(null);
	const [failed, setFailed] = useState(false);
	const [hover, setHover] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [size, setSize] = useState({ w: 0, h: 0 });
	const [view, setView] = useState<Viewport>({ zoom: 1, x: 0, y: 0 });
	const [fitted, setFitted] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

	const load = useCallback(async () => {
		try {
			const res = await fetch("/api/study/map", { cache: "no-store" });
			if (!res.ok) throw new Error("bad");
			const full = ((await res.json()) as { map: StudyMap }).map;
			setMap(subjectId ? { subjects: full.subjects.filter((s) => s.id === subjectId), links: [] } : full);
			setFailed(false);
		} catch { setFailed(true); }
	}, []);
	useEffect(() => { void load(); }, [load]);
	useServerEvent("sources-changed", () => { void load(); });
	useServerEvent("chats-changed", () => { void load(); });
	useServerEvent("activity-changed", () => { void load(); });

	useEffect(() => {
		const el = box.current;
		if (!el) return;
		const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const layout = useMemo(() => (map ? layoutStudyMap(map) : null), [map]);
	const fit = useMemo(() => (layout && size.w ? fitZoomFor(layout, size) : 1), [layout, size]);
	const refit = useCallback(() => { if (layout && size.w) setView(fitGraphView(layout, size, fit)); }, [layout, size, fit]);
	// Fit once when there is something to show; later data changes keep the learner's own pan/zoom.
	useEffect(() => { if (layout?.nodes.length && size.w && !fitted) { refit(); setFitted(true); } }, [layout, size, fitted, refit]);

	const byId = useMemo(() => new Map((layout?.nodes ?? []).map((n) => [n.id, n])), [layout]);
	const names = useMemo(() => new Map((map?.subjects ?? []).map((s) => [s.id, s.name])), [map]);
	const related = useMemo(() => {
		const set = new Set<string>();
		if (hover) for (const l of map?.links ?? []) { if (l.a === hover) set.add(l.b); if (l.b === hover) set.add(l.a); }
		return set;
	}, [hover, map]);
	const focusSubject = hover ? byId.get(hover)?.subjectId ?? hover : null;
	const dim = (subjectId: string) => focusSubject !== null && subjectId !== focusSubject && !related.has(subjectId);

	const open = (n: MapNode) => {
		if (drag.current?.moved) return;
		if (n.kind === "idea") setSelected((cur) => (cur === n.id ? null : n.id));
		else router.push(n.href);
	};
	const picked = selected && map ? findMapIdea(map, selected) : undefined;
	const linkPath = (l: MapLink) => {
		const a = byId.get(l.a), b = byId.get(l.b);
		if (!a || !b || !layout) return "";
		const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, cx = layout.w / 2, cy = layout.h / 2;
		// Bow the line toward the middle of the map so it clears the clusters.
		const k = 0.25;
		return `M ${a.x} ${a.y} Q ${mx + (cx - mx) * k} ${my + (cy - my) * k} ${b.x} ${b.y}`;
	};
	const linkMid = (l: MapLink) => {
		const a = byId.get(l.a), b = byId.get(l.b);
		if (!a || !b || !layout) return { x: 0, y: 0 };
		const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
		return { x: mx + (layout.w / 2 - mx) * 0.125, y: my + (layout.h / 2 - my) * 0.125 };
	};
	const hoverLinks = (map?.links ?? []).filter((l) => hover && (l.a === hover || l.b === hover));
	// Compact (subject-page) map: the ideas of the topic under the pointer, shown as a floating list instead of labels.
	const compactIdeas = useMemo(() => {
		if (!compact || !map || hoverNode?.kind !== "topic") return [] as Array<{ id: string; name: string }>;
		for (const s of map.subjects) {
			const t = s.topics.find((topic) => topic.id === hoverNode.id);
			if (t) return t.ideas.map((i) => ({ id: i.id, name: i.name }));
		}
		return [];
	}, [compact, map, hoverNode]);

	if (failed && !map) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">Could not load your subjects.</div>;
	return (
		<div
			ref={box}
			data-testid="subject-map"
			className="absolute inset-0 touch-none select-none overflow-hidden"
			onWheel={(e) => {
				if (!layout || !box.current) return;
				const rect = box.current.getBoundingClientRect();
				setView((v) => zoomedGraphView(v, e.deltaY < 0 ? 1.12 : 1 / 1.12, fit, { x: e.clientX - rect.left, y: e.clientY - rect.top }, layout, size));
			}}
			onPointerDown={(e) => { if (e.button === 0) drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; }}
			onPointerMove={(e) => {
				const d = drag.current;
				if (!d) return;
				const dx = e.clientX - d.x, dy = e.clientY - d.y;
				if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
				if (d.moved) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
			}}
			onPointerUp={() => { setTimeout(() => { drag.current = null; }, 0); }}
			onPointerLeave={() => { drag.current = null; }}
		>
			{map && !map.subjects.length && (
				<div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground" data-testid="subject-map-empty">
					<p>Nothing here yet. Start a chat below and pick “New subject”, or add files to a subject: each subject becomes a hub with its topics and their key ideas around it.</p>
				</div>
			)}
			{layout && layout.nodes.length > 0 && (
				<svg width={size.w} height={size.h} role="img" aria-label="Your subjects, topics, chats and files" className="block">
					<g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
						{layout.edges.map((e) => {
							const a = byId.get(e.from), b = byId.get(e.to);
							return a && b ? <line key={`${e.from}-${e.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-border" strokeWidth={e.from === e.subjectId ? 1.6 : 1} opacity={dim(e.subjectId) ? 0.15 : 0.9} /> : null;
						})}
						{layout.links.map((l) => {
							const mid = linkMid(l);
							const lit = hover === l.a || hover === l.b;
							return (
								<g key={`${l.a}-${l.b}`} opacity={focusSubject && !lit ? 0.12 : 1}>
									<path d={linkPath(l)} fill="none" className="stroke-primary" strokeWidth={1.5 + Math.min(4, l.weight)} strokeDasharray="7 6" strokeLinecap="round" opacity={0.55}>
										<title>{`${names.get(l.a)} ↔ ${names.get(l.b)}: ${l.ideas.join(", ")}`}</title>
									</path>
									<text x={mid.x} y={mid.y - 6} textAnchor="middle" className="fill-primary text-[11px]" style={{ paintOrder: "stroke" }} stroke="var(--background)" strokeWidth={4}>{l.weight} shared</text>
								</g>
							);
						})}
						{layout.nodes.map((n) => {
							const faded = dim(n.subjectId);
							// Declutter: an idea's name shows only for the topic you point at (or the idea you picked), or when zoomed in.
							// In compact mode no idea labels are drawn on the canvas at all — a hovering topic lists them instead.
							const topicInFocus = hoverNode ? (hoverNode.kind === "topic" ? hoverNode.id : hoverNode.parentId) : picked?.topic?.id;
							const ideaLabel = !compact && (selected === n.id || n.parentId === topicInFocus || hoverNode?.id === n.id || view.zoom >= 1.6);
							const labelled = n.kind === "subject" || n.kind === "topic" || (n.kind === "idea" && ideaLabel);
							const shown = n.label.length > 24 ? `${n.label.slice(0, 23).trimEnd()}…` : n.label;
							return (
								<g
									key={n.id}
									opacity={faded ? 0.2 : 1}
									className="cursor-pointer"
									onPointerEnter={() => { setHover(n.kind === "subject" ? n.id : n.subjectId); setHoverNode(n); }}
									onPointerLeave={() => { setHover(null); setHoverNode(null); }}
									onClick={() => open(n)}
									role="link"
									aria-label={`${KIND_LABEL[n.kind]}: ${n.label}`}
									data-testid={`map-${n.kind}`}
								>
									{n.kind === "subject" && <circle cx={n.x} cy={n.y} r={n.r + 6} className="fill-primary" opacity={0.12} />}
									<circle cx={n.x} cy={n.y} r={n.kind === "idea" && selected === n.id ? n.r + 3 : n.r} className={n.kind === "subject" ? "fill-primary" : n.kind === "topic" ? "fill-card stroke-primary" : selected === n.id ? "fill-primary" : "fill-foreground/70"} strokeWidth={n.kind === "topic" ? 2 : 0} />
									<title>{`${KIND_LABEL[n.kind]}: ${n.label}`}</title>
									{labelled && (
										<text
											x={n.x}
											y={n.y + n.r + (n.kind === "subject" ? 18 : 13)}
											textAnchor="middle"
											className={n.kind === "subject" ? "fill-foreground text-[15px] font-semibold" : "fill-muted-foreground text-[11px]"}
											style={{ paintOrder: "stroke" }}
											stroke="var(--background)"
											strokeWidth={4}
										>{shown}</text>
									)}
									{compact && n.kind === "topic" && hoverNode?.id === n.id && compactIdeas.length > 0 && (
										<foreignObject x={n.x + n.r - 2} y={n.y - 12} width={190} height={Math.min(260, 26 + compactIdeas.length * 26)} data-testid="map-topic-ideas">
											<div className="max-h-64 overflow-y-auto rounded-lg border bg-card/95 p-2 text-[11px] shadow-lg">
												<div className="mb-1 truncate font-medium">{n.label}</div>
												{compactIdeas.map((idea) => (
													<button key={idea.id} type="button" title={idea.name} onClick={(e) => { e.stopPropagation(); setSelected((cur) => (cur === idea.id ? null : idea.id)); }} className="block w-full truncate rounded px-1.5 py-1 text-left hover:bg-accent">{idea.name}</button>
												))}
											</div>
										</foreignObject>
									)}
								</g>
							);
						})}
					</g>
				</svg>
			)}
			{layout && layout.nodes.length > 0 && (
				<div className={`lh-no-drag absolute ${subjectId ? "bottom-3" : "bottom-24"} left-3 z-10 flex max-w-xs flex-col gap-2 text-xs`}>
					{hoverLinks.length > 0 && (
						<div className="rounded-xl border bg-card/90 p-2.5 shadow-lg backdrop-blur" data-testid="map-links">
							{hoverLinks.map((l) => (
								<p key={`${l.a}-${l.b}`} className="mb-1 last:mb-0"><span className="font-medium">{names.get(l.a === hover ? l.b : l.a)}</span> <span className="text-muted-foreground">· {l.weight} shared · {l.ideas.slice(0, 5).join(", ")}</span></p>
							))}
						</div>
					)}
					{picked && <IdeaCard picked={picked} onClose={() => setSelected(null)} />}
					<button type="button" onClick={refit} className="w-fit rounded-md border bg-card/90 px-2.5 py-1 text-muted-foreground shadow transition-colors hover:text-foreground">Fit to screen</button>
				</div>
			)}
		</div>
	);
}
