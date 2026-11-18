/** Layout quality bench: synthetic batched graph -> overlap + elongation metrics.
 *  npx tsx scripts/layout-bench.ts */
import { incrementalLayout } from "../src/core/layout.ts";
import type { Position } from "../src/core/contracts.ts";

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

export function makeGraph(seed: number, clusters: number, size: number, orphans: number) {
	const r = rng(seed);
	const batches: { nodes: string[]; edges: [string, string][] }[] = [];
	const all: string[] = [];
	for (let c = 0; c < clusters; c++) {
		const nodes: string[] = []; const edges: [string, string][] = [];
		for (let i = 0; i < size; i++) {
			const id = `c${c}n${i}`; nodes.push(id);
			if (i > 0) edges.push([`c${c}n${Math.floor(r() * i)}`, id]);
			if (i > 3 && r() < 0.3) edges.push([`c${c}n${Math.floor(r() * i)}`, id]);
			if (i > 3 && r() < 0.15 && all.length) edges.push([all[Math.floor(r() * all.length)]!, id]); // cross-link
		}
		for (let o = 0; o < orphans; o++) nodes.push(`c${c}o${o}`);
		all.push(...nodes);
		batches.push({ nodes, edges });
	}
	return batches;
}

export function metrics(pos: Map<string, Position>, edges: { from: string; to: string }[], minGap: number) {
	const p = [...pos.values()]; let close = 0, minD = Infinity;
	for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
		const d = Math.hypot(p[i]!.x - p[j]!.x, p[i]!.y - p[j]!.y);
		if (d < minGap) close++; if (d < minD) minD = d;
	}
	const mx = p.reduce((a, q) => a + q.x, 0) / p.length, my = p.reduce((a, q) => a + q.y, 0) / p.length;
	let sxx = 0, syy = 0, sxy = 0;
	for (const q of p) { const dx = q.x - mx, dy = q.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
	const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(tr * tr / 4 - det, 0));
	const aspect = Math.sqrt((tr / 2 + disc) / Math.max(tr / 2 - disc, 1e-9));
	const lens = edges.map((e) => { const a = pos.get(e.from)!, b = pos.get(e.to)!; return Math.hypot(a.x - b.x, a.y - b.y); }).sort((a, b) => a - b);
	const med = lens[Math.floor(lens.length / 2)] ?? 0, mxl = lens[lens.length - 1] ?? 0;
	const extent = Math.max(...p.map((q) => Math.hypot(q.x - mx, q.y - my)));
	return { n: p.length, closePairs: close, minD: +minD.toFixed(1), aspect: +aspect.toFixed(2), medEdge: +med.toFixed(0), maxEdge: +mxl.toFixed(0), radius: +extent.toFixed(0) };
}

function run(name: string, g: ReturnType<typeof makeGraph>) {
	let pos = new Map<string, Position>(); const nodes: { id: string }[] = []; const edges: { from: string; to: string }[] = [];
	for (const b of g) {
		for (const n of b.nodes) nodes.push({ id: n });
		for (const [a, c] of b.edges) edges.push({ from: a, to: c });
		const members = nodes.map((n) => n.id).filter((id) => id.startsWith("c"));
		const cl = g.slice(0, g.indexOf(b) + 1).map((bb) => ({ members: bb.nodes }));
		pos = incrementalLayout(nodes, edges, pos, { clusters: cl });
		void members;
	}
	console.log(name, JSON.stringify(metrics(pos, edges, 14)));
}
run("small ", makeGraph(1, 3, 15, 2));
run("medium", makeGraph(2, 8, 30, 4));
run("large ", makeGraph(3, 15, 40, 6));
run("chainy", makeGraph(4, 6, 60, 3));
