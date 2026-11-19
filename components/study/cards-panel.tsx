"use client";

/**
 * The flashcards section of a subject/topic page: cards grouped by topic with counts and what is due, add/edit/remove,
 * and the three study modes (Due, Progressive, All). Studying opens a practice chat in this subject/topic that quizzes
 * the chosen cards; ratings are recorded there with spaced-repetition scheduling.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useServerEvent } from "@/components/server-events";
import { SessionStarter } from "@/components/start-session";
import { Trash2Icon } from "lucide-react";
import type { Card, GroupSummary, StudyMode } from "@/src/core";

type Data = { cards: Card[]; groups: GroupSummary[] };
const MODES: Array<[StudyMode, string, string]> = [
	["due", "Due", "Cards the spaced-repetition schedule says are due now"],
	["progressive", "Progressive", "One topic at a time, weakest first"],
	["all", "All", "Everything selected, weakest first"],
];

async function call(body: unknown): Promise<Data & { error?: string }> {
	try {
		const res = await fetch("/api/study/cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
		return await res.json();
	} catch { return { cards: [], groups: [], error: "Could not reach the app." }; }
}

export function CardsPanel({ subjectId, topicId }: { subjectId: string; topicId?: string }) {
	const router = useRouter();
	const scope = { subjectId, ...(topicId ? { topicId } : {}) };
	const query = new URLSearchParams(scope).toString();
	const [data, setData] = useState<Data | null>(null);
	const [error, setError] = useState("");
	const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
	const [q, setQ] = useState("");
	const [a, setA] = useState("");
	const [open, setOpen] = useState(false);

	const load = useCallback(async () => {
		try {
			const res = await fetch(`/api/study/cards?${query}`, { cache: "no-store" });
			const d = await res.json() as Data & { error?: string };
			if (d.cards) setData(d); else setError(d.error ?? "Could not load the cards.");
		} catch { setError("Could not reach the app."); }
	}, [query]);
	useEffect(() => { void load(); }, [load]);
	useServerEvent("sources-changed", () => { void load(); });

	const act = async (body: Record<string, unknown>) => {
		const r = await call({ ...scope, ...body });
		if (r.error) { setError(r.error); return false; }
		setData(r); setError("");
		return true;
	};
	const study = async (mode: StudyMode) => {
		const topics = [...picked];
		const label = MODES.find((m) => m[0] === mode)![1];
		const title = `Practice my flashcards in ${label} mode${topics.length ? ` for: ${topics.join(", ")}` : ""}.`;
		try { router.push(await new SessionStarter().start({ title, kind: "practice", placement: { ...scope, startMode: "check" } }, fetch)); }
		catch (e) { setError(e instanceof Error ? e.message : "Could not start practice."); }
	};

	const btn = "inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs transition-colors hover:bg-accent disabled:opacity-50";
	const total = data?.cards.length ?? 0;
	return (
		<section className="mt-6" data-testid="cards-section">
			<div className="mb-2 flex flex-wrap items-center gap-2">
				<h2 className="mr-auto text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Flashcards{total ? ` · ${total}` : ""}</h2>
				{total > 0 && MODES.map(([mode, label, hint]) => <button key={mode} type="button" title={hint} className={btn} onClick={() => void study(mode)} data-testid={`study-${mode}`}>Study {label}</button>)}
				<button type="button" className={btn} onClick={() => setOpen((o) => !o)}>{open ? "Cancel" : "Add card"}</button>
			</div>
			{error && <p role="alert" className="mb-2 rounded-md border border-destructive/40 bg-card px-3 py-2 text-xs text-destructive">{error}</p>}
			{open && (
				<form className="mb-3 flex flex-col gap-2 rounded-lg border bg-card p-3" onSubmit={async (e) => { e.preventDefault(); if (await act({ action: "add", q, a })) { setQ(""); setA(""); setOpen(false); } }}>
					<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Question" aria-label="Question" className="rounded-md border bg-transparent px-2 py-1.5 text-sm" />
					<textarea value={a} onChange={(e) => setA(e.target.value)} placeholder="Answer" aria-label="Answer" rows={2} className="rounded-md border bg-transparent px-2 py-1.5 text-sm" />
					<button type="submit" disabled={!q.trim() || !a.trim()} className={`${btn} self-start`}>Save card</button>
				</form>
			)}
			{!data ? <p className="text-sm text-muted-foreground">Loading…</p>
				: total === 0 ? <p className="text-sm text-muted-foreground">No cards yet. The tutor adds them as you learn, or add your own.</p>
				: data.groups.map((g) => (
					<div key={g.group} className="mb-2 rounded-lg border">
						<label className="flex items-center gap-2 px-3 py-2 text-sm">
							<input type="checkbox" checked={picked.has(g.group)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(g.group)) n.delete(g.group); else n.add(g.group); return n; })} aria-label={`Study ${g.group}`} />
							<span className="min-w-0 flex-1 truncate font-medium">{g.group}</span>
							<span className="text-xs text-muted-foreground">{g.total} card{g.total === 1 ? "" : "s"}{g.due ? ` · ${g.due} due` : ""}</span>
						</label>
						<ul className="border-t">
							{data.cards.filter((c) => c.group === g.group).map((c) => (
								<li key={c.id} className="group flex items-start gap-2 border-b px-3 py-2 text-sm last:border-b-0">
									<div className="min-w-0 flex-1"><div>{c.q}</div><div className="text-muted-foreground">{c.a}</div></div>
									<button type="button" aria-label="Remove card" title="Remove" className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" onClick={() => void act({ action: "remove", id: c.id })}><Trash2Icon className="size-3.5" /></button>
								</li>
							))}
						</ul>
					</div>
				))}
			{picked.size > 0 && <p className="mt-1 text-xs text-muted-foreground">Study buttons use the {picked.size} selected topic{picked.size === 1 ? "" : "s"}.</p>}
		</section>
	);
}
