"use client";

/** Subject colour picker (Round 5): a muted swatch palette plus a custom hue, shared by the
 *  subject page header and the 3D graph's subject menu. Values are hues in degrees; `null`
 *  means "automatic" (a stable golden-angle colour derived from the subject's position).
 *  The picker posts `{action:"set-color", id, color}` and calls `onChanged` so the caller
 *  can refetch its library/graph. */
import { useState } from "react";
import { SUBJECT_BASE_LIGHTNESS, SUBJECT_SATURATION } from "@/src/core";

/** The subject swatch as CSS: the hue at the ACTIVE THEME's lightness
 *  (--lh-subject-l, tuned per theme so every swatch reads >= 4.5:1 on the
 *  theme's surfaces; tests/theme-contrast.test.ts). */
export function subjectColorCss(hue: number): string {
	return `hsl(${Math.round(hue) % 360} ${SUBJECT_SATURATION}% var(--lh-subject-l, ${SUBJECT_BASE_LIGHTNESS}%))`;
}

/** Muted swatches, deliberately low-saturation for the black/white UI. */
export const SUBJECT_SWATCHES = [205, 150, 95, 35, 340, 280, 250, 20, 175, 310] as const;

export function SubjectColor({
	subjectId,
	color,
	name,
	onChanged,
}: {
	subjectId: string;
	color?: number;
	name: string;
	onChanged?: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [value, setValue] = useState<number | null>(color ?? null);
	const [busy, setBusy] = useState(false);

	const commit = async (next: number | null) => {
		setValue(next);
		if (next === value && !busy) { setOpen(false); return; }
		setBusy(true);
		try {
			await fetch("/api/study/library", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "set-color", id: subjectId, color: next }),
			});
			onChanged?.();
		} finally {
			setBusy(false);
			setOpen(false);
		}
	};

	return (
		<div className="subject-color" data-testid={`subject-color-${subjectId}`}>
			<button
				type="button"
				aria-label={`Change colour for ${name}`}
				aria-expanded={open}
				title="Change colour"
				disabled={busy}
				onClick={() => setOpen((o) => !o)}
				onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}
				className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border/60 hover:bg-accent disabled:opacity-50"
			>
				<span className="size-3 rounded-full" style={{ background: subjectColorCss(value ?? 205) }} />
			</button>
			{open && (
				<div className="mt-1 flex w-52 flex-col gap-2 rounded-lg border bg-card p-2 text-xs shadow-lg">
					<div className="grid grid-cols-5 gap-1">
						{SUBJECT_SWATCHES.map((h) => (
							<button
								key={h}
								type="button"
								aria-label={`Colour ${h}`}
								title={`Colour ${h}`}
								onClick={() => void commit(h)}
								className={`flex size-7 items-center justify-center rounded-md border hover:border-foreground ${value === h ? "border-foreground" : "border-transparent"}`}
							>
								<span className="size-4 rounded-full" style={{ background: subjectColorCss(h) }} />
							</button>
						))}
					</div>
					<label className="flex flex-col gap-1 text-muted-foreground">
						Custom hue
						<span className="flex items-center gap-2">
							<input
								type="range"
								min={0}
								max={359}
								value={value ?? 205}
								aria-label="Custom hue"
								onChange={(e) => setValue(Number(e.target.value))}
								onPointerUp={() => void commit(value ?? 205)}
								onKeyUp={() => void commit(value ?? 205)}
								className="w-full accent-foreground"
							/>
							<span className="w-8 tabular-nums text-right text-foreground">{value ?? "auto"}</span>
						</span>
					</label>
					<button type="button" onClick={() => void commit(null)} className="rounded-md px-2 py-1 text-left text-muted-foreground hover:bg-accent hover:text-foreground">Automatic</button>
				</div>
			)}
		</div>
	);
}
