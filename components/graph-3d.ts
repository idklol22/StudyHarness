/**
 * The 3D knowledge TREE renderer (WebGL via three.js) — the home knowledge graph since the Study
 * redesign (owner, 2026-11-18: "everything connected to a central node, expanding trees by topic,
 * with interconnections between nodes").
 *
 * It implements the same surface the view uses on the 2D GraphCanvasRenderer (setData, setSettings,
 * setVisible, fit, destroy and the same callbacks), so search, the groups legend, the settings panel,
 * the detail card and the node context menu work unchanged. The 2D renderer remains the fallback
 * when WebGL is unavailable. Look (Obsidian 3D graph):
 *   - a central node (with a halo), one hub per topic around it, and each topic's ideas branching
 *     outward as a tree; topics fill the sphere around the centre, interconnected topics side by
 *     side (graph-3d-layout.ts); branches are always drawn, in the topic's color;
 *   - nodes are lit spheres in their group's color (the legend's color); ideas are sized by link
 *     count, hubs by their topic's size, the centre largest;
 *   - interconnections (links that are not tree branches) are hidden at rest; hovering or selecting
 *     an idea draws them, thin and plain (no arrowheads);
 *   - the centre and topic hubs are always labelled; idea names fade in as you move closer;
 *   - drag rotates, wheel/pinch zooms, shift-drag pans, right-click is the node menu (as in 2D);
 *   - labels are DOM text over the canvas (crisp, theme-aware, greedy no-overlap placement);
 *   - the loop only runs while something moves: layout settling, camera inertia, tweens, a gentle
 *     idle rotation that stops on any interaction (and never runs with reduced motion). Idle is zero cost.
 * Node dragging and the persisted 2D positions are 2D-only: the 3D layout is derived from them.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CanvasData, GraphRenderSettings, RendererCallbacks } from "./graph-canvas.ts";
import { clusterHue } from "./cluster-geometry.ts";
import { Layout3D, NODE_HUB, NODE_JUNCTION, NODE_ROOT, hash01, hubId, fitDistance, pickNearest3D, placeLabels, type LabelCandidate } from "./graph-3d-layout.ts";

/** The centre node's name. */
const ROOT_LABEL = "Knowledge";

export interface Camera3DState { position: [number, number, number]; target: [number, number, number] }
export interface Graph3DCallbacks extends RendererCallbacks {
	/** Debounced-friendly: fired once a camera gesture ends, with the state to persist. */
	onCamera3D?: (state: Camera3DState) => void;
	/** The GPU context was lost and cannot be used: the caller should fall back to 2D. */
	onUnavailable?: (reason: string) => void;
}

const isImp = (id: string): boolean => id.startsWith("arg_");
const FOV = 50;
const MAX_NODE_LABELS = 70;
/** The idle rotation resumes this long after the last interaction (unless locked). */
const IDLE_RESUME_MS = 3_500;
const RADIUS_PER_SIZE = 2.1; // world units of sphere radius per unit of the nodeSize setting
const HOVER_FADE_MS = 160;

const finite3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));

export class Graph3DRenderer {
	private renderer: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera: THREE.PerspectiveCamera;
	private controls: OrbitControls;
	private layout = new Layout3D();
	private overlay: HTMLDivElement;
	private labelPool: HTMLDivElement[] = [];
	private resizeObserver: ResizeObserver;

	private data: CanvasData | null = null;
	private settings: GraphRenderSettings | null = null;
	private visible: ReadonlySet<string> | null = null;
	private clusterLabelOverride = new Map<string, string | null>();
	private selectedId: string | null = null;

	// Per-data derived state (layout index space).
	private labels: string[] = [];
	private real: number[] = [];           // layout indices of drawable (non-imp) nodes
	private instanceOf: Int32Array = new Int32Array(0);
	private adjacency: number[][] = [];
	private degree: number[] = [];
	private baseColor: THREE.Color[] = [];
	private clusterOf: (string | null)[] = [];
	private edgeIdx: Array<[number, number]> = [];
	/** Per edge: true = a tree branch (always drawn), false = an interconnection (hover only). */
	private edgeTree: boolean[] = [];
	private children: number[][] = [];
	private nodeMesh: THREE.InstancedMesh | null = null;
	private edgeLines: THREE.LineSegments | null = null;
	private ring: THREE.Mesh;
	private screen: Array<{ x: number; y: number; r: number; depth: number; visible: boolean }> = [];
	private nodeVisible: boolean[] = [];

	private hoverIdx = -1;
	private hoverT = 0;
	private hoverTarget = 0;
	private hoverFrom = 0;
	private hoverStarted = 0;
	private focusSet: Set<number> | null = null;

	private raf: number | null = null;
	private lastFrame = 0;
	private geometryDirty = true;
	private screenDirty = true;
	private colorsDirty = true;
	private labelsDirty = true;
	private destroyed = false;
	private userInteracting = false;
	private interacted = false;
	private rotationLocked = false;
	/** Show the Knowledge centre and its spokes (owner: the hive also reads well without it). */
	private showCentre = true;
	private dust: THREE.Points | null = null;
	private resumeTimer: ReturnType<typeof setTimeout> | null = null;
	/** A soft halo around the centre node. */
	private halo: THREE.Mesh;
	private idleSince = performance.now();
	private tween: { start: number; dur: number; fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3 } | null = null;
	private hasInitialCamera = false;
	private refitOnSettle = false;
	private reducedMotion: boolean;
	private fitDist = 400;
	private down: { x: number; y: number; t: number; button: number } | null = null;
	private radiusScale = RADIUS_PER_SIZE * 2;
	private cleanup: Array<() => void> = [];
	private fogRadius = 200;

	constructor(private canvas: HTMLCanvasElement, private callbacks: Graph3DCallbacks, initialCamera?: Camera3DState | null) {
		// Throws when WebGL is unavailable: the view catches this and falls back to 2D.
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
		this.renderer.setClearColor(0x000000, 0);
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

		this.camera = new THREE.PerspectiveCamera(FOV, 1, 1, 50_000);
		this.scene.add(this.camera);
		this.scene.add(new THREE.AmbientLight(0xffffff, 1.5));
		const key = new THREE.DirectionalLight(0xffffff, 2.2);
		key.position.set(0.4, 0.8, 1); // a headlight: attached to the camera so shading follows the view
		this.camera.add(key);

		this.ring = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.75, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false }));
		this.ring.visible = false; this.ring.renderOrder = 10; this.scene.add(this.ring);
		this.halo = new THREE.Mesh(new THREE.RingGeometry(1.45, 1.62, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.45, depthWrite: false }));
		this.halo.visible = false; this.halo.renderOrder = 9; this.scene.add(this.halo);

		this.controls = new OrbitControls(this.camera, canvas);
		this.controls.enableDamping = !this.reducedMotion;
		this.controls.dampingFactor = 0.09;
		this.controls.rotateSpeed = 0.75;
		this.controls.zoomSpeed = 0.9;
		// Knowledge stays the centre (owner, 2026-11-18): orbit and zoom around the current focus, never pan away.
		this.controls.enablePan = false;
		this.controls.minDistance = 12;
		// Right-click opens the node menu (as in 2D), so it must not also pan; shift+left pans.
		this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: -1 as unknown as THREE.MOUSE };
		this.controls.autoRotate = false;
		this.controls.autoRotateSpeed = 0.55;

		if (initialCamera && finite3(initialCamera.position) && finite3(initialCamera.target)) {
			this.camera.position.set(...initialCamera.position); this.controls.target.set(...initialCamera.target); this.hasInitialCamera = true;
		} else this.camera.position.set(140, 90, 360);
		this.controls.update();

		// Label overlay: DOM text positioned over the canvas, never intercepting the pointer.
		this.overlay = document.createElement("div");
		Object.assign(this.overlay.style, { position: "absolute", inset: "0", overflow: "hidden", pointerEvents: "none" });
		this.overlay.setAttribute("aria-hidden", "true");
		canvas.parentElement?.appendChild(this.overlay);

		canvas.tabIndex = 0;
		canvas.setAttribute("role", "application");
		canvas.setAttribute("aria-label", "3D knowledge graph centred on Knowledge. Drag to rotate, scroll to zoom, click an idea to centre on it, arrow keys to rotate, plus and minus to zoom, F to recentre on Knowledge.");

		const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
			el.addEventListener(type, fn as EventListener); this.cleanup.push(() => el.removeEventListener(type, fn as EventListener));
		};
		on(canvas, "pointerdown", (e) => this.onPointerDown(e));
		on(canvas, "pointermove", (e) => this.onPointerMove(e));
		on(canvas, "pointerup", (e) => this.onPointerUp(e));
		on(canvas, "pointerleave", () => this.setHover(-1));
		on(canvas, "contextmenu", (e) => this.onContextMenu(e));
		on(canvas, "keydown", (e) => this.onKey(e));
		on(canvas, "webglcontextlost" as keyof HTMLElementEventMap, ((e: Event) => { e.preventDefault(); this.callbacks.onUnavailable?.("The graphics context was lost."); }) as never);
		const controlsStart = () => { this.userInteracting = true; this.interacted = true; this.tween = null; this.callbacks.onCameraMove({ k: 1, x: 0, y: 0 }); this.kick(); };
		const controlsEnd = () => { this.userInteracting = false; this.idleSince = performance.now(); this.emitCamera(); this.kick(); };
		const controlsChange = () => { this.screenDirty = true; this.labelsDirty = true; this.kick(); };
		this.controls.addEventListener("start", controlsStart);
		this.controls.addEventListener("end", controlsEnd);
		this.controls.addEventListener("change", controlsChange);
		this.cleanup.push(() => { this.controls.removeEventListener("start", controlsStart); this.controls.removeEventListener("end", controlsEnd); this.controls.removeEventListener("change", controlsChange); });
		const onVisibility = () => { if (!document.hidden) this.kick(); };
		document.addEventListener("visibilitychange", onVisibility); this.cleanup.push(() => document.removeEventListener("visibilitychange", onVisibility));

		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(canvas);
		this.resize();
	}

	// ── Public surface (mirrors GraphCanvasRenderer) ─────────────────────────────

	setData(data: CanvasData): void {
		this.data = data;
		const nodeIds = data.nodes.map((n) => n.id);
		const nodeIndex = new Map(nodeIds.map((id, i) => [id, i]));
		// A node belongs to the FIRST group that lists it — the same rule as the 2D view and the legend.
		const firstGroup: (string | null)[] = nodeIds.map(() => null);
		for (const c of data.clusters) for (const m of c.members) { const i = nodeIndex.get(m); if (i !== undefined && firstGroup[i] === null) firstGroup[i] = c.id; }
		this.layout.setGraph(data.nodes.map((n, i) => ({ id: n.id, x: n.x, y: n.y, cluster: firstGroup[i] ?? null })), data.edges);
		// Layout index space: the input nodes first (same order), then the topic hubs, then the centre.
		const L = this.layout, n = L.count, ids = L.ids, index = new Map(ids.map((id, i) => [id, i]));
		this.clusterOf = L.group.slice();
		const clusterLabel = new Map(data.clusters.map((c) => [c.id, c.label]));
		this.labels = ids.map((_, i) => {
			if (i < data.nodes.length) return data.nodes[i]!.label;
			if (L.kind[i] === NODE_ROOT) return ROOT_LABEL;
			const g = L.group[i]!;
			return (this.clusterLabelOverride.has(g) ? this.clusterLabelOverride.get(g) : clusterLabel.get(g)) ?? "Untitled";
		});
		this.real = ids.map((_, i) => (L.kind[i] === NODE_JUNCTION ? -1 : i)).filter((i) => i >= 0);
		this.instanceOf = new Int32Array(n).fill(-1);
		this.real.forEach((li, k) => { this.instanceOf[li] = k; });
		this.adjacency = ids.map(() => []);
		this.children = ids.map(() => []);
		this.degree = ids.map(() => 0);
		this.edgeIdx = []; this.edgeTree = [];
		for (let i = 0; i < n; i++) {
			const p = L.parent[i]!;
			if (p < 0) continue;
			this.children[p]!.push(i);
			this.edgeIdx.push([i, p]); this.edgeTree.push(true);
		}
		for (const e of data.edges) {
			const a = index.get(e.from), b = index.get(e.to);
			if (a === undefined || b === undefined || a === b) continue;
			this.adjacency[a]!.push(b); this.adjacency[b]!.push(a);
			if (L.kind[a] !== NODE_JUNCTION) this.degree[a]!++;
			if (L.kind[b] !== NODE_JUNCTION) this.degree[b]!++;
			// A link that is already a tree branch is drawn once, as the branch.
			if (L.parent[a] === b || L.parent[b] === a) continue;
			this.edgeIdx.push([a, b]); this.edgeTree.push(false);
		}
				this.paletteFor(data);
		this.scene.fog = new THREE.Fog(this.backgroundColor(), 1, 2); // near/far follow the camera each frame
		this.rebuildMeshes();
		this.nodeVisible = ids.map(() => true);
		this.applyVisible();
		this.selectedId = this.selectedId && index.has(this.selectedId) ? this.selectedId : null;
		this.hoverIdx = -1; this.focusSet = null;
		this.geometryDirty = this.screenDirty = this.colorsDirty = this.labelsDirty = true;
		if (this.reducedMotion) this.layout.settle();
		if (!this.hasInitialCamera && !this.interacted && this.layout.count) { this.fitNow(); this.hasInitialCamera = true; this.refitOnSettle = !this.reducedMotion; }
		this.kick();
	}

	setSettings(settings: GraphRenderSettings): void {
		this.settings = settings; this.radiusScale = RADIUS_PER_SIZE * settings.nodeSize;
		this.geometryDirty = this.colorsDirty = this.labelsDirty = true; this.kick();
	}
	// 2D-only knobs, accepted so the view can feed both renderers identically.
	setRegionTuning(_input: unknown): void { /* no hulls in 3D: clusters are colour + label */ }
	setPhysicsTuning(_input: unknown): void { /* the 3D layout has its own fixed tuning */ }

	setClusterLabels(labels: ReadonlyMap<string, string | null>): void {
		for (const [id, label] of labels) {
			this.clusterLabelOverride.set(id, label);
			const hub = this.layout.indexOf(hubId(id));
			if (hub >= 0) this.labels[hub] = label ?? "Untitled";
		}
		this.labelsDirty = true; this.kick();
	}

	setVisible(visible: ReadonlySet<string> | null): void { this.visible = visible; this.applyVisible(); this.geometryDirty = this.screenDirty = this.labelsDirty = true; this.kick(); }

	/** The view's open card, mirrored so the highlight ring follows it. The view only knows ideas: its
	 *  "no card" never clears a hub or centre selection made here. */
	setSelected(id: string | null): void {
		if (id === null && this.selectedId !== null && this.isStructural(this.layout.indexOf(this.selectedId))) return;
		this.applySelected(id);
	}
	private applySelected(id: string | null): void { this.selectedId = id; this.focusFor(); this.colorsDirty = this.geometryDirty = this.labelsDirty = true; this.kick(); }
	private isStructural(i: number): boolean { return i >= 0 && (this.layout.kind[i] === NODE_HUB || this.layout.kind[i] === NODE_ROOT); }

	/** Recenter: glide back to Knowledge and frame the whole graph. */
	fit(): void {
		if (!this.layout.count) return;
		this.interacted = true; this.tweenToFit(); this.kick();
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		if (this.raf !== null) cancelAnimationFrame(this.raf);
		for (const fn of this.cleanup) fn();
		this.resizeObserver.disconnect(); this.controls.dispose();
		this.disposeMeshes();
		this.ring.geometry.dispose(); (this.ring.material as THREE.Material).dispose();
		this.halo.geometry.dispose(); (this.halo.material as THREE.Material).dispose();
		if (this.resumeTimer) clearTimeout(this.resumeTimer);
		this.overlay.remove();
		this.renderer.dispose();
		this.renderer.forceContextLoss();
	}

	// ── Data → meshes ────────────────────────────────────────────────────────────

	private paletteFor(data: CanvasData): void {
		// Ungrouped ideas are the muted label grey; grouped ones take the legend's hsl(hue, 62%, ring%),
		// lifted slightly because Lambert shading darkens a sphere's flanks.
		// The centre is the page's strong text colour.
		const base = new THREE.Color(data.colors.label), centre = new THREE.Color(data.colors.hoverText);
		this.baseColor = this.layout.ids.map((_, i) => {
			if (this.layout.kind[i] === NODE_ROOT) return centre.clone();
			const c = this.clusterOf[i];
			if (c === null || c === undefined) return base.clone();
			const id = this.layout.ids[i] ?? "";
			const isHub = this.layout.kind[i] === NODE_HUB;
			const hue = (clusterHue(c) + (isHub ? 0 : (hash01(id + "h") - 0.5) * 14) + 360) % 360;
			const light = data.colors.clusterLightness.ring / 100 + (isHub ? 0.1 : (hash01(id + "l") - 0.5) * 0.16);
			return new THREE.Color().setHSL(hue / 360, 0.6, Math.min(0.82, Math.max(0.3, light)));
		});
	}

	/** The colour behind the canvas (nearest opaque ancestor), so distant parts fade INTO the page, not into a tint. */
	private backgroundColor(): THREE.Color {
		for (let el: HTMLElement | null = this.canvas; el; el = el.parentElement) {
			const m = getComputedStyle(el).backgroundColor.match(/rgba?(([^)]+))/);
			if (m) { const [r, g, b, a] = m[1]!.split(",").map((v) => parseFloat(v)); if ((a ?? 1) > 0.5) return new THREE.Color(`rgb(${r},${g},${b})`); }
		}
		return new THREE.Color(0x0e1117);
	}

	private disposeMeshes(): void {
		if (this.nodeMesh) { this.scene.remove(this.nodeMesh); this.nodeMesh.geometry.dispose(); (this.nodeMesh.material as THREE.Material).dispose(); this.nodeMesh.dispose(); }
		if (this.edgeLines) { this.scene.remove(this.edgeLines); this.edgeLines.geometry.dispose(); (this.edgeLines.material as THREE.Material).dispose(); }
		if (this.dust) { this.scene.remove(this.dust); this.dust.geometry.dispose(); (this.dust.material as THREE.Material).dispose(); }
		this.nodeMesh = null; this.edgeLines = null; this.dust = null;
	}

	private rebuildMeshes(): void {
		this.disposeMeshes();
		const nodes = this.real.length;
		this.nodeMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(nodes, 1));
		this.nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		this.nodeMesh.count = nodes; this.nodeMesh.frustumCulled = false;
		this.scene.add(this.nodeMesh);
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.edgeIdx.length * 6), 3).setUsage(THREE.DynamicDrawUsage));
		geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.edgeIdx.length * 8), 4).setUsage(THREE.DynamicDrawUsage));
		this.edgeLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
		this.edgeLines.frustumCulled = false; this.edgeLines.renderOrder = -1;
		this.scene.add(this.edgeLines);
		if (this.data) {
			const R = this.layout.radius * 1.7, count = 900, pts = new Float32Array(count * 3);
			for (let i = 0; i < count; i++) {
				// Deterministic specks spread through a sphere (denser toward the middle).
				const u = hash01("du" + i) * 2 - 1, t = hash01("dt" + i) * Math.PI * 2, r = R * Math.pow(hash01("dr" + i), 0.6), q = Math.sqrt(1 - u * u);
				pts[i * 3] = Math.cos(t) * q * r; pts[i * 3 + 1] = u * r; pts[i * 3 + 2] = Math.sin(t) * q * r;
			}
			const g = new THREE.BufferGeometry();
			g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
			this.dust = new THREE.Points(g, new THREE.PointsMaterial({ color: new THREE.Color(this.data.colors.label), size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.22, depthWrite: false }));
			this.dust.frustumCulled = false; this.dust.renderOrder = -3;
			this.scene.add(this.dust);
		}
	}

	/** Lock (or unlock) the idle rotation. Unlocking resumes it after the usual idle pause. */
	/** Show or hide the Knowledge centre and its spokes; the topic balls stay where they are. */
	setCentreVisible(on: boolean): void {
		this.showCentre = on;
		if (!on && this.selectedId !== null && this.layout.kind[this.layout.indexOf(this.selectedId)] === NODE_ROOT) this.applySelected(null);
		this.applyVisible(); this.geometryDirty = this.screenDirty = this.labelsDirty = this.colorsDirty = true; this.kick();
	}

	setRotationLocked(locked: boolean): void {
		this.rotationLocked = locked;
		this.idleSince = performance.now();
		this.kick();
	}

	private applyVisible(): void {
		const n = this.layout.count, ids = this.layout.ids;
		this.nodeVisible = new Array(n).fill(true);
		const centre = this.layout.kind.indexOf(NODE_ROOT);
		if (centre >= 0) this.nodeVisible[centre] = this.showCentre;
		if (!this.visible) return;
		const kind = this.layout.kind;
		const isIdea = (i: number) => kind[i] !== NODE_JUNCTION && kind[i] !== NODE_HUB && kind[i] !== NODE_ROOT;
		for (let i = 0; i < n; i++) if (isIdea(i)) this.nodeVisible[i] = this.visible.has(ids[i]!);
		// A junction is visible when any idea it joins is; a hub when any idea of its topic is; the centre always.
		for (let i = 0; i < n; i++) if (kind[i] === NODE_JUNCTION) this.nodeVisible[i] = this.adjacency[i]!.some((j) => kind[j] !== NODE_JUNCTION && this.nodeVisible[j]);
		const shownGroups = new Set<string>();
		for (let i = 0; i < n; i++) if (isIdea(i) && this.nodeVisible[i] && this.clusterOf[i]) shownGroups.add(this.clusterOf[i]!);
		for (let i = 0; i < n; i++) if (kind[i] === NODE_HUB) this.nodeVisible[i] = shownGroups.has(this.clusterOf[i]!);
		if (this.hoverIdx >= 0 && !this.nodeVisible[this.hoverIdx]) this.setHover(-1);
	}

	// ── Per-frame sync ───────────────────────────────────────────────────────────

	private radiusOf(layoutIdx: number): number {
		const kind = this.layout.kind[layoutIdx];
		if (kind === NODE_ROOT) return this.radiusScale * 3.2;
		if (kind === NODE_HUB) return this.radiusScale * Math.min(2.8, 1.5 + 0.12 * Math.sqrt(this.children[layoutIdx]?.length ?? 0));
		// Ideas are sized by connections: a lone idea is small, well-linked ones grow with sqrt(links), capped at 3×.
		return this.radiusScale * Math.min(3, 0.7 + 0.32 * Math.sqrt(this.degree[layoutIdx] ?? 0));
	}

	private focusFor(): void {
		const focus = this.hoverIdx >= 0 ? this.hoverIdx : this.selectedId ? this.layout.indexOf(this.selectedId) : -1;
		if (focus < 0) { this.focusSet = null; return; }
		const set = new Set<number>([focus]);
		// Its tree parent and children, plus its interconnections (through junctions).
		const parent = this.layout.parent[focus]!;
		if (parent >= 0) set.add(parent);
		for (const c of this.children[focus] ?? []) set.add(c);
		for (const j of this.adjacency[focus]!) {
			if (isImp(this.layout.ids[j]!)) { set.add(j); for (const k of this.adjacency[j]!) set.add(k); } else set.add(j);
		}
		this.focusSet = set;
	}

	private syncGeometry(): void {
		if (!this.nodeMesh || !this.edgeLines || !this.data) return;
		const L = this.layout, pos = L.pos, m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
		const fade = this.hoverT, focus = this.focusSet;
		this.real.forEach((li, k) => {
			const vis = this.nodeVisible[li]!;
			const dim = focus && !focus.has(li) ? 1 : 0;
			const r = vis ? this.radiusOf(li) * (1 + (focus?.has(li) && (li === this.hoverIdx) ? 0.35 * fade : 0)) * (dim ? 1 - 0.28 * Math.max(fade, this.selectedId ? 1 : 0) : 1) : 0;
			m.compose(p.set(pos[li * 3]!, pos[li * 3 + 1]!, pos[li * 3 + 2]!), q.identity(), s.set(r, r, r));
			this.nodeMesh!.setMatrixAt(k, m);
		});
		this.nodeMesh.instanceMatrix.needsUpdate = true;

		// Branches are always drawn in their topic's colour (dimmed while something is focused);
		// interconnections show only for the hovered/selected idea (thin, plain).
		const shown = Math.max(fade, this.selectedId ? 1 : 0);
		const branchAlpha = 0.26 + Math.min(0.3, (this.settings?.edgeWidth ?? 1) * 0.08);
		const posAttr = this.edgeLines.geometry.getAttribute("position") as THREE.BufferAttribute, colAttr = this.edgeLines.geometry.getAttribute("color") as THREE.BufferAttribute;
		const edgeColor = new THREE.Color(this.data.colors.edge), a = new THREE.Vector3(), b = new THREE.Vector3();
		this.edgeIdx.forEach(([from, to], e) => {
			const vis = this.nodeVisible[from]! && this.nodeVisible[to]!;
			a.set(pos[from * 3]!, pos[from * 3 + 1]!, pos[from * 3 + 2]!); b.set(pos[to * 3]!, pos[to * 3 + 1]!, pos[to * 3 + 2]!);
			posAttr.setXYZ(e * 2, a.x, a.y, a.z); posAttr.setXYZ(e * 2 + 1, b.x, b.y, b.z);
			const lit = !!focus && focus.has(from) && focus.has(to);
			if (this.edgeTree[e]) {
				const c = this.baseColor[from] ?? edgeColor;
				// Spokes (centre → topic) and first branches read strongest; deeper twigs fade a little.
				const depthFade = (this.layout.depth[from] ?? 1) >= 3 ? 0.7 : 1;
				const base = branchAlpha * depthFade;
				const branch = !vis ? 0 : lit ? base + (0.9 - base) * shown : this.selectedId ? 0 : base * (focus ? 1 - 0.75 * shown : 1);
				colAttr.setXYZW(e * 2, c.r, c.g, c.b, branch); colAttr.setXYZW(e * 2 + 1, c.r, c.g, c.b, branch);
				return;
			}
			const alpha = vis && lit ? 0.85 * shown : 0;
			colAttr.setXYZW(e * 2, edgeColor.r, edgeColor.g, edgeColor.b, alpha); colAttr.setXYZW(e * 2 + 1, edgeColor.r, edgeColor.g, edgeColor.b, alpha);
		});
		posAttr.needsUpdate = true; colAttr.needsUpdate = true;
		this.updateRing();
	}

	private syncColors(): void {
		if (!this.nodeMesh || !this.data) return;
		const focus = this.focusSet, c = new THREE.Color(), hsl = { h: 0, s: 0, l: 0 };
		const strength = Math.max(this.hoverT, this.selectedId ? 1 : 0);
		this.real.forEach((li, k) => {
			c.copy(this.baseColor[li]!);
			if (focus && !focus.has(li)) {
				// A selection fades everything else far more than a passing hover.
				const fadeL = this.selectedId ? 0.6 : 0.18;
				c.getHSL(hsl); c.setHSL(hsl.h, hsl.s * (1 - 0.85 * strength), hsl.l * (1 - fadeL * strength));
			}
			this.nodeMesh!.setColorAt(k, c);
		});
		if (this.nodeMesh.instanceColor) this.nodeMesh.instanceColor.needsUpdate = true;
		this.ring.material instanceof THREE.MeshBasicMaterial && this.ring.material.color.set(this.data.colors.hoverText);
		this.halo.material instanceof THREE.MeshBasicMaterial && this.halo.material.color.set(this.data.colors.hoverText);
	}

	private updateRing(): void {
		// The centre's halo always faces the camera.
		const root = this.layout.kind.indexOf(NODE_ROOT);
		this.halo.visible = root >= 0 && this.showCentre;
		if (root >= 0) {
			this.halo.position.set(this.layout.pos[root * 3]!, this.layout.pos[root * 3 + 1]!, this.layout.pos[root * 3 + 2]!);
			this.halo.scale.setScalar(this.radiusOf(root)); this.halo.quaternion.copy(this.camera.quaternion);
		}
		const i = this.selectedId ? this.layout.indexOf(this.selectedId) : -1;
		if (i < 0 || !this.nodeVisible[i]) { this.ring.visible = false; return; }
		this.ring.visible = true;
		const r = this.radiusOf(i);
		this.ring.position.set(this.layout.pos[i * 3]!, this.layout.pos[i * 3 + 1]!, this.layout.pos[i * 3 + 2]!);
		this.ring.scale.setScalar(r); this.ring.quaternion.copy(this.camera.quaternion);
	}

	private syncScreen(): void {
		const rect = this.canvas.getBoundingClientRect(), w = rect.width, h = rect.height;
		const v = new THREE.Vector3(), pxPerWorld = (h / 2) / Math.tan((FOV * Math.PI) / 360);
		this.camera.updateMatrixWorld();
		this.screen = this.real.map((li) => {
			v.set(this.layout.pos[li * 3]!, this.layout.pos[li * 3 + 1]!, this.layout.pos[li * 3 + 2]!);
			const dist = v.distanceTo(this.camera.position);
			v.project(this.camera);
			const inView = v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05;
			return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, r: (this.radiusOf(li) * pxPerWorld) / Math.max(dist, 1), depth: dist, visible: inView && this.nodeVisible[li]! };
		});
	}

	private syncLabels(): void {
		const rect = this.canvas.getBoundingClientRect();
		const font = this.data?.fontFamily ?? "system-ui, sans-serif", color = this.data?.colors.label ?? "#888", strong = this.data?.colors.hoverText ?? "#fff";
		const target = this.controls.target, camDist = this.camera.position.distanceTo(target);
		// 1 at fit, larger when zoomed in. The shared "labels once zoomed" setting (default 0.5) shifts how early they appear.
		const zoomIn = (this.fitDist / Math.max(camDist, 1)) * (0.5 / Math.max(this.settings?.labelZoom ?? 0.5, 0.05));
		const labelPx = Math.max(10, Math.min(15, 11 + (this.settings?.labelSize ?? 3) * 0.4));
		const cands: LabelCandidate[] = [], must = new Set<number>();
		if (this.hoverIdx >= 0) must.add(this.hoverIdx);
		const sel = this.selectedId ? this.layout.indexOf(this.selectedId) : -1; if (sel >= 0) must.add(sel);
		if (this.focusSet) for (const i of this.focusSet) if (!isImp(this.layout.ids[i]!)) must.add(i);
		// The centre and every topic hub are always named: they are the tree's structure.
		const structural = new Set<number>();
		for (const li of this.real) if (this.layout.kind[li] === NODE_HUB || this.layout.kind[li] === NODE_ROOT) { must.add(li); structural.add(li); }
		const order = this.real.map((li, k) => ({ li, k })).filter(({ k }) => this.screen[k]?.visible).sort((a, b) => this.screen[a.k]!.depth - this.screen[b.k]!.depth);
		// A handful of the nearest names at fit; the rest fade in as you move closer (Obsidian-style).
		const baseCount = Math.round(8 + (MAX_NODE_LABELS - 8) * Math.min(1, Math.max(0, (zoomIn - 1) / 1.3)));
		let near = 0;
		for (const { li, k } of order) {
			const forced = must.has(li); const s = this.screen[k]!;
			if (!forced && near >= baseCount) continue;
			const text = this.labels[li] ?? ""; if (!text) continue;
			if (!forced) near++;
			const wpx = Math.min(180, text.length * labelPx * 0.56 + 8);
			cands.push({ id: String(li), x: s.x, y: s.y + s.r + 4 + labelPx / 2, w: wpx, h: labelPx + 3, priority: forced ? 1e6 - s.depth : 1000 - s.depth * 0.5 });
		}
		const placed = placeLabels(cands, MAX_NODE_LABELS + must.size);
		this.fillPool(this.labelPool, placed.length);
		placed.forEach((p, i) => {
			const el = this.labelPool[i]!, li = Number(p.id), forced = must.has(li), hub = structural.has(li);
			const g = this.clusterOf[li];
			el.textContent = this.labels[li] ?? "";
			Object.assign(el.style, { display: "block", left: `${p.x}px`, top: `${p.y - (labelPx + 3) / 2}px`, maxWidth: hub ? "220px" : "180px", fontFamily: font, fontSize: `${hub ? labelPx + 2 : labelPx}px`, fontWeight: forced ? "600" : "500",
				color: hub && g && this.data ? `hsl(${clusterHue(g)} 62% ${this.data.colors.clusterLightness.label}%)` : forced ? strong : color,
				opacity: forced ? "1" : String(Math.min(0.92, 0.5 + 0.5 * Math.min(1, 1.4 / Math.max(this.screen[this.instanceOf[li]!]?.depth ?? 1, 1) * this.fitDist * 0.5))) });
		});
		void rect;
	}

	private fillPool(pool: HTMLDivElement[], used: number): void {
		while (pool.length < used) {
			const el = document.createElement("div");
			Object.assign(el.style, { position: "absolute", transform: "translateX(-50%)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center", pointerEvents: "none", userSelect: "none", lineHeight: "1.25", textShadow: "0 0 3px var(--background, #000), 0 0 3px var(--background, #000), 0 0 6px var(--background, #000)" });
			this.overlay.appendChild(el); pool.push(el);
		}
		pool.forEach((el, i) => { if (i >= used) el.style.display = "none"; });
	}

	// ── Camera ───────────────────────────────────────────────────────────────────

	private fitTarget(): { pos: THREE.Vector3; target: THREE.Vector3; dist: number } {
		// Knowledge (the origin) is the centre; with the centre hidden, the middle of what is visible is.
		const shown = this.real.filter((li) => this.nodeVisible[li]);
		const b = this.showCentre ? null : this.layout.bounds(shown.length ? shown : undefined);
		const target = b ? new THREE.Vector3(b.cx, b.cy, b.cz) : new THREE.Vector3(0, 0, 0);
		let radius = 40;
		for (const li of shown) radius = Math.max(radius, Math.hypot(this.layout.pos[li * 3]! - target.x, this.layout.pos[li * 3 + 1]! - target.y, this.layout.pos[li * 3 + 2]! - target.z));
		this.fogRadius = radius;
		const rect = this.canvas.getBoundingClientRect();
		const dist = fitDistance(radius, FOV, rect.width / Math.max(rect.height, 1), 0.92);
		const dir = this.camera.position.clone().sub(this.controls.target); if (dir.lengthSq() < 1e-6) dir.set(0.35, 0.25, 1);
		return { pos: target.clone().add(dir.normalize().multiplyScalar(dist)), target, dist };
	}
	private fitNow(): void {
		const f = this.fitTarget(); this.fitDist = f.dist;
		this.camera.position.copy(f.pos); this.controls.target.copy(f.target); this.controls.maxDistance = f.dist * 5; this.controls.update();
	}
	private tweenToFit(): void {
		const f = this.fitTarget(); this.fitDist = f.dist; this.controls.maxDistance = f.dist * 5;
		if (this.reducedMotion) { this.camera.position.copy(f.pos); this.controls.target.copy(f.target); this.controls.update(); this.emitCamera(); return; }
		this.tween = { start: performance.now(), dur: 650, fromPos: this.camera.position.clone(), toPos: f.pos, fromTarget: this.controls.target.clone(), toTarget: f.target };
	}
	/** Glide the orbit centre onto one node (keeping the viewing direction), a little closer in. */
	private centreOn(i: number): void {
		const target = new THREE.Vector3(this.layout.pos[i * 3]!, this.layout.pos[i * 3 + 1]!, this.layout.pos[i * 3 + 2]!);
		const offset = this.camera.position.clone().sub(this.controls.target);
		const dist = Math.min(offset.length(), this.fitDist * 0.62);
		if (offset.lengthSq() < 1e-6) offset.set(0.35, 0.25, 1);
		const pos = target.clone().add(offset.normalize().multiplyScalar(dist));
		this.interacted = true;
		if (this.reducedMotion) { this.camera.position.copy(pos); this.controls.target.copy(target); this.controls.update(); this.emitCamera(); return; }
		this.tween = { start: performance.now(), dur: 650, fromPos: this.camera.position.clone(), toPos: pos, fromTarget: this.controls.target.clone(), toTarget: target };
	}
	private emitCamera(): void {
		const p = this.camera.position, t = this.controls.target;
		this.callbacks.onCamera3D?.({ position: [p.x, p.y, p.z], target: [t.x, t.y, t.z] });
	}

	private resize(): void {
		const rect = this.canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		this.renderer.setSize(rect.width, rect.height, false);
		this.camera.aspect = rect.width / rect.height; this.camera.updateProjectionMatrix();
		this.screenDirty = this.labelsDirty = true; this.kick();
	}

	// ── Pointer / keyboard ───────────────────────────────────────────────────────

	private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
		const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top };
	}
	private pick(x: number, y: number): number {
		if (this.screenDirty) { this.syncScreen(); this.screenDirty = false; }
		const k = pickNearest3D(this.screen, x, y);
		return k < 0 ? -1 : this.real[k]!;
	}
	private setHover(layoutIdx: number): void {
		if (layoutIdx === this.hoverIdx) return;
		this.hoverFrom = this.hoverT; this.hoverIdx = layoutIdx; this.hoverTarget = layoutIdx >= 0 ? 1 : 0; this.hoverStarted = performance.now();
		this.focusFor(); this.canvas.style.cursor = layoutIdx >= 0 ? "pointer" : "grab";
		this.colorsDirty = this.geometryDirty = this.labelsDirty = true; this.kick();
	}
	private onPointerDown(e: PointerEvent): void {
		this.down = { ...this.local(e), t: performance.now(), button: e.button }; this.interacted = true; this.canvas.focus({ preventScroll: true });
	}
	private onPointerMove(e: PointerEvent): void {
		if (this.down || e.buttons) return;
		const { x, y } = this.local(e); this.setHover(this.pick(x, y)); this.idleSince = performance.now(); this.interacted = true;
	}
	private onPointerUp(e: PointerEvent): void {
		const d = this.down; this.down = null; if (!d || d.button !== 0) return;
		const { x, y } = this.local(e);
		if (Math.hypot(x - d.x, y - d.y) > 5 || performance.now() - d.t > 600) return; // a drag, not a click
		const i = this.pick(x, y);
		// Clicking empty space clears the selection but leaves the camera where it is (Recenter goes home).
		if (i < 0) { this.callbacks.onStageClick(); this.applySelected(null); return; }
		this.applySelected(this.layout.ids[i]!);
		this.centreOn(i);
		// The centre and topic hubs are structure, not ideas: they focus their branch but open no card.
		if (this.layout.kind[i] === NODE_HUB || this.layout.kind[i] === NODE_ROOT) { this.callbacks.onStageClick(); return; }
		// The card anchors where the idea is gliding to: the middle of the view.
		const k = this.instanceOf[i]!, s = this.screen[k], rect = this.canvas.getBoundingClientRect();
		this.callbacks.onSelect(this.selectedId!, { x: rect.width / 2, y: rect.height / 2 + (s?.r ?? 8) });
	}
	private onContextMenu(e: MouseEvent): void {
		e.preventDefault();
		const { x, y } = this.local(e), i = this.pick(x, y);
		const idea = i >= 0 && this.layout.kind[i] !== NODE_HUB && this.layout.kind[i] !== NODE_ROOT;
		this.callbacks.onContext(idea ? this.layout.ids[i]! : null, { x, y });
	}
	private onKey(e: KeyboardEvent): void {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const step = 0.12, off = this.camera.position.clone().sub(this.controls.target), sph = new THREE.Spherical().setFromVector3(off);
		let handled = true;
		switch (e.key) {
			case "ArrowLeft": sph.theta -= step; break;
			case "ArrowRight": sph.theta += step; break;
			case "ArrowUp": sph.phi = Math.max(0.1, sph.phi - step); break;
			case "ArrowDown": sph.phi = Math.min(Math.PI - 0.1, sph.phi + step); break;
			case "+": case "=": sph.radius = Math.max(this.controls.minDistance, sph.radius * 0.85); break;
			case "-": case "_": sph.radius = Math.min(this.controls.maxDistance, sph.radius * 1.18); break;
			case "f": case "F": case "Home": this.fit(); e.preventDefault(); return;
			case "Escape": if (this.selectedId) { this.callbacks.onStageClick(); this.applySelected(null); } return;
			default: handled = false;
		}
		if (!handled) return;
		e.preventDefault(); this.interacted = true; this.tween = null;
		this.callbacks.onCameraMove({ k: 1, x: 0, y: 0 });
		this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(sph)); this.controls.update(); this.emitCamera(); this.kick();
	}

	// ── Loop ─────────────────────────────────────────────────────────────────────

	private kick(): void { if (this.raf === null && !this.destroyed) this.raf = requestAnimationFrame((t) => this.frame(t)); }

	private frame(now: number): void {
		this.raf = null; if (this.destroyed) return;
		if (document.hidden) return; // resumes on visibilitychange
		let again = false;

		const layoutMoving = this.layout.tick(this.layout.count > 400 ? 2 : 3);
		if (layoutMoving) { this.geometryDirty = this.screenDirty = this.labelsDirty = true; again = true; }
		// The first framing happened before the layout relaxed; frame the settled graph (unless the user has taken the camera).
		if (!layoutMoving && this.refitOnSettle) { this.refitOnSettle = false; if (!this.interacted && this.layout.count) { this.tweenToFit(); again = true; } }

		if (this.tween) {
			const t = Math.min(1, (now - this.tween.start) / this.tween.dur), e = 1 - Math.pow(1 - t, 3);
			this.camera.position.lerpVectors(this.tween.fromPos, this.tween.toPos, e); this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, e);
			this.controls.update(); this.screenDirty = this.labelsDirty = true; again = true;
			if (t >= 1) { this.tween = null; this.emitCamera(); }
		}

		if (this.hoverT !== this.hoverTarget) {
			const t = Math.min(1, (now - this.hoverStarted) / HOVER_FADE_MS);
			this.hoverT = this.reducedMotion ? this.hoverTarget : this.hoverFrom + (this.hoverTarget - this.hoverFrom) * t;
			this.colorsDirty = this.geometryDirty = true; if (t < 1) again = true; else this.hoverT = this.hoverTarget;
		}

		// A gentle idle rotation: unless locked, while nothing is selected or hovered and nothing is being dragged; it
		// resumes a few seconds after the last interaction. Never with reduced motion.
		const canRotate = !this.rotationLocked && !this.selectedId && this.hoverIdx < 0 && !this.reducedMotion && !this.userInteracting && !this.tween;
		const idle = canRotate && now - this.idleSince > IDLE_RESUME_MS;
		if (canRotate && !idle && !this.resumeTimer) {
			this.resumeTimer = setTimeout(() => { this.resumeTimer = null; this.kick(); }, Math.max(50, IDLE_RESUME_MS - (now - this.idleSince) + 20));
		}
		this.controls.autoRotate = idle;
		if (idle && now - this.lastFrame < 30) { this.kick(); return; } // ~30 fps while only rotating
		this.lastFrame = now;
		if (this.controls.update()) again = true; // damping inertia / autorotate
		if (idle || this.userInteracting) again = true;

		if (this.colorsDirty) { this.syncColors(); this.colorsDirty = false; }
		if (this.geometryDirty) { this.syncGeometry(); this.geometryDirty = false; }
		if (this.screenDirty) { this.syncScreen(); this.screenDirty = false; this.labelsDirty = true; }
		this.updateRing();
		if (this.scene.fog instanceof THREE.Fog) {
			const d = this.camera.position.distanceTo(this.controls.target), R = this.fogRadius;
			this.scene.fog.near = Math.max(1, d - R * 0.5); this.scene.fog.far = d + R * 1.9;
		}
		this.renderer.render(this.scene, this.camera);
		if (this.labelsDirty) { this.syncLabels(); this.labelsDirty = false; }
		if (again) this.kick();
	}
}
