"use client";

/**
 * The 3D graph's view sliders (owner 2026-11-19): edge length, centre distance, spacing, gravity, friction, node size,
 * edge width, colour, brightness, glow, when names show while zooming, subject names always, auto-rotate.
 * Saved per device. Pure view state: nothing here changes your subjects.
 */
import { RotateCcwIcon, XIcon } from "lucide-react";
import { DEFAULT_TUNING, type GraphTuning } from "@/components/graph-3d-layout";

export const TUNING_KEY = "lh.knowledge.tuning.v1";

export function readTuning(): GraphTuning {
	try {
		const raw = JSON.parse(localStorage.getItem(TUNING_KEY) ?? "null") as Partial<GraphTuning> | null;
		if (!raw || typeof raw !== "object") return { ...DEFAULT_TUNING };
		const out = { ...DEFAULT_TUNING };
		for (const k of Object.keys(DEFAULT_TUNING) as Array<keyof GraphTuning>) {
			const v = raw[k];
			if (typeof v === typeof DEFAULT_TUNING[k] && (typeof v !== "number" || Number.isFinite(v))) (out as Record<string, unknown>)[k] = v;
		}
		return out;
	} catch { return { ...DEFAULT_TUNING }; }
}
export function saveTuning(t: GraphTuning): void { try { localStorage.setItem(TUNING_KEY, JSON.stringify(t)); } catch { /* best-effort */ } }

type NumberKey = { [K in keyof GraphTuning]: GraphTuning[K] extends number ? K : never }[keyof GraphTuning];
const SLIDERS: Array<{ group: string; rows: Array<{ key: NumberKey; label: string; min: number; max: number; step: number; show?: (v: number) => string }> }> = [
	{ group: "Layout", rows: [
		{ key: "edgeLength", label: "Edge length", min: 0.4, max: 2.5, step: 0.05 },
		{ key: "centreDistance", label: "Centre distance", min: 0.4, max: 2.5, step: 0.05 },
		{ key: "spacing", label: "Spacing", min: 0.4, max: 2.5, step: 0.05 },
		{ key: "gravity", label: "Gravity", min: 0.1, max: 3, step: 0.05 },
		{ key: "friction", label: "Friction", min: 0.05, max: 0.95, step: 0.01, show: (v) => v.toFixed(2) },
	] },
	{ group: "Look", rows: [
		{ key: "nodeSize", label: "Node size", min: 0.3, max: 2.5, step: 0.05 },
		{ key: "edgeWidth", label: "Edge strength", min: 0.1, max: 3, step: 0.05 },
		{ key: "saturation", label: "Colour", min: 0, max: 0.9, step: 0.01, show: (v) => `${Math.round(v * 100)}%` },
		{ key: "brightness", label: "Brightness", min: 0.3, max: 0.85, step: 0.01, show: (v) => `${Math.round(v * 100)}%` },
		{ key: "glow", label: "Glow", min: 0, max: 1, step: 0.01, show: (v) => `${Math.round(v * 100)}%` },
	] },
	{ group: "Names", rows: [
		{ key: "labels", label: "Show names from", min: 0.3, max: 3, step: 0.05, show: (v) => (v < 0.8 ? "close up" : v > 1.6 ? "far away" : "mid range") },
	] },
];

export function GraphTuningPanel({ tuning, onChange, onClose }: { tuning: GraphTuning; onChange: (t: GraphTuning) => void; onClose: () => void }) {
	const set = (patch: Partial<GraphTuning>) => onChange({ ...tuning, ...patch });
	return (
		<div className="w-64 rounded-xl border bg-card/95 p-3 text-xs shadow-lg backdrop-blur" data-testid="graph-tuning">
			<div className="mb-2 flex items-center justify-between">
				<span className="font-medium">View settings</span>
				<span className="flex items-center gap-1">
					<button type="button" title="Back to defaults" aria-label="Reset view settings" onClick={() => onChange({ ...DEFAULT_TUNING })} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><RotateCcwIcon className="size-3.5" /></button>
					<button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><XIcon className="size-3.5" /></button>
				</span>
			</div>
			<div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
				{SLIDERS.map((g) => (
					<div key={g.group} className="flex flex-col gap-1.5">
						<div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{g.group}</div>
						{g.rows.map((r) => (
							<label key={r.key} className="flex flex-col gap-0.5">
								<span className="flex justify-between"><span>{r.label}</span><span className="tabular-nums text-muted-foreground">{r.show ? r.show(tuning[r.key]) : `${tuning[r.key].toFixed(2)}×`}</span></span>
								<input type="range" min={r.min} max={r.max} step={r.step} value={tuning[r.key]} onChange={(e) => set({ [r.key]: Number(e.target.value) } as Partial<GraphTuning>)} aria-label={r.label} className="accent-primary" />
							</label>
						))}
					</div>
				))}
				<label className="flex items-center justify-between gap-2"><span>Always name subjects</span><input type="checkbox" checked={tuning.subjectNames} onChange={(e) => set({ subjectNames: e.target.checked })} /></label>
				<label className="flex items-center justify-between gap-2"><span>Slowly rotate when idle</span><input type="checkbox" checked={tuning.rotate} onChange={(e) => set({ rotate: e.target.checked })} /></label>
			</div>
		</div>
	);
}
