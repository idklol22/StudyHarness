"use client";

/**
 * The one knowledge graph on Home (owner 2026-11-19): a 3D globe. The centre ("Knowledge", can be hidden) spokes to
 * every subject; subjects span out their topics, topics their ideas; related subjects (field, shared ideas) sit near
 * each other. Click a subject or topic to open its page, an idea to see its files and chats. Drag to rotate, scroll
 * to zoom. Without WebGL it falls back to the flat map.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CrosshairIcon, OrbitIcon } from "lucide-react";
import { useServerEvent } from "@/components/server-events";
import { useAppearance } from "@/components/settings/appearance";
import { CLUSTER_LIGHTNESS } from "@/components/graph-canvas";
import { Graph3DRenderer } from "@/components/graph-3d";
import { tokenHex } from "@/components/graph-view";
import { DEFAULT_RENDER_SETTINGS, findMapIdea, knowledgeGraph, type StudyMap } from "@/src/core";
import { IdeaCard } from "./idea-card";
import { SubjectMap } from "./subject-map";

const CENTRE_KEY = "lh.knowledge.centre.v1";
const CAMERA_KEY = "lh.knowledge.camera3d.v1";

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

	const graph = useMemo(() => (map ? knowledgeGraph(map) : null), [map]);

	// Each renderer gets its OWN canvas: destroying a renderer kills its canvas's graphics context, so reusing the
	// element (React mounts effects twice in development) would leave the next renderer with a dead context.
	useEffect(() => {
		const host = hostRef.current;
		if (!host || noGl) return;
		const canvas = document.createElement("canvas");
		canvas.className = "absolute inset-0 block h-full w-full touch-none outline-none";
		host.appendChild(canvas);
		let camera = null;
		try { const raw = localStorage.getItem(CAMERA_KEY); if (raw) camera = JSON.parse(raw); } catch { /* frame itself */ }
		let timer: ReturnType<typeof setTimeout> | null = null;
		let renderer: Graph3DRenderer;
		try {
			renderer = new Graph3DRenderer(canvas, {
				onSelect: (nodeId) => {
					const m = mapRef.current;
					if (!m) return;
					const idea = findMapIdea(m, nodeId);
					if (idea) { setSelected(nodeId); return; }
					const topic = m.subjects.flatMap((s) => s.topics).find((t) => t.id === nodeId);
					if (topic) { routerRef.current.push(topic.href); return; }
					const stub = m.subjects.find((s) => `${s.id}:empty` === nodeId);
					if (stub) routerRef.current.push(stub.href);
				},
				onHub: (subjectId) => routerRef.current.push(`/subjects/${subjectId}`),
				onContext: () => {},
				onStageClick: () => setSelected(null),
				onCameraMove: () => {},
				onCommit: () => {},
				onCamera3D: (state) => { if (timer) clearTimeout(timer); timer = setTimeout(() => { try { localStorage.setItem(CAMERA_KEY, JSON.stringify(state)); } catch { /* best-effort */ } }, 250); },
				onUnavailable: (reason) => setNoGl(reason),
			}, camera);
		} catch (error) { canvas.remove(); setNoGl(error instanceof Error ? error.message : "WebGL is not available"); return; }
		rendererRef.current = renderer;
		renderer.setSettings(DEFAULT_RENDER_SETTINGS);
		return () => { if (timer) clearTimeout(timer); rendererRef.current = null; renderer.destroy(); canvas.remove(); };
	}, [noGl]);

	useEffect(() => {
		const r = rendererRef.current;
		if (!r || !graph || !graph.nodes.length) return;
		r.setData({
			nodes: graph.nodes.map((n) => ({ id: n.id, x: 0, y: 0, label: n.label })),
			edges: graph.edges,
			clusters: graph.clusters,
			parents: graph.parents,
			anchors: graph.anchors,
			colors: { node: tokenHex("--primary"), edge: tokenHex("--muted-foreground"), label: tokenHex("--muted-foreground"), hoverText: tokenHex("--foreground"), clusterLightness: CLUSTER_LIGHTNESS[resolvedMode] },
			fontFamily: getComputedStyle(document.body).fontFamily,
		});
	}, [graph, resolvedMode, colors, noGl]);
	useEffect(() => { rendererRef.current?.setCentreVisible(centre); }, [centre, graph]);

	if (noGl) return <SubjectMap />;
	const picked = selected && map ? findMapIdea(map, selected) : undefined;
	const empty = map && !map.subjects.length;
	return (
		<div className="absolute inset-0" data-testid="knowledge-3d">
			<div ref={hostRef} className="absolute inset-0" />
			{empty && (
				<div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground" data-testid="knowledge-empty">
					<p>Nothing here yet. Start a chat below and pick “New subject”, or add files to a subject: subjects, their topics and key ideas grow here.</p>
				</div>
			)}
			{!empty && (
				<div className="lh-no-drag absolute right-3 top-14 z-10 flex flex-col gap-1">
					<button type="button" aria-pressed={centre} title={centre ? "Hide the centre" : "Show the centre"} onClick={() => { const next = !centre; setCentre(next); try { localStorage.setItem(CENTRE_KEY, next ? "on" : "off"); } catch { /* best-effort */ } }} data-testid="knowledge-centre-toggle" className={`flex size-9 items-center justify-center rounded-xl border bg-card/85 shadow-lg backdrop-blur transition-colors hover:bg-accent ${centre ? "text-foreground" : "text-muted-foreground"}`}><OrbitIcon className="size-4" /></button>
					<button type="button" title="Fit everything in view" onClick={() => rendererRef.current?.fit()} className="flex size-9 items-center justify-center rounded-xl border bg-card/85 text-muted-foreground shadow-lg backdrop-blur transition-colors hover:bg-accent hover:text-foreground"><CrosshairIcon className="size-4" /></button>
				</div>
			)}
			{picked && <div className="lh-no-drag absolute bottom-24 left-3 z-10 w-80 max-w-[calc(100%-1.5rem)]"><IdeaCard picked={picked} onClose={() => setSelected(null)} /></div>}
		</div>
	);
}
