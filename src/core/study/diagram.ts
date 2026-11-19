/**
 * Diagrams for the class notes: flowcharts and mind maps. The agent supplies the CONTENT (nodes, arrows, branches);
 * code draws it, so a diagram is always legible and never overlaps. Pure: same diagram and width in, same shapes out.
 */

export interface FlowNode { id: string; text: string; /** "decision" is drawn as a diamond. */ shape?: "box" | "decision" }
export interface FlowEdge { from: string; to: string; label?: string }
export type Diagram =
	| { kind: "flow"; nodes: FlowNode[]; edges: FlowEdge[] }
	| { kind: "mind"; center: string; branches: Array<{ text: string; children?: string[] }> };

export type DiagramBoxShape = "box" | "decision" | "center" | "branch" | "leaf";
export interface DiagramBox { x: number; y: number; w: number; h: number; lines: string[]; shape: DiagramBoxShape; /** Colour slot 0-5 (mind-map branches). */ tone: number }
export interface DiagramArrow { points: Array<[number, number]>; label?: string; lx?: number; ly?: number; arrow: boolean }
export interface DiagramShapes { w: number; h: number; boxes: DiagramBox[]; arrows: DiagramArrow[] }

const clean = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Validate and bound an agent-supplied diagram. Throws with a message the agent can act on. */
export function cleanDiagram(raw: unknown): Diagram {
	const d = raw as Partial<Diagram> & { nodes?: unknown; edges?: unknown; branches?: unknown; center?: unknown };
	if (d?.kind === "flow") {
		const nodes = (Array.isArray(d.nodes) ? d.nodes : []).slice(0, 14).map((n: FlowNode, i) => ({ id: clean(n?.id, 20) || `n${i + 1}`, text: clean(n?.text, 70), ...(n?.shape === "decision" ? { shape: "decision" as const } : {}) })).filter((n) => n.text);
		if (nodes.length < 2) throw new Error("A flowchart needs at least two nodes (each with an id and text).");
		const ids = new Set(nodes.map((n) => n.id));
		if (ids.size !== nodes.length) throw new Error("Flowchart node ids must be unique.");
		const edges = (Array.isArray(d.edges) ? d.edges : []).slice(0, 24).map((e: FlowEdge) => ({ from: clean(e?.from, 20), to: clean(e?.to, 20), ...(clean(e?.label, 24) ? { label: clean(e?.label, 24) } : {}) })).filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
		if (!edges.length) throw new Error("A flowchart needs edges between the node ids (from → to).");
		return { kind: "flow", nodes, edges };
	}
	if (d?.kind === "mind") {
		const center = clean(d.center, 50);
		const branches = (Array.isArray(d.branches) ? d.branches : []).slice(0, 6).map((b: { text: string; children?: string[] }) => ({ text: clean(b?.text, 40), children: (Array.isArray(b?.children) ? b.children : []).slice(0, 3).map((c) => clean(c, 40)).filter(Boolean) })).filter((b) => b.text);
		if (!center || branches.length < 2) throw new Error("A mind map needs a centre and at least two branches.");
		return { kind: "mind", center, branches };
	}
	throw new Error('A diagram needs kind "flow" or "mind".');
}

/** Word-wrap into at most `maxLines` lines of about `perLine` characters (the last line is cut with …). */
export function wrapText(text: string, perLine: number, maxLines = 3): string[] {
	const words = text.split(" ");
	const out: string[] = [];
	let line = "";
	for (const w of words) {
		if (line && (line + " " + w).length > perLine) { out.push(line); line = w; } else line = line ? line + " " + w : w;
	}
	if (line) out.push(line);
	if (out.length > maxLines) { const kept = out.slice(0, maxLines); kept[maxLines - 1] = kept[maxLines - 1]!.slice(0, Math.max(1, perLine - 1)) + "…"; return kept; }
	return out;
}

// ── flowchart ────────────────────────────────────────────────────────────────────────────────────────────────────
// Owner: sequential charts were fine, but with more nodes they "club things on the same plane". So: at most three
// boxes per row (a wide layer wraps onto extra rows), boxes sized to their text, and every arrow routed only through
// the gaps between rows and the side gutters, never across a box.
const PER_ROW = 3;
const GUTTER = 22;
const ROW_GAP = 48;
const COL_GAP = 20;
const TOP = 22;
const LINE = 16;

function flowRows(d: Extract<Diagram, { kind: "flow" }>): FlowNode[][] {
	// Layers by longest path from the sources; an edge that would close a loop does not add a layer.
	const state = new Map<string, 1 | 2>();
	const dag: FlowEdge[] = [];
	const visit = (id: string) => {
		state.set(id, 1);
		for (const e of d.edges) {
			if (e.from !== id) continue;
			const seen = state.get(e.to);
			if (seen === 1) continue;
			dag.push(e);
			if (!seen) visit(e.to);
		}
		state.set(id, 2);
	};
	for (const n of d.nodes) if (!state.has(n.id)) visit(n.id);
	const layer = new Map<string, number>(d.nodes.map((n) => [n.id, 0]));
	for (let pass = 0; pass < d.nodes.length; pass++) {
		let changed = false;
		for (const e of dag) { const next = layer.get(e.from)! + 1; if (next > layer.get(e.to)!) { layer.set(e.to, next); changed = true; } }
		if (!changed) break;
	}
	const layers: FlowNode[][] = [];
	for (const n of d.nodes) (layers[layer.get(n.id)!] ??= []).push(n);
	const rows: FlowNode[][] = [];
	for (const l of layers.filter(Boolean)) for (let i = 0; i < l.length; i += PER_ROW) rows.push(l.slice(i, i + PER_ROW));
	return rows;
}

function drawFlow(d: Extract<Diagram, { kind: "flow" }>, width: number): DiagramShapes {
	const rows = flowRows(d);
	const inner = width - GUTTER * 2;
	const boxes: DiagramBox[] = [];
	const pos = new Map<string, { box: DiagramBox; row: number }>();
	const rowTop: number[] = [], rowBottom: number[] = [];
	let y = TOP;
	rows.forEach((row, r) => {
		const w = Math.max(110, Math.min(200, Math.floor((inner - (row.length - 1) * COL_GAP) / row.length)));
		const total = row.length * w + (row.length - 1) * COL_GAP;
		const sized = row.map((n) => {
			const decision = n.shape === "decision";
			const lines = wrapText(n.text, Math.max(8, Math.floor((decision ? w * 0.62 : w - 16) / 7)), 4);
			return { n, lines, h: Math.max(decision ? 64 : 44, lines.length * LINE + (decision ? 34 : 18)) };
		});
		const h = Math.max(...sized.map((s) => s.h));
		sized.forEach((s, i) => {
			const box: DiagramBox = { x: GUTTER + (inner - total) / 2 + i * (w + COL_GAP), y: y + (h - s.h) / 2, w, h: s.h, lines: s.lines, shape: s.n.shape === "decision" ? "decision" : "box", tone: 0 };
			boxes.push(box);
			pos.set(s.n.id, { box, row: r });
		});
		rowTop.push(y); rowBottom.push(y + h);
		y += h + ROW_GAP;
	});
	const height = y - ROW_GAP + TOP;
	// Lanes keep parallel arrows in one gap apart (and their labels).
	const lanes = new Map<number, number>();
	const laneY = (gapBelowRow: number) => {
		const used = lanes.get(gapBelowRow) ?? 0;
		lanes.set(gapBelowRow, used + 1);
		const top = gapBelowRow < 0 ? 0 : rowBottom[gapBelowRow]!;
		const room = gapBelowRow < 0 ? TOP : ROW_GAP;
		return top + Math.min(room - 6, 12 + (used % 4) * 8);
	};
	const cx = (b: DiagramBox) => b.x + b.w / 2;
	const arrows: DiagramArrow[] = d.edges.map((e) => {
		const a = pos.get(e.from)!, b = pos.get(e.to)!;
		let points: Array<[number, number]>;
		if (b.row === a.row + 1) {
			// Next row: down into the gap, across, down into the target.
			const ly = laneY(a.row);
			points = [[cx(a.box), a.box.y + a.box.h], [cx(a.box), ly], [cx(b.box), ly], [cx(b.box), b.box.y]];
		} else if (b.row === a.row) {
			// Same row: below both boxes, then up into the target.
			const ly = laneY(a.row);
			points = [[cx(a.box), a.box.y + a.box.h], [cx(a.box), ly], [cx(b.box), ly], [cx(b.box), b.box.y + b.box.h]];
		} else {
			// Skipping rows (down: right gutter) or looping back (up: left gutter); across only in gaps.
			const down = b.row > a.row;
			const gx = down ? width - GUTTER / 2 : GUTTER / 2;
			const out = laneY(a.row);
			const into = laneY(b.row - 1);
			points = [[cx(a.box), a.box.y + a.box.h], [cx(a.box), out], [gx, out], [gx, into], [cx(b.box), into], [cx(b.box), b.box.y]];
		}
		const [p, q] = [points[1]!, points[2]!];
		return { points, arrow: true, ...(e.label ? { label: e.label, lx: (p[0] + q[0]) / 2 + 4, ly: p[1] - 3 } : {}) };
	});
	return { w: width, h: height, boxes, arrows };
}

// ── mind map ─────────────────────────────────────────────────────────────────────────────────────────────────────
const overlaps = (a: DiagramBox, b: DiagramBox, gap = 6) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** Where the line from a box's centre toward (tx, ty) leaves the box. */
function edgePoint(b: DiagramBox, tx: number, ty: number): [number, number] {
	const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
	const dx = tx - cx, dy = ty - cy;
	if (!dx && !dy) return [cx, cy];
	const s = Math.min(dx ? (b.w / 2) / Math.abs(dx) : Infinity, dy ? (b.h / 2) / Math.abs(dy) : Infinity);
	return [cx + dx * s, cy + dy * s];
}

function drawMind(d: Extract<Diagram, { kind: "mind" }>, width: number): DiagramShapes {
	const H0 = 380;
	const cx = width / 2, cy = H0 / 2;
	const cw = 124, ch = 58;
	const center: DiagramBox = { x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch, lines: wrapText(d.center, 16, 3), shape: "center", tone: 0 };
	const rx = width / 2 - 70, ry = H0 / 2 - 30;
	const branches: DiagramBox[] = [];
	const leaves: Array<{ box: DiagramBox; parent: number }> = [];
	const n = d.branches.length;
	d.branches.forEach((b, i) => {
		const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
		const bw = 108, bh = 38;
		const bx = cx + Math.cos(a) * rx * 0.5, by = cy + Math.sin(a) * ry * 0.56;
		branches.push({ x: bx - bw / 2, y: by - bh / 2, w: bw, h: bh, lines: wrapText(b.text, 15, 2), shape: "branch", tone: 1 + (i % 5) });
		const kids = b.children ?? [];
		kids.forEach((c, j) => {
			const ka = a + (kids.length === 1 ? 0 : (j - (kids.length - 1) / 2) * 0.42);
			const lw = 104, lh = 30;
			const lx = Math.min(width - lw / 2 - 2, Math.max(lw / 2 + 2, cx + Math.cos(ka) * rx));
			const ly = cy + Math.sin(ka) * ry;
			leaves.push({ box: { x: lx - lw / 2, y: ly - lh / 2, w: lw, h: lh, lines: wrapText(c, 15, 2), shape: "leaf", tone: 1 + (i % 5) }, parent: i });
		});
	});
	// Place in order (centre, branches, leaves): a box that touches anything already placed slides away from the
	// centre, vertically (so it stays inside the width), in one fixed direction until it is clear. Always terminates.
	const movable = [...branches, ...leaves.map((l) => l.box)];
	const placed: DiagramBox[] = [center];
	for (const m of movable) {
		const dir = m.y + m.h / 2 < cy ? -1 : 1;
		for (let step = 0; step < 400 && placed.some((p) => overlaps(m, p)); step++) m.y += dir * 4;
		placed.push(m);
	}
	const all = [center, ...movable];
	const top = Math.min(...all.map((b) => b.y)) - 6;
	for (const b of all) b.y -= top;
	const height = Math.max(...all.map((b) => b.y + b.h)) + 6;
	const link = (from: DiagramBox, to: DiagramBox): DiagramArrow => {
		const p = edgePoint(from, to.x + to.w / 2, to.y + to.h / 2), q = edgePoint(to, from.x + from.w / 2, from.y + from.h / 2);
		return { points: [p, q], arrow: false };
	};
	const arrows = [...branches.map((b) => link(center, b)), ...leaves.map((l) => link(branches[l.parent]!, l.box))];
	return { w: width, h: height, boxes: all, arrows };
}

export function drawDiagram(d: Diagram, width: number): DiagramShapes {
	return d.kind === "flow" ? drawFlow(d, width) : drawMind(d, width);
}

/** The words of a diagram, for the notes outline the agent reads. */
export function diagramText(d: Diagram): string {
	return d.kind === "flow" ? d.nodes.map((n) => n.text).join(" → ") : `${d.center}: ${d.branches.map((b) => b.text).join(", ")}`;
}

/** The flat fields a model fills in (tool arguments) → a Diagram (validated later by the notes). */
export interface FlatDiagram {
	diagramKind?: string;
	nodes?: Array<{ id: string; text: string; decision?: boolean }>;
	edges?: Array<{ from: string; to: string; label?: string }>;
	center?: string;
	branches?: Array<{ text: string; children?: string[] }>;
}
export function diagramFromFlat(b: FlatDiagram): Diagram {
	if (b.diagramKind === "mind") return { kind: "mind", center: b.center ?? "", branches: b.branches ?? [] };
	return { kind: "flow", nodes: (b.nodes ?? []).map((n) => ({ id: n.id, text: n.text, ...(n.decision ? { shape: "decision" as const } : {}) })), edges: b.edges ?? [] };
}

/** Schema text shared by the note-taking prompts. */
export const DIAGRAM_GUIDE = `- diagram: a flowchart or mind map drawn for you from content. diagramKind "flow": nodes [{id,text,decision?}] and edges [{from,to,label?}] for a process, algorithm, protocol exchange or state changes — at most 8 nodes, mostly one main path, at most two decisions (decision=true for a yes/no question, with labelled "yes"/"no" edges); split a bigger process into two diagrams. diagramKind "mind": center + up to 6 branches [{text, children[≤3]}] for a topic and its parts. Node text is short plain words (no formulas — put an equation in a math block next to the diagram). Optional title. Use one whenever the content has a process, a sequence of steps, a comparison or a set of related ideas.`;
