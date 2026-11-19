"use client";

/**
 * Suggested topics and the ideas of a scope (owner 2026-11-19). When a file lands in a subject, the agent proposes the
 * 1–2 broad topics it covers; here the learner accepts (optionally renaming), or dismisses. Accepting creates the
 * topic (or adds to a matching one), moves the file there and gives the topic its ideas and context.
 * IdeasSection lists a topic's (or the subject's own) ideas with the files (pages) and chats about each.
 */
import { useState } from "react";
import Link from "next/link";
import { CheckIcon, LightbulbIcon, XIcon } from "lucide-react";
import { ideasOf, suggestionsIn, topicOf, type Library } from "@/src/core";

type Act = (body: unknown) => Promise<void>;

export function SuggestionsCard({ library, subjectId, act }: { library: Library; subjectId: string; act: Act }) {
	const [names, setNames] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState("");
	const list = suggestionsIn(library, subjectId);
	if (!list.length) return null;
	const run = async (id: string, body: unknown) => { setBusy(id); try { await act(body); } finally { setBusy(""); } };
	return (
		<section className="mt-4 rounded-xl border border-primary/40 bg-card p-4" data-testid="suggestions-card">
			<h2 className="mb-1 flex items-center gap-1.5 text-sm font-medium"><LightbulbIcon className="size-4 text-primary" />Suggested topics</h2>
			<p className="mb-3 text-xs text-muted-foreground">From the files you added. Accept to create the topic and move the file into it; rename first if you like.</p>
			<ul className="flex flex-col gap-3">
				{list.map((s) => {
					const file = library.materials.find((m) => m.id === s.materialId);
					return (
						<li key={s.id} className="rounded-lg border p-3" data-testid="suggestion">
							<div className="mb-2 truncate text-xs text-muted-foreground">{file?.fileName}</div>
							{s.topics.map((t, i) => {
								const k = `${s.id}:${i}`;
								const existing = t.topicId ? topicOf(library, t.topicId) : undefined;
								return (
									<div key={k} className="mb-2 last:mb-0">
										<div className="flex flex-wrap items-center gap-2">
											<input value={names[k] ?? t.name} onChange={(e) => setNames((n) => ({ ...n, [k]: e.target.value }))} aria-label="Topic name" maxLength={80} className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm font-medium outline-none focus-visible:border-ring" />
											<span className="text-xs text-muted-foreground">pages {t.pages.from}–{t.pages.to}{existing && (names[k] ?? t.name) === t.name ? ` · adds to “${existing.name}”` : ""}</span>
										</div>
										{t.summary && <p className="mt-1 text-xs text-muted-foreground">{t.summary}</p>}
										{t.ideas.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{t.ideas.map((idea) => <span key={idea.name} title={idea.summary} className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">{idea.name}</span>)}</div>}
									</div>
								);
							})}
							<div className="mt-2 flex gap-2">
								<button type="button" disabled={busy === s.id} data-testid="accept-suggestion" onClick={() => void run(s.id, { action: "accept-suggestion", id: s.id, renames: Object.fromEntries(s.topics.flatMap((t, i) => { const v = names[`${s.id}:${i}`]; return v && v.trim() && v !== t.name ? [[i, v]] : []; })) })} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"><CheckIcon className="size-3.5" />Accept</button>
								<button type="button" disabled={busy === s.id} data-testid="dismiss-suggestion" onClick={() => void run(s.id, { action: "dismiss-suggestion", id: s.id })} className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs hover:bg-accent disabled:opacity-50"><XIcon className="size-3.5" />Dismiss</button>
							</div>
						</li>
					);
				})}
			</ul>
			{list.length > 1 && <button type="button" disabled={!!busy} onClick={() => void (async () => { for (const s of list) await run(s.id, { action: "accept-suggestion", id: s.id }); })()} className="mt-3 text-xs text-primary hover:underline">Accept all</button>}
		</section>
	);
}

export function IdeasSection({ library, subjectId, topicId, chatTitles }: { library: Library; subjectId: string; topicId?: string; chatTitles: ReadonlyMap<string, string> }) {
	const ideas = ideasOf(library, { subjectId, ...(topicId ? { topicId } : {}) });
	if (!ideas.length) return null;
	return (
		<section className="mt-6" data-testid="ideas-section">
			<h2 className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">{topicId ? "Key ideas" : "Ideas across the subject"}</h2>
			<ul className="flex flex-col gap-1.5">
				{ideas.map((i) => (
					<li key={i.id} className="rounded-lg border px-3 py-2 text-sm">
						<div className="font-medium">{i.name}</div>
						{i.summary && <div className="text-xs text-muted-foreground">{i.summary}</div>}
						{(i.files.length > 0 || i.chats.length > 0) && (
							<div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
								{i.files.map((f) => { const m = library.materials.find((x) => x.id === f.materialId); return m ? <span key={f.materialId} className="text-muted-foreground">{m.fileName}{f.pages ? ` · p. ${f.pages}` : ""}</span> : null; })}
								{i.chats.map((c) => <Link key={c} href={`/chat/${c}`} className="text-primary hover:underline">{chatTitles.get(c) ?? "Chat"}</Link>)}
							</div>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}
