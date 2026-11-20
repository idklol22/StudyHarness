"use client";
/**
 * THE THEME PICKER (theme wave, 2026-11-04): a grid of theme cards — the
 * presets, then the imported customs, then the dashed "Import JSON" card —
 * under a header that names the active theme and offers "Export JSON".
 *
 * Each card previews its theme with literal colors (never the page's live
 * tokens): an "Aa ai" sample on the theme background (text + accent ink)
 * and four dots — surface, accent, error, success. Picking a card only
 * changes `appearance.theme`; overrides ride along untouched. Imports POST
 * the file's JSON to /api/themes (the server validates; its error shows in
 * the import card). Export downloads the ACTIVE theme with every override
 * applied — re-importing it reproduces what is on screen.
 */

import { useRef, useState } from "react";
import { CheckIcon, DownloadIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { exportThemeFile, tuneOf, type AppearanceSettings, type Theme } from "@/src/core";

/** The selected card's frame: a 2px gap in the dialog surface, then a 1px
 *  ring in the theme accent (the check by the name does the rest). */
const SELECTED_FRAME = "shadow-[0_0_0_2px_var(--card),0_0_0_3px_var(--lh-accent)]";

function Dot({ color, edge }: { color: string; edge?: string }) {
	return (
		<span
			aria-hidden
			className="size-2.5 rounded-full"
			style={{ background: color, ...(edge ? { border: `1px solid ${edge}` } : {}) }}
		/>
	);
}

/** The scene thumbnail: a literal-color CSS stand-in for the live scene. */
function sceneThumb(theme: Theme): string | undefined {
	const t = tuneOf(theme);
	const ink = t.scenePeak;
	switch (t.scene) {
		case "dust": return `radial-gradient(circle at 18% 30%, ${ink}cc 0 1px, transparent 1.5px), radial-gradient(circle at 62% 70%, ${ink}aa 0 1px, transparent 1.5px), radial-gradient(circle at 85% 25%, ${ink}88 0 1.5px, transparent 2px), radial-gradient(circle at 40% 80%, ${ink}77 0 1px, transparent 1.5px)`;
		case "smoke": return `radial-gradient(60% 80% at 30% 30%, ${ink}55, transparent 70%), radial-gradient(50% 70% at 80% 70%, ${ink}3a, transparent 70%)`;
		case "clouds": return `radial-gradient(circle at 70% 70%, ${ink}cc 0 3px, transparent 3.5px), radial-gradient(circle at 30% 35%, ${ink}99 0 4px, transparent 4.5px)`;
		case "swirl": return `repeating-radial-gradient(circle at 30% 45%, ${ink}cc 0 1px, transparent 1px 3px)`;
		default: return undefined;
	}
}

/** The literal-color miniature: never reads the page tokens. A mini window —
 *  sidebar strip (surface), page (background), text sample + accent button,
 *  status dots — with the scene thumbnail behind when the theme has one. */
function Preview({ theme }: { theme: Theme }) {
	const c = theme.colors;
	const t = tuneOf(theme);
	const thumb = sceneThumb(theme);
	return (
		<span
			aria-hidden
			data-scene-thumb={t.scene}
			className="relative flex h-14 overflow-hidden rounded-md border"
			style={{ background: c.background, borderColor: t.borderStrong, boxShadow: theme.mode === "light" ? t.shadow : undefined }}
		>
			{thumb && <span className="absolute inset-0" style={{ background: thumb }} />}
			<span className="relative flex w-1/4 flex-col gap-1 border-r p-1.5" style={{ background: c.surface, borderColor: c.border }}>
				<i className="block h-1 rounded-full" style={{ background: c.textMuted }} />
				<i className="block h-1 w-2/3 rounded-full" style={{ background: t.textFaint }} />
			</span>
			<span className="relative flex flex-1 flex-col justify-between p-1.5">
				<span className="font-prose text-sm leading-none font-semibold" style={{ color: c.text }}>
					Aa <i className="font-normal" style={{ color: c.textMuted }}>ai</i>
				</span>
				<span className="flex items-center justify-between">
					<i className="block rounded-sm px-1.5 text-[9px] leading-3 font-medium not-italic" style={{ background: c.accent, color: t.accentContrast }}>Go</i>
					<span className="flex gap-1">
						<Dot color={c.error} />
						<Dot color={c.success} />
						<Dot color={c.warning} />
					</span>
				</span>
			</span>
		</span>
	);
}

/** Save a JSON file through a transient object URL (browser + Electron). */
function downloadJson(filename: string, data: unknown) {
	const url = URL.createObjectURL(new Blob([`${JSON.stringify(data, null, "\t")}\n`], { type: "application/json" }));
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

/** The Theme row of Settings → Appearance (see the file header). */
export function ThemeCards({
	themes,
	active,
	appearance,
	onSelect,
	onRemoved,
	onImported,
}: {
	/** Presets, then customs (the provider's catalog). */
	themes: readonly Theme[];
	/** The active theme — its card is pressed. */
	active: Theme;
	/** The record delta — the export applies its overrides. */
	appearance: AppearanceSettings | undefined;
	onSelect: (id: string) => void;
	/** After a successful DELETE (the catalog must be re-read). */
	onRemoved: (theme: Theme) => void;
	/** After a successful import (the catalog must be re-read). */
	onImported: (theme: Theme) => void;
}) {
	const fileRef = useRef<HTMLInputElement>(null);
	const [importError, setImportError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const importFile = async (file: File) => {
		setImportError(null);
		let body: unknown;
		try {
			body = JSON.parse(await file.text());
		} catch {
			setImportError(`${file.name} is not valid JSON`);
			return;
		}
		setBusy(true);
		try {
			const res = await fetch("/api/themes", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			const out = (await res.json().catch(() => ({}))) as { theme?: Theme; error?: string };
			if (!res.ok || !out.theme) {
				setImportError(out.error ?? `import failed (${res.status})`);
				return;
			}
			onImported(out.theme);
		} catch {
			setImportError("import failed (network)");
		} finally {
			setBusy(false);
		}
	};

	const remove = async (theme: Theme) => {
		const res = await fetch(`/api/themes/${encodeURIComponent(theme.id)}`, { method: "DELETE" }).catch(() => null);
		if (res?.ok) onRemoved(theme);
	};

	return (
		<div data-testid="row-theme" className="flex flex-col gap-3 py-1">
			<div className="flex items-end justify-between gap-4">
				<span className="min-w-0">
					<span className="block font-prose text-(length:--lh-prose-size)">Theme</span>
					<span data-testid="theme-hint" className="block text-xs text-muted-foreground/70">
						{active.name} · {active.mode} · sets every color below
					</span>
				</span>
				<button
					type="button"
					data-testid="theme-export"
					onClick={() => downloadJson(`${active.id}.json`, exportThemeFile(active, appearance))}
					className="flex h-7 shrink-0 items-center gap-2 rounded-sm border border-border bg-background px-2 font-ui text-xs text-foreground transition-colors hover:border-muted-foreground/50"
				>
					<DownloadIcon className="size-3.5" />
					Export JSON
				</button>
			</div>
			<div className="grid grid-cols-3 gap-3">
				{themes.map((theme) => {
					const selected = theme.id === active.id;
					return (
						<div key={theme.id} className="relative min-w-0">
							<button
								type="button"
								data-testid={`theme-card-${theme.id}`}
								aria-pressed={selected}
								onClick={() => onSelect(theme.id)}
								className={cn(
									"flex w-full flex-col gap-2.5 rounded-lg border border-border bg-background p-3 text-left transition-colors",
									selected ? SELECTED_FRAME : "hover:border-muted-foreground/50",
								)}
							>
								<Preview theme={theme} />
								<span className={cn("flex items-center justify-between gap-2", !theme.builtin && "pr-6")}>
									<span className="flex min-w-0 items-center gap-1.5 font-prose text-base">
										{selected && <CheckIcon className="size-3.5 shrink-0" strokeWidth={2.5} />}
										<span className="truncate">{theme.name}</span>
									</span>
									<span className="shrink-0 rounded-sm border border-border px-1.5 font-ui text-xs uppercase tracking-wider text-muted-foreground">
										{theme.builtin ? theme.mode : "custom"}
									</span>
								</span>
							</button>
							{!theme.builtin && (
								<button
									type="button"
									aria-label={`Remove ${theme.name}`}
									data-testid={`theme-remove-${theme.id}`}
									onClick={() => void remove(theme)}
									className="absolute right-3 bottom-3 flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-error"
								>
									<Trash2Icon className="size-3.5" />
								</button>
							)}
						</div>
					);
				})}
				<button
					type="button"
					data-testid="theme-import"
					disabled={busy}
					onClick={() => fileRef.current?.click()}
					className="flex min-h-27 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/50 p-3 text-center font-ui text-xs text-muted-foreground transition-colors hover:text-foreground"
				>
					<UploadIcon className="size-4" />
					<span>Import JSON</span>
					{importError ? (
						<span data-testid="theme-import-error" className="text-error">{importError}</span>
					) : (
						<span className="text-muted-foreground/70">name · mode · colors</span>
					)}
				</button>
				<input
					ref={fileRef}
					type="file"
					accept=".json,application/json"
					hidden
					data-testid="theme-import-file"
					onChange={(e) => {
						const file = e.target.files?.[0];
						e.target.value = ""; // the same file can be picked again
						if (file) void importFile(file);
					}}
				/>
			</div>
		</div>
	);
}
