"use client";

/**
 * The one knowledge graph on Home (owner 2026-11-19): a 3D globe. The centre ("Knowledge", can be hidden) spokes to
 * every subject; subjects span out their topics, topics their ideas; related subjects (field, shared ideas) sit near
 * each other. Click a subject or topic to open its page, an idea to see its files and chats. Drag to rotate, scroll
 * to zoom. Without WebGL it falls back to the flat map.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRightIcon, CrosshairIcon, OrbitIcon, SlidersHorizontalIcon, Trash2Icon } from "lucide-react";
import { useServerEvent } from "@/components/server-events";
import { useAppearance } from "@/components/settings/appearance";
import { CLUSTER_LIGHTNESS } from "@/components/graph-canvas";
import { Graph3DRenderer } from "@/components/graph-3d";
import { tokenHex } from "@/components/graph-view";
import { DEFAULT_RENDER_SETTINGS, findMapIdea, knowledgeGraph, subjectColor, type StudyMap } from "@/src/core";
import { IdeaCard } from "./idea-card";
import { GraphTuningPanel, readTuning, saveTuning } from "./graph-tuning-panel";
import { SubjectColor } from "./subject-color";
import { DEFAULT_TUNING, type GraphTuning } from "@/components/graph-3d-layout";
import { SubjectMap } from "./subject-map";

const CENTRE_KEY = "lh.knowledge.centre.v1";
const CAMERA_KEY = "lh.knowledge.camera3d.v4";

export function Knowledge3D() {
	const router = useRouter();
	const hostRef = useRef<HTMLDivElement>(null);
	const routerRef = useRef(router);
	routerRef.current = router;
	const rendererRef = useRef<Graph3DRenderer | null>(null);
	const [map, setMap] = useState<StudyMap | null>(null);
	const [noGl, setNoGl] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	const [centre, setCentre] = useState(true);
	/** Round 5: a short crossfade while the centre toggle re-places and re-fits the graph. */
	const [transitioning, setTransitioning] = useState(false);
	/** The subject the graph is narrowed to ("" = all). */
	const [only, setOnly] = useState("");
	const lastOnly = useRef("");
	const [tuning, setTuning] = useState<GraphTuning>(DEFAULT_TUNING);
	const tuningRef = useRef(tuning);
	tuningRef.current = tuning;
	const [tuningOpen, setTuningOpen] = useState(false);
	const [notice, setNotice] = useState("");
	/** Bumped when the deferred WebGL renderer is ready, so data/tuning effects re-run. */
	const [rendererReady, setRendererReady] = useState(0);
	useEffect(() => { setTuning(readTuning()); }, []);
	useEffect(() => { rendererRef.current?.setTuning(tuning); }, [tuning, rendererReady]);
	const changeTuning = (t: GraphTuning) => { setTuning(t); saveTuning(t); };
	const toggleCentre = () => {
		const next = !centre;
		setCentre(next);
		setTransitioning(true);
		window.setTimeout(() => setTransitioning(false), 480);
		try { localStorage.setItem(CENTRE_KEY, next ? "on" : "off"); } catch { /* best-effort */ }
	};
	const { resolvedMode, colors } = useAppearance();
	const mapRef = useRef<StudyMap | null>(null);
	mapRef.current = map;

	const load = useCallback(async () => {
		try { const r = await fetch("/api/study/map", { cache: "no-store" }); if (r.ok) setMap(((await r.json()) as { map: StudyMap }).map); } catch { /* keep the last map */ }
	}, []);
	useEffect(() => { void load(); }, [load]);
	useServerEvent("sources-changed", () => { void load(); });
	useServerEvent("chats-changed", () => { void load(); });
	useEffect(() => { try { setCentre(localStorage.getItem(CENTRE_KEY) !== "off"); } catch { /* default on */ } }, []);
	// Delete / Backspace removes the selected node (after asking), unless you are typing somewhere.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Delete" && e.key !== "Backspace") return;
			const t = e.target as HTMLElement | null;
			if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
			e.preventDefault(); void removeRef.current();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const graph = useMemo(() => (map ? knowledgeGraph(map) : null), [map]);
	// A distinct colour per subject: hues spaced by the golden angle in name order (stable as subjects are added).
	const subjectHues = useMemo(() => Object.fromEntries((map?.subjects ?? []).map((s) => [s.id, subjectColor(map!.subjects, s.id)])), [map]);

	// WebGL context creation is expensive (three.js getContext blocks the main thread). Defer it until
	// the browser is idle so Home's composer and sidebar are interactive immediately. The scheduled init
	// is cancelled on cleanup — in React's development double-mount this avoids creating TWO contexts.
	useEffect(() => {
		const host = hostRef.current;
		if (!host || noGl) return;
		let disposed = false;
		let canvas: HTMLCanvasElement | null = null;
		let renderer: Graph3DRenderer | null = null;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const init = () => {
			if (disposed || !hostRef.current) return;
			canvas = document.createElement("canvas");
			canvas.className = "absolute inset-0 block h-full w-full touch-none outline-none";
			host.appendChild(canvas);
			let camera = null;
			try { const raw = localStorage.getItem(CAMERA_KEY); if (raw) camera = JSON.parse(raw); } catch { /* frame itself */ }
			try {
				renderer = new Graph3DRenderer(canvas, {
					// One click selects (and shows a card); a double click opens the subject's or topic's page.
					onSelect: (nodeId) => setSelected(nodeId),
					onHub: (subjectId) => setSelected(`subject:${subjectId}`),
					onOpen: (nodeId, group) => {
						const m = mapRef.current;
						if (!m) return;
						if (group) { routerRef.current.push(`/subjects/${group}`); return; }
						const topic = m.subjects.flatMap((s) => s.topics).find((t) => t.id === nodeId);
						if (topic) routerRef.current.push(topic.href);
					},
					onContext: () => {},
					onStageClick: () => setSelected(null),
					onCameraMove: () => {},
					onCommit: () => {},
					onCamera3D: (state) => { if (timer) clearTimeout(timer); timer = setTimeout(() => { try { localStorage.setItem(CAMERA_KEY, JSON.stringify(state)); } catch { /* best-effort */ } }, 250); },
					onUnavailable: (reason) => setNoGl(reason),
				}, camera);
			} catch (error) { canvas.remove(); canvas = null; setNoGl(error instanceof Error ? error.message : "WebGL is not available"); return; }
			rendererRef.current = renderer;
			renderer.setSettings(DEFAULT_RENDER_SETTINGS);
			renderer.setTuning(tuningRef.current);
			setRendererReady((n) => n + 1);
		};
		const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
		const idle = w.requestIdleCallback;
		const handle = typeof idle === "function" ? idle.call(w, init, { timeout: 300 }) : window.setTimeout(init, 0);
		return () => {
			disposed = true;
			if (typeof idle === "function") w.cancelIdleCallback?.(handle);
			else clearTimeout(handle);
			if (timer) clearTimeout(timer);
			rendererRef.current = null;
			renderer?.destroy();
			canvas?.remove();
		};
	}, [noGl]);

	useEffect(() => {
		const r = rendererRef.current;
		if (!r || !graph || !graph.clusters.length) return;
		r.setData({
			nodes: graph.nodes.map((n) => ({ id: n.id, x: 0, y: 0, label: n.label })),
			edges: graph.edges,
			clusters: graph.clusters,
			parents: graph.parents,
			anchors: graph.anchors,
			hues: subjectHues,
			topicIds: new Set(graph.nodes.filter((n) => n.kind === "topic").map((n) => n.id)),
			colors: { node: tokenHex("--primary"), edge: tokenHex("--muted-foreground"), label: tokenHex("--muted-foreground"), hoverText: tokenHex("--foreground"), clusterLightness: CLUSTER_LIGHTNESS[resolvedMode] },
			fontFamily: getComputedStyle(document.body).fontFamily,
		});
	}, [graph, subjectHues, resolvedMode, colors, noGl, rendererReady]);
	useEffect(() => { rendererRef.current?.setCentreVisible(centre); }, [centre, graph, rendererReady]);
	// Narrow to one subject (its topics and ideas), then frame it.
	useEffect(() => {
		const r = rendererRef.current;
		if (!r || !graph) return;
		r.setVisible(only ? new Set(graph.nodes.filter((n) => n.subjectId === only).map((n) => n.id)) : null);
		if (lastOnly.current !== only) { lastOnly.current = only; r.fit(); } // frame on a filter change, not on every refresh
	}, [only, graph, rendererReady]);

	/** Remove what is selected (an idea, a topic with its files and notes, or a whole subject), after asking. */
	const removeSelected = async () => {
		const m = map;
		if (!m || !selected) return;
		let body: Record<string, unknown> | null = null, what = "";
		const idea = findMapIdea(m, selected);
		const subject = selected.startsWith("subject:") ? m.subjects.find((x) => `subject:${x.id}` === selected) : undefined;
		const topic = !idea && !subject ? m.subjects.flatMap((x) => x.topics.map((t) => ({ t, x }))).find((y) => y.t.id === selected) : undefined;
		if (idea) { body = { action: "remove-idea", subjectId: idea.subject.id, ...(idea.topic ? { topicId: idea.topic.id } : {}), id: idea.idea.id }; what = `the idea “${idea.idea.name}”`; }
		else if (topic) { body = { action: "delete-topic", id: topic.t.id }; what = `the topic “${topic.t.name}” with its files and notes`; }
		else if (subject) { body = { action: "delete-subject", id: subject.id }; what = `the subject “${subject.name}” with all its topics, files and notes`; }
		if (!body || !window.confirm(`Remove ${what}? This cannot be undone.`)) return;
		try {
			const r = await fetch("/api/study/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
			const d = await r.json() as { error?: string };
			if (d.error) { setNotice(d.error); return; }
			setSelected(null); setNotice(""); void load();
		} catch { setNotice("Could not reach the app."); }
	};
	const removeRef = useRef(removeSelected);
	removeRef.current = removeSelected;

	if (noGl) return <SubjectMap />;
	const picked = selected && map ? findMapIdea(map, selected) : undefined;
	// A picked subject or topic: a small card with what it holds and a way in (double-clicking the node opens it too).
	const pickedSubject = selected?.startsWith("subject:") ? map?.subjects.find((s) => `subject:${s.id}` === selected) : undefined;
	const pickedTopic = !picked && !pickedSubject && selected ? map?.subjects.flatMap((s) => s.topics.map((t) => ({ t, s }))).find((x) => x.t.id === selected) : undefined;
	const scopeCard = pickedSubject
		? { title: pickedSubject.name, over: "Subject", line: `${pickedSubject.topics.length} topic${pickedSubject.topics.length === 1 ? "" : "s"} · ${pickedSubject.topics.reduce((n, t) => n + t.ideas.length, pickedSubject.ideas.length)} ideas`, href: pickedSubject.href }
		: pickedTopic ? { title: pickedTopic.t.name, over: pickedTopic.s.name, line: `${pickedTopic.t.ideas.length} idea${pickedTopic.t.ideas.length === 1 ? "" : "s"}${pickedTopic.t.ideas.length ? `: ${pickedTopic.t.ideas.slice(0, 4).map((i) => i.name).join(", ")}${pickedTopic.t.ideas.length > 4 ? "…" : ""}` : ""}`, href: pickedTopic.t.href } : null;
	const empty = map && !map.subjects.length;
	return (
		<div className="absolute inset-0" data-testid="knowledge-3d">
			<div ref={hostRef} className={`absolute inset-0 transition-opacity duration-300 ${transitioning ? "opacity-60" : "opacity-100"}`} />
			{empty && (
				<div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground" data-testid="knowledge-empty">
					<p>Nothing here yet. Start a chat below and pick “New subject”, or add files to a subject: subjects, their topics and key ideas grow here.</p>
				</div>
			)}
			{map && !empty && (
				<>
				<div className="lh-no-drag absolute right-3 top-14 z-10 flex flex-col items-end gap-1">
					<button type="button" aria-pressed={tuningOpen} title="View settings" onClick={() => setTuningOpen((o) => !o)} data-testid="knowledge-tuning-toggle" className={`flex size-9 items-center justify-center rounded-xl border bg-card/85 shadow-lg backdrop-blur transition-colors hover:bg-accent ${tuningOpen ? "text-foreground" : "text-muted-foreground"}`}><SlidersHorizontalIcon className="size-4" /></button>
					{tuningOpen && <div className="absolute right-12 top-0 z-20"><GraphTuningPanel tuning={tuning} onChange={changeTuning} onClose={() => setTuningOpen(false)} /></div>}
					<nav aria-label="Subjects" data-testid="knowledge-subjects" className="mt-2 flex max-h-[55vh] w-52 flex-col gap-0.5 overflow-y-auto rounded-xl border bg-card/85 p-1.5 text-xs shadow-lg backdrop-blur">
						<div className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Subjects</div>
						<button type="button" onClick={() => setOnly("")} aria-pressed={!only} className={`rounded-lg px-2 py-1 text-left transition-colors hover:bg-accent ${!only ? "bg-accent text-foreground" : "text-muted-foreground"}`}>All subjects</button>
						{map.subjects.map((sub) => (
							<div key={sub.id} className={`group flex items-center gap-1 rounded-lg transition-colors hover:bg-accent ${only === sub.id ? "bg-accent" : ""}`}>
								<button type="button" onClick={() => setOnly(only === sub.id ? "" : sub.id)} aria-pressed={only === sub.id} title={`Show only ${sub.name}`} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left">
									<span className="truncate text-foreground">{sub.name}</span>
								</button>
								<SubjectColor subjectId={sub.id} color={sub.color} name={sub.name} onChanged={() => void load()} />
								<button type="button" aria-label={`Open ${sub.name}`} title="Open the subject page" onClick={() => routerRef.current.push(sub.href)} className="mr-1 rounded p-1 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"><ArrowUpRightIcon className="size-3.5" /></button>
							</div>
						))}
					</nav>
				</div>
				{/* Round 5: prominent, labelled view controls in the bottom-right corner. */}
				<div className="lh-no-drag absolute bottom-3 right-3 z-20 flex items-center gap-1 rounded-xl border bg-card/90 p-1.5 shadow-lg backdrop-blur">
					<button
						type="button"
						aria-pressed={centre}
						aria-label={centre ? "Hide the centre" : "Show the centre"}
						title={centre ? "Hide the centre" : "Show the centre"}
						onClick={toggleCentre}
						data-testid="knowledge-centre-toggle"
						className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs transition-colors hover:bg-accent ${centre ? "bg-accent text-foreground" : "text-muted-foreground"}`}
					>
						<OrbitIcon className="size-4" />
						<span>{centre ? "Centre on" : "Centre off"}</span>
					</button>
					<button
						type="button"
						aria-label="Fit everything in view"
						title="Fit everything in view"
						onClick={() => rendererRef.current?.fit()}
						data-testid="knowledge-fit"
						className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs text-foreground transition-colors hover:bg-accent"
					>
						<CrosshairIcon className="size-4" />
						<span>Fit view</span>
					</button>
				</div>
				</>
			)}
			{picked && <div className="lh-no-drag absolute bottom-3 left-3 z-10 flex max-h-[min(26rem,calc(100%-5rem))] w-[380px] max-w-[calc(100%-1.5rem)] flex-col gap-2"><IdeaCard picked={picked} onClose={() => setSelected(null)} /><button type="button" onClick={() => void removeSelected()} data-testid="knowledge-remove" className="inline-flex h-8 w-fit shrink-0 items-center gap-1 rounded-md border bg-card/95 px-3 text-xs text-muted-foreground shadow hover:text-destructive"><Trash2Icon className="size-3.5" />Remove idea</button></div>}
			{notice && <p role="alert" className="lh-no-drag absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-md border bg-card px-3 py-1.5 text-xs text-destructive shadow">{notice}</p>}
			{scopeCard && (
				<div className="lh-no-drag absolute bottom-3 left-3 z-10 flex max-h-[min(20rem,calc(100%-5rem))] w-[380px] max-w-[calc(100%-1.5rem)] flex-col overflow-y-auto rounded-xl border bg-card/95 p-4 text-sm shadow-xl backdrop-blur" data-testid="knowledge-scope-card">
					<div className="mb-1 flex items-start justify-between gap-2">
						<div className="min-w-0"><div className="truncate text-xs text-muted-foreground">{scopeCard.over}</div><div className="mt-0.5 text-base font-medium text-card-foreground">{scopeCard.title}</div></div>
						<button type="button" aria-label="Close details" onClick={() => setSelected(null)} className="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground">×</button>
					</div>
					<p className="mb-3 leading-relaxed text-muted-foreground">{scopeCard.line}</p>
					<div className="flex items-center gap-2">
						<button type="button" onClick={() => routerRef.current.push(scopeCard.href)} className="inline-flex h-8 items-center gap-1 rounded-md border px-3 hover:bg-accent">Open<ArrowUpRightIcon className="size-3.5" /></button>
						<span className="text-xs text-muted-foreground">or double-click the node</span>
					</div>
					<button type="button" onClick={() => void removeSelected()} data-testid="knowledge-remove" className="mt-2 flex items-center gap-1 text-muted-foreground hover:text-destructive"><Trash2Icon className="size-3.5" />Remove {pickedSubject ? "subject" : "topic"}</button>
				</div>
			)}
		</div>
	);
}
