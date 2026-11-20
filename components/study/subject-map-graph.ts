/**
 * Pure pieces of the 2D subject graph: node sizes/colours and the label
 * decluttering pass. Kept out of the React/canvas code so tests can pin the
 * behaviour without a DOM (tests/subject-map-graph.test.ts).
 */
import { LEAF_R, SUBJECT_R, TOPIC_R, type MapNodeKind } from "../../src/core/study/map-layout.ts";
import { subjectColorCss } from "../../src/core/study/colors.ts";

/** A label's geometry in graph coordinates; the rect is computed in screen space at the current zoom. */
export interface LabelCandidate {
	id: string;
	kind: MapNodeKind;
	label: string;
	x: number;
	y: number;
	r: number;
	/** An idea's parent topic, so hovering a topic reveals its ideas' labels. */
	parentId?: string;
}

export interface VisibleLabel {
	id: string;
	/** Ideas fade in with zoom; other kinds are always fully opaque. */
	opacity: number;
}

interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

const LIGHTNESS: Record<MapNodeKind, number> = { subject: 58, topic: 72, idea: 84 };
const FONT_PX: Record<MapNodeKind, number> = { subject: 15, topic: 11, idea: 10 };
const PRIORITY: Record<MapNodeKind, number> = { subject: 0, topic: 1, idea: 2 };

/** Ideas start fading in here and are fully readable at IDEA_LABEL_ZOOM. */
export const IDEA_LABEL_FADE_START = 1.2;
export const IDEA_LABEL_ZOOM = 1.6;
export const NODE_RADIUS: Record<MapNodeKind, number> = { subject: SUBJECT_R, topic: TOPIC_R, idea: LEAF_R };

/** Radius of a graph node in graph units (the canvas scales it with zoom). Pure. */
export function nodeRadius(kind: MapNodeKind): number {
	return NODE_RADIUS[kind]!;
}

/** One subject hue → full colour for the hub, lighter tints for its topics and ideas. Pure. */
export function nodeColor(hue: number, kind: MapNodeKind): string {
	return subjectColorCss(hue, LIGHTNESS[kind]!);
}

/** Canvas labels use a fixed screen font; cap long names the way the old SVG map did. */
export function shortLabel(label: string): string {
	return label.length > 24 ? `${label.slice(0, 23).trimEnd()}…` : label;
}

function labelRect(node: LabelCandidate, zoom: number): Rect {
	const font = FONT_PX[node.kind]!;
	const w = Math.max(1, shortLabel(node.label).length * font * 0.58);
	return {
		x: node.x * zoom - w / 2,
		y: (node.y + node.r) * zoom + 4,
		w,
		h: font + 3,
	};
}

function ideaOpacity(zoom: number, focused: boolean): number {
	if (focused) return 1;
	if (zoom <= IDEA_LABEL_FADE_START) return 0;
	return Math.min(1, (zoom - IDEA_LABEL_FADE_START) / (IDEA_LABEL_ZOOM - IDEA_LABEL_FADE_START));
}

function overlaps(a: Rect, b: Rect): boolean {
	const pad = 2;
	return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
}

/** Pick the labels to draw: subjects before topics before ideas, biggest first, skipping any
 *  screen rect that collides with one already accepted. Ideas are hidden until zoomed in
 *  (or until they / their topic are in the hover focus). Pure and deterministic. */
export function selectVisibleLabels(
	nodes: readonly LabelCandidate[],
	zoom: number,
	focusIds: ReadonlySet<string> = new Set(),
): VisibleLabel[] {
	const candidates = nodes
		.map((node) => {
			const focused = focusIds.has(node.id) || (node.parentId !== undefined && focusIds.has(node.parentId));
			return { node, opacity: node.kind === "idea" ? ideaOpacity(zoom, focused) : 1 };
		})
		.filter((c) => c.opacity > 0)
		.map((c) => ({ ...c, rect: labelRect(c.node, zoom) }))
		.sort((a, b) =>
			PRIORITY[a.node.kind]! - PRIORITY[b.node.kind]! ||
			b.node.r - a.node.r ||
			a.node.id.localeCompare(b.node.id),
		);
	const taken: Rect[] = [];
	const result: VisibleLabel[] = [];
	for (const c of candidates) {
		if (taken.some((rect) => overlaps(rect, c.rect))) continue;
		taken.push(c.rect);
		result.push({ id: c.node.id, opacity: c.opacity });
	}
	return result;
}
