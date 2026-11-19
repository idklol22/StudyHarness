"use client";

/**
 * The subject/topic page's tab bar (Round 5). The location hash is only memory for the active section: clicking a
 * tab replaces the hash (no history entry, no jump to an anchor) and a `hashchange` from a link into `#notes` or
 * from the back/forward buttons switches the tab the other way.
 */
import { useEffect } from "react";

export interface ScopeTab { id: string; label: string }

/** Read a tab id out of a location hash; anything not in `allowed` becomes `fallback`. */
export function tabFromHash(hash: string, allowed: readonly string[], fallback: string): string {
	const raw = hash.trim().replace(/^#/, "").split(/[?#]/, 1)[0]?.trim() ?? "";
	return allowed.includes(raw) ? raw : fallback;
}

export function ScopeTabs({ tabs, active, onChange }: { tabs: readonly ScopeTab[]; active: string; onChange: (id: string) => void }) {
	useEffect(() => {
		const allowed = tabs.map((t) => t.id);
		const onHash = () => onChange(tabFromHash(window.location.hash, allowed, active));
		window.addEventListener("hashchange", onHash);
		return () => window.removeEventListener("hashchange", onHash);
	}, [tabs, active, onChange]);

	// Keep the hash in step when the page switches tabs itself (a header action, or a stale hash falling back).
	useEffect(() => {
		if (tabFromHash(window.location.hash, tabs.map((t) => t.id), "") === active) return;
		try { window.history.replaceState(null, "", `#${active}`); } catch { /* best-effort */ }
	}, [active, tabs]);

	const select = (id: string) => {
		onChange(id);
		try { window.history.replaceState(null, "", `#${id}`); } catch { window.location.hash = id; }
	};

	return (
		<div role="tablist" aria-label="Sections" className="mt-4 flex flex-wrap gap-x-1 border-b" data-testid="scope-tabs">
			{tabs.map((t) => (
				<button
					key={t.id}
					type="button"
					role="tab"
					aria-selected={active === t.id}
					data-testid={`scope-tab-${t.id}`}
					data-tab={t.id}
					onClick={() => select(t.id)}
					className={`shrink-0 border-b-2 px-3 py-2 text-xs transition-colors ${active === t.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
				>{t.label}</button>
			))}
		</div>
	);
}
