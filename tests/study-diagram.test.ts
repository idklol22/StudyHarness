/**
 * Flowcharts and mind maps in the class notes: validation, deterministic non-overlapping layout, and placement.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanDiagram, diagramFromFlat, drawDiagram, wrapText } from "../src/core/study/diagram.ts";
import { appendBlocks, editElement, emptyNotebook, notebookOutline } from "../src/core/study/notes.ts";

const flow = () => cleanDiagram({ kind: "flow", nodes: [{ id: "a", text: "Receive SYN" }, { id: "b", text: "Send SYN-ACK" }, { id: "c", text: "Got ACK?", shape: "decision" }, { id: "d", text: "Connected" }, { id: "e", text: "Retry" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d", label: "yes" }, { from: "c", to: "e", label: "no" }, { from: "e", to: "b" }] });

describe("diagram validation", () => {
	it("bounds and cleans what the agent supplies, and refuses what cannot be drawn", () => {
		assert.throws(() => cleanDiagram({ kind: "flow", nodes: [{ id: "a", text: "x" }], edges: [] }), /at least two nodes/);
		assert.throws(() => cleanDiagram({ kind: "flow", nodes: [{ id: "a", text: "x" }, { id: "b", text: "y" }], edges: [{ from: "a", to: "zzz" }] }), /needs edges/);
		assert.throws(() => cleanDiagram({ kind: "mind", center: "TCP", branches: [{ text: "only one" }] }), /at least two branches/);
		assert.throws(() => cleanDiagram({ kind: "pie" }), /flow.*mind/);
		const d = cleanDiagram({ kind: "mind", center: "  TCP \n handshake ", branches: Array.from({ length: 12 }, (_, i) => ({ text: `b${i}`, children: ["1", "2", "3", "4", "5"] })) });
		assert.equal(d.kind === "mind" && d.branches.length, 6);
		assert.equal(d.kind === "mind" && d.branches[0]!.children!.length, 3);
		assert.equal(d.kind === "mind" && d.center, "TCP handshake");
	});

	it("builds a diagram from a model's flat fields", () => {
		const d = diagramFromFlat({ diagramKind: "flow", nodes: [{ id: "a", text: "A" }, { id: "b", text: "B", decision: true }], edges: [{ from: "a", to: "b" }] });
		assert.equal(d.kind === "flow" && d.nodes[1]!.shape, "decision");
		assert.equal(diagramFromFlat({ diagramKind: "mind", center: "C", branches: [{ text: "x" }, { text: "y" }] }).kind, "mind");
	});
});

describe("diagram layout", () => {
	it("a flowchart flows downward, handles a retry loop, and never overlaps or leaves the page column", () => {
		const shapes = drawDiagram(flow(), 500);
		const boxes = shapes.boxes;
		assert.equal(boxes.length, 5);
		assert.ok(boxes[1]!.y > boxes[0]!.y && boxes[2]!.y > boxes[1]!.y && boxes[3]!.y > boxes[2]!.y, "each step sits below its predecessor");
		assert.equal(boxes[3]!.y, boxes[4]!.y, "the two outcomes share a row");
		for (const b of boxes) assert.ok(b.x >= 0 && b.x + b.w <= 500 && b.y + b.h <= shapes.h, "inside the diagram");
		for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i]!, b = boxes[j]!;
			assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `boxes ${i} and ${j} do not overlap`);
		}
		assert.equal(shapes.arrows.length, 5);
		assert.ok(shapes.arrows.some((a) => a.label === "yes"));
		assert.deepEqual(drawDiagram(flow(), 500), shapes, "deterministic");
	});

	it("a mind map puts a centre, branches and leaves inside the width", () => {
		const d = cleanDiagram({ kind: "mind", center: "Virtual memory", branches: [{ text: "Paging", children: ["Page table", "TLB"] }, { text: "Swapping", children: ["Clock", "LRU", "FIFO"] }, { text: "Segmentation" }] });
		const s = drawDiagram(d, 500);
		assert.equal(s.boxes.filter((b) => b.shape === "center").length, 1);
		assert.equal(s.boxes.filter((b) => b.shape === "branch").length, 3);
		assert.equal(s.boxes.filter((b) => b.shape === "leaf").length, 5);
		for (const b of s.boxes) assert.ok(b.x >= -0.5 && b.x + b.w <= 500.5 && b.y >= -0.5 && b.y + b.h <= s.h + 0.5, `${b.lines.join(" ")} inside`);
	});

	it("wraps text into a few short lines", () => {
		assert.deepEqual(wrapText("one two three four", 9, 3), ["one two", "three", "four"]);
		assert.equal(wrapText("a very long sentence that keeps going and going and going", 10, 2).at(-1)!.endsWith("…"), true);
	});
});

type Seg = [[number, number], [number, number]];
const boxHit = (seg: Seg, b: { x: number; y: number; w: number; h: number }) => {
	// Axis-aligned segment strictly inside a box (touching its border is how arrows meet boxes).
	const [[x1, y1], [x2, y2]] = seg;
	const e = 0.5;
	if (y1 === y2) return y1 > b.y + e && y1 < b.y + b.h - e && Math.max(x1, x2) > b.x + e && Math.min(x1, x2) < b.x + b.w - e;
	if (x1 === x2) return x1 > b.x + e && x1 < b.x + b.w - e && Math.max(y1, y2) > b.y + e && Math.min(y1, y2) < b.y + b.h - e;
	return false;
};
const noOverlap = (boxes: Array<{ x: number; y: number; w: number; h: number }>) => {
	for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
		const a = boxes[i]!, b = boxes[j]!;
		assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `boxes ${i} and ${j} overlap`);
	}
};

describe("busy diagrams stay readable", () => {
	it("random wide and branching flowcharts: three per row at most, no overlaps, no arrow through a box", () => {
		let seed = 7;
		const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
		for (let round = 0; round < 60; round++) {
			const count = 4 + Math.floor(rand() * 11);
			const nodes = Array.from({ length: count }, (_, i) => ({ id: `n${i}`, text: `Step ${i} ${"does something important ".repeat(1 + Math.floor(rand() * 3))}`, ...(rand() < 0.2 ? { shape: "decision" as const } : {}) }));
			const edges: Array<{ from: string; to: string; label?: string }> = [];
			// a wide fan-out layer, chains, skips and a loop back
			for (let i = 1; i < count; i++) edges.push({ from: `n${rand() < 0.5 ? 0 : Math.floor(rand() * i)}`, to: `n${i}`, ...(rand() < 0.3 ? { label: "yes" } : {}) });
			if (count > 4) edges.push({ from: `n${count - 1}`, to: "n1", label: "retry" });
			const d = cleanDiagram({ kind: "flow", nodes, edges });
			const s = drawDiagram(d, 500);
			noOverlap(s.boxes);
			const rows = new Map<number, number>();
			for (const b of s.boxes) rows.set(Math.round(b.y + b.h / 2), (rows.get(Math.round(b.y + b.h / 2)) ?? 0) + 1);
			for (const b of s.boxes) assert.ok(b.x >= 0 && b.x + b.w <= 500 && b.y >= 0 && b.y + b.h <= s.h, "inside the column");
			for (const a of s.arrows) for (let k = 0; k + 1 < a.points.length; k++) {
				const seg: Seg = [a.points[k]!, a.points[k + 1]!];
				for (const b of s.boxes) assert.ok(!boxHit(seg, b), `round ${round}: an arrow crosses a box`);
				for (const p of seg) assert.ok(p[0] >= 0 && p[0] <= 500 && p[1] >= 0 && p[1] <= s.h, "arrows stay inside");
			}
		}
	});

	it("a wide layer wraps onto rows of at most three", () => {
		const d = cleanDiagram({ kind: "flow", nodes: [{ id: "r", text: "Root" }, ...Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, text: `Child ${i}` }))], edges: Array.from({ length: 6 }, (_, i) => ({ from: "r", to: `c${i}` })) });
		const s = drawDiagram(d, 500);
		const children = s.boxes.slice(1);
		const ys = new Set(children.map((b) => b.y));
		assert.equal(ys.size, 2);
		assert.ok(children.every((b) => b.w >= 110));
	});

	it("a full mind map has no overlapping boxes", () => {
		const d = cleanDiagram({ kind: "mind", center: "Operating systems overview", branches: Array.from({ length: 6 }, (_, i) => ({ text: `Branch number ${i}`, children: ["first child idea", "second child idea", "third child idea"] })) });
		const s = drawDiagram(d, 500);
		noOverlap(s.boxes);
		for (const b of s.boxes) assert.ok(b.x >= 0 && b.x + b.w <= 500 && b.y >= 0 && b.y + b.h <= s.h);
	});
});

describe("diagrams in a notebook", () => {
	it("are placed like any block, read back in the outline, and cannot be edited", () => {
		const { notebook } = appendBlocks(emptyNotebook(), [{ type: "heading", text: "TCP" }, { type: "diagram", title: "Handshake", diagram: flow() }, { type: "text", text: "After." }], "tcp");
		const els = notebook.pages.flatMap((p) => p.elements);
		const diagram = els.find((e) => e.type === "diagram")!;
		assert.ok(diagram.h > 200);
		assert.ok(els.find((e) => e.type === "text")!.y >= diagram.y + diagram.h, "later blocks flow below the diagram");
		assert.match(notebookOutline(notebook), /diagram \(flow\): Handshake Receive SYN → Send SYN-ACK/);
		assert.throws(() => editElement(notebook, diagram.id, { text: "x" }), /cannot be edited/);
	});
});
