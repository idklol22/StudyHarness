"use client";

/**
 * Topics and ideas the learner controls (owner 2026-11-19).
 *  - SuggestionsCard: the 1–2 topics proposed for a file added to a subject. Everything is editable before accepting:
 *    the topic's name, using one of the existing topics instead, and its ideas (remove, rename, add).
 *  - PutInTopic: choose the topic for a file yourself (an existing one or a new name); its ideas are then found.
 *  - IdeasSection: a topic's (or the subject's own) ideas, each editable, removable, and linked to its files and chats.
 */
import { useState } from "react";
import Link from "next/link";
import { CheckIcon, LightbulbIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { ideasOf, suggestionsIn, topicsOf, type Library, type Suggestion } from "@/src/core";

type Act = (body: unknown) => Promise<void>;
interface DraftIdea { name: string; summary: string; pages?: string }
interface DraftTopic { name: string; topicId: string; ideas: DraftIdea[] }

const chip = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]";
const input = "h-7 min-w-0 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring";

function SuggestionEditor({ library, subjectId, s, act }: { library: Library; subjectId: string; s: Suggestion; act: Act }) {
	const [draft, setDraft] = useState<DraftTopic[]>(() => s.topics.map((t) => ({ name: t.name, topicId: t.topicId ?? "", ideas: t.ideas.map((i) => ({ name: i.name, summary: i.summary, ...(i.pages ? { pages: i.pages } : {}) })) })));
	const [adding, setAdding] = useState<Record<number, string>>({});
	const [busy, setBusy] = useState(false);
	const topics = topicsOf(library, subjectId);
	const file = library.materials.find((m) => m.id === s.materialId);
	const update = (i: number, patch: Partial<DraftTopic>) => setDraft((d) => d.map((t, k) => (k === i ? { ...t, ...patch } : t)));
	const run = async (body: unknown) => { setBusy(true); try { await act(body); } finally { setBusy(false); } };
	const accept = () => run({ action: "accept-suggestion", id: s.id, edits: Object.fromEntries(draft.map((t, i) => [i, { ...(t.topicId ? { topicId: t.topicId } : { name: t.name }), ideas: t.ideas }])) });
	return (
		<li className="rounded-lg border p-3" data-testid="suggestion">
			<div className="mb-2 truncate text-xs text-muted-foreground">{file?.fileName}</div>
			{draft.map((t, i) => (
				<div key={i} className="mb-3 last:mb-0">
					<div className="flex flex-wrap items-center gap-2">
						<select value={t.topicId} onChange={(e) => update(i, { topicId: e.target.value })} aria-label="Topic" className={`${input} text-xs`}>
							<option value="">New topic:</option>
							{topics.map((x) => <option key={x.id} value={x.id}>Existing: {x.name}</option>)}
						</select>
						{!t.topicId && <input value={t.name} onChange={(e) => update(i, { name: e.target.value })} aria-label="Topic name" maxLength={80} className={`${input} flex-1 font-medium`} />}
						<span className="text-xs text-muted-foreground">pages {s.topics[i]!.pages.from}–{s.topics[i]!.pages.to}</span>
					</div>
					{s.topics[i]!.summary && <p className="mt-1 text-xs text-muted-foreground">{s.topics[i]!.summary}</p>}
					<div className="mt-1.5 flex flex-wrap items-center gap-1" data-testid="suggested-ideas">
						{t.ideas.map((idea, k) => (
							<span key={k} title={idea.summary} className={chip}>
								<input value={idea.name} onChange={(e) => update(i, { ideas: t.ideas.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} aria-label="Idea name" className="w-[9ch] min-w-0 bg-transparent outline-none" style={{ width: `${Math.max(6, idea.name.length + 1)}ch` }} />
								<button type="button" aria-label={`Remove ${idea.name}`} onClick={() => update(i, { ideas: t.ideas.filter((_, j) => j !== k) })} className="text-muted-foreground hover:text-destructive"><XIcon className="size-3" /></button>
							</span>
						))}
						<form className="inline-flex" onSubmit={(e) => { e.preventDefault(); const v = (adding[i] ?? "").trim(); if (v) { update(i, { ideas: [...t.ideas, { name: v, summary: "" }] }); setAdding((a) => ({ ...a, [i]: "" })); } }}>
							<input value={adding[i] ?? ""} onChange={(e) => setAdding((a) => ({ ...a, [i]: e.target.value }))} placeholder="+ idea" aria-label="Add an idea" className="h-6 w-24 rounded-full border border-dashed bg-transparent px-2 text-[11px] outline-none focus-visible:border-ring" />
						</form>
					</div>
				</div>
			))}
			<div className="mt-2 flex gap-2">
				<button type="button" disabled={busy || draft.some((t) => !t.topicId && !t.name.trim())} data-testid="accept-suggestion" onClick={() => void accept()} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"><CheckIcon className="size-3.5" />Accept</button>
				<button type="button" disabled={busy} data-testid="dismiss-suggestion" onClick={() => void run({ action: "dismiss-suggestion", id: s.id })} className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs hover:bg-accent disabled:opacity-50"><XIcon className="size-3.5" />Dismiss</button>
			</div>
		</li>
	);
}

export function SuggestionsCard({ library, subjectId, act }: { library: Library; subjectId: string; act: Act }) {
	const list = suggestionsIn(library, subjectId);
	if (!list.length) return null;
	return (
		<section className="mt-4 rounded-xl border border-primary/40 bg-card p-4" data-testid="suggestions-card">
			<h2 className="mb-1 flex items-center gap-1.5 text-sm font-medium"><LightbulbIcon className="size-4 text-primary" />Suggested topics</h2>
			<p className="mb-3 text-xs text-muted-foreground">From the files you added. Change the topic (or pick an existing one), edit the ideas, then accept: the file moves into the topic.</p>
			<ul className="flex flex-col gap-3">{list.map((s) => <SuggestionEditor key={s.id} library={library} subjectId={subjectId} s={s} act={act} />)}</ul>
		</section>
	);
}

/** Choose a file's topic yourself: an existing topic, or a new one by name. */
export function PutInTopic({ library, subjectId, materialId, act, onDone }: { library: Library; subjectId: string; materialId: string; act: Act; onDone: () => void }) {
	const topics = topicsOf(library, subjectId);
	const [topicId, setTopicId] = useState(topics[0]?.id ?? "");
	const [name, setName] = useState("");
	return (
		<form className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid="put-in-topic" onSubmit={(e) => { e.preventDefault(); void act({ action: "assign-material", id: materialId, ...(topicId ? { topicId } : { newTopicName: name }) }).then(onDone); }}>
			<select value={topicId} onChange={(e) => setTopicId(e.target.value)} aria-label="Topic" className={`${input} text-xs`}>
				{topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
				<option value="">New topic…</option>
			</select>
			{!topicId && <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Topic name" maxLength={80} aria-label="New topic name" className={`${input} w-48`} />}
			<button type="submit" disabled={!topicId && !name.trim()} className="h-7 rounded-md bg-primary px-3 font-medium text-primary-foreground disabled:opacity-50">Move here</button>
			<button type="button" onClick={onDone} className="h-7 rounded-md border px-2 hover:bg-accent">Cancel</button>
			<span className="basis-full text-muted-foreground">The file moves into the topic and its ideas are found for it (you can edit them after).</span>
		</form>
	);
}

export function IdeasSection({ library, subjectId, topicId, chatTitles, act }: { library: Library; subjectId: string; topicId?: string; chatTitles: ReadonlyMap<string, string>; act: Act }) {
	const ideas = ideasOf(library, { subjectId, ...(topicId ? { topicId } : {}) });
	const [editing, setEditing] = useState<string | null>(null);
	const [draft, setDraft] = useState({ name: "", summary: "" });
	const [newIdea, setNewIdea] = useState("");
	const scope = { subjectId, ...(topicId ? { topicId } : {}) };
	if (!ideas.length && !topicId) return null;
	return (
		<section className="mt-6" data-testid="ideas-section">
			<h2 className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">{topicId ? "Key ideas" : "Ideas across the subject"}</h2>
			<ul className="flex flex-col gap-1.5">
				{ideas.map((i) => (
					<li key={i.id} className="group rounded-lg border px-3 py-2 text-sm">
						{editing === i.id ? (
							<form className="flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); void act({ action: "edit-idea", ...scope, id: i.id, name: draft.name, summary: draft.summary }).then(() => setEditing(null)); }}>
								<input autoFocus value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} aria-label="Idea name" maxLength={60} className={`${input} font-medium`} />
								<input value={draft.summary} onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))} aria-label="What it means" placeholder="What it means (one line)" maxLength={240} className={`${input} text-xs`} />
								<div className="flex gap-2"><button type="submit" className="h-7 rounded-md bg-primary px-3 text-xs text-primary-foreground">Save</button><button type="button" onClick={() => setEditing(null)} className="h-7 rounded-md border px-2 text-xs">Cancel</button></div>
							</form>
						) : (
							<>
								<div className="flex items-start gap-2">
									<div className="min-w-0 flex-1 font-medium">{i.name}</div>
									<button type="button" aria-label={`Edit ${i.name}`} onClick={() => { setEditing(i.id); setDraft({ name: i.name, summary: i.summary }); }} className="rounded p-1 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100 focus-visible:opacity-100"><PencilIcon className="size-3.5" /></button>
									<button type="button" aria-label={`Remove ${i.name}`} onClick={() => void act({ action: "remove-idea", ...scope, id: i.id })} className="rounded p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"><Trash2Icon className="size-3.5" /></button>
								</div>
								{i.summary && <div className="text-xs text-muted-foreground">{i.summary}</div>}
								{(i.files.length > 0 || i.chats.length > 0) && (
									<div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
										{i.files.map((f) => { const m = library.materials.find((x) => x.id === f.materialId); return m ? <span key={f.materialId} className="text-muted-foreground">{m.fileName}{f.pages ? ` · p. ${f.pages}` : ""}</span> : null; })}
										{i.chats.map((c) => <Link key={c} href={`/chat/${c}`} className="text-primary hover:underline">{chatTitles.get(c) ?? "Chat"}</Link>)}
									</div>
								)}
							</>
						)}
					</li>
				))}
			</ul>
			<form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newIdea.trim()) void act({ action: "add-idea", ...scope, name: newIdea }).then(() => setNewIdea("")); }}>
				<input value={newIdea} onChange={(e) => setNewIdea(e.target.value)} placeholder="Add an idea" aria-label="Add an idea" maxLength={60} className={`${input} h-8 flex-1`} />
				<button type="submit" disabled={!newIdea.trim()} className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs hover:bg-accent disabled:opacity-50"><PlusIcon className="size-3.5" />Add</button>
			</form>
		</section>
	);
}
