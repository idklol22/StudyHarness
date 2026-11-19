/**
 * Pen marks → SVG geometry (pure, deterministic). A mark's numbers are fractions of its figure; the figure's pixel
 * size turns them into hand-drawn-looking shapes: a slightly open, wobbly circle, an arrow with a head, a wavy
 * underline. The same inputs always give the same drawing (no randomness), so the screen and the PDF agree.
 */
import type { Mark } from "@/src/core";

export type Shape =
	| { kind: "path"; d: string; fill?: string; opacity?: number; width?: number }
	| { kind: "text"; x: number; y: number; text: string };

const f = (n: number) => Math.round(n * 10) / 10;
const wob = (i: number, amp: number) => Math.sin(i * 12.9898 + 4.1) * amp;

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
	const pts: string[] = [];
	const steps = 28;
	for (let i = 0; i <= steps + 3; i++) {
		const a = (i / steps) * Math.PI * 2 - Math.PI / 2;
		const grow = 1 + i / (steps * 14); // the pen overshoots a little where it closes
		pts.push(`${f(cx + Math.cos(a) * (rx * grow + wob(i, 1.2)))},${f(cy + Math.sin(a) * (ry * grow + wob(i + 9, 1.2)))}`);
	}
	return "M" + pts.join(" L");
}

export function markShapes(mark: Mark, w: number, h: number): Shape[] {
	const x = mark.x * w, y = mark.y * h, bw = (mark.w ?? 0.2) * w, bh = (mark.h ?? 0.12) * h;
	switch (mark.kind) {
		case "circle": {
			const shapes: Shape[] = [{ kind: "path", d: ellipse(x + bw / 2, y + bh / 2, bw / 2 + 4, bh / 2 + 4), width: 3 }];
			if (mark.label) shapes.push({ kind: "text", x: x + bw + 8, y: y - 4, text: mark.label });
			return shapes;
		}
		case "highlight": return [{ kind: "path", d: `M${f(x)},${f(y)} L${f(x + bw)},${f(y + wob(1, 1))} L${f(x + bw)},${f(y + bh)} L${f(x)},${f(y + bh)} Z`, fill: "#facc15", opacity: 0.35, width: 0 }];
		case "underline": {
			const pts: string[] = [];
			for (let i = 0; i <= 14; i++) pts.push(`${f(x + (bw * i) / 14)},${f(y + bh + wob(i, 2))}`);
			return [{ kind: "path", d: "M" + pts.join(" L"), width: 3 }];
		}
		case "bracket": return [{ kind: "path", d: `M${f(x + 8)},${f(y)} Q${f(x)},${f(y)} ${f(x)},${f(y + 10)} L${f(x)},${f(y + bh - 10)} Q${f(x)},${f(y + bh)} ${f(x + 8)},${f(y + bh)}`, width: 3 }];
		case "arrow": {
			const tipX = x, tipY = y, fromX = (mark.fromX ?? mark.x + 0.15) * w, fromY = (mark.fromY ?? mark.y - 0.1) * h;
			const a = Math.atan2(tipY - fromY, tipX - fromX), head = 12;
			const mx = (fromX + tipX) / 2 + wob(3, 6), my = (fromY + tipY) / 2 + wob(5, 6);
			const left = `${f(tipX - Math.cos(a - 0.45) * head)},${f(tipY - Math.sin(a - 0.45) * head)}`, right = `${f(tipX - Math.cos(a + 0.45) * head)},${f(tipY - Math.sin(a + 0.45) * head)}`;
			const shapes: Shape[] = [{ kind: "path", d: `M${f(fromX)},${f(fromY)} Q${f(mx)},${f(my)} ${f(tipX)},${f(tipY)} M${left} L${f(tipX)},${f(tipY)} L${right}`, width: 3 }];
			if (mark.label) shapes.push({ kind: "text", x: fromX, y: fromY - 6, text: mark.label });
			return shapes;
		}
		case "label": return [{ kind: "text", x, y, text: mark.label ?? "" }];
	}
}
