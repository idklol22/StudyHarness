"use client";

/**
 * The subject page and the topic page (Study overhaul, owner 2026-11-19; tabs, Round 5). One component, two scopes:
 *   - SUBJECT: a compact map, then topics / files / notes / flashcards / chats / knowledge;
 *   - TOPIC: files / ideas / notes / flashcards / chats / knowledge (no map).
 * The header handles rename, colour, "New chat here", "Create notes", "Add files" and delete. Tabs remember their
 * place in the URL hash; upload still works by dropping files anywhere on the page or attaching them in a chat.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EllipsisIcon, MessageSquarePlusIcon, SparklesIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { materialsIn, materialsUnder, subjectOf, topicOf, topicsOf, type Library, type Material } from "@/src/core";
import type { ChatListItem } from "@/src/core";
import { LAST_CHOICE_KEY } from "./placement";
import { groupChats } from "./group-chats";
import { IdeasSection } from "./suggestions-card";
import { FilesTable } from "./files-table";
import { ScopeTabs, tabFromHash } from "./scope-tabs";
import { SubjectColor } from "./subject-color";
import { SubjectMap } from "./subject-map";
import { useServerEvent } from "@/components/server-events";
import { NotesPanel } from "./notes-view";
import { CardsPanel } from "./cards-panel";

const SUBJECT_TABS = [
	{ id: "topics", label: "Topics" },
	{ id: "files", label: "Files" },
	{ id: "notes", label: "Notes" },
	{ id: "flashcards", label: "Flashcards" },
	{ id: "chats", label: "Chats" },
	{ id: "knowledge", label: "Knowledge" },
] as const;
const TOPIC_TABS = [
	{ id: "files", label: "Files" },
	{ id: "ideas", label: "Ideas" },
	{ id: "notes", label: "Notes" },
	{ id: "flashcards", label: "Flashcards" },
	{ id: "chats", label: "Chats" },
	{ id: "knowledge", label: "Knowledge" },
] as const;
const ALL_TABS: readonly string[] = [...SUBJECT_TABS.map((t) => t.id), ...TOPIC_TABS.map((t) => t.id)];

interface NotebookCover { id: string; title: string; scopeName: string; href: string; topicId?: string; covers?: Array<{ materialId: string; from: number; to: number }> }

const fmtDate = (value: string) => {
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
};

async function act(body: unknown): Promise<{ library?: Library; error?: string }> {
	try {
		const res = await fetch("/api/study/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
		return await res.json() as { library?: Library; error?: string };
	} catch { return { error: "Could not reach the app." }; }
}

export function ScopePage({ subjectId, topicId }: { subjectId: string; topicId?: string }) {
	const router = useRouter();
	const [library, setLibrary] = useState<Library | null>(null);
	const [chats, setChats] = useState<ChatListItem[]>([]);
	const [notebooks, setNotebooks] = useState<NotebookCover[]>([]);
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [newTopic, setNewTopic] = useState("");
	const [renaming, setRenaming] = useState(false);
	const [nameDraft, setNameDraft] = useState("");
	const [dragging, setDragging] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [activeTab, setActiveTab] = useState(() => tabFromHash(typeof window === "undefined" ? "" : window.location.hash, ALL_TABS, topicId ? "files" : "topics"));
	// A header action can ask a tab to open something (the notes composer / the file picker) once it is visible.
	const [notesTrigger, setNotesTrigger] = useState(false);
	const [filesTrigger, setFilesTrigger] = useState(false);
	const picker = useRef<HTMLInputElement>(null);
	const notesWrap = useRef<HTMLDivElement>(null);

	const load = useCallback(async () => {
		try {
			const [lib, list, cov] = await Promise.all([
				fetch("/api/study/library", { cache: "no-store" }).then((r) => r.json() as Promise<{ library: Library }>),
				fetch("/api/chats", { cache: "no-store" }).then((r) => r.json() as Promise<{ chats: ChatListItem[] }>),
				fetch(`/api/study/notes?view=coverage&subjectId=${encodeURIComponent(subjectId)}`).then((r) => r.json() as Promise<{ notebooks?: NotebookCover[] }>).catch(() => ({ notebooks: [] as NotebookCover[] })),
			]);
			setLibrary(lib.library); setChats(list.chats); setNotebooks(cov.notebooks ?? []);
		} catch { setMessage("Could not load this page."); }
	}, [subjectId]);
	useEffect(() => { void load(); }, [load]);
	// Background work (files understood, topics suggested, ideas added) lands here without a reload.
	useServerEvent("sources-changed", () => { void load(); });

	useEffect(() => {
		if (activeTab !== "notes" || !notesTrigger) return;
		// NotesPanel owns its composer; pressing its own button is the way in without coupling the two components.
		notesWrap.current?.querySelector<HTMLButtonElement>('[data-testid="generate-notes"]')?.click();
		setNotesTrigger(false);
	}, [activeTab, notesTrigger]);
	useEffect(() => {
		if (activeTab !== "files" || !filesTrigger) return;
		picker.current?.focus();
		picker.current?.click();
		setFilesTrigger(false);
	}, [activeTab, filesTrigger]);

	if (!library) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
	const subject = subjectOf(library, subjectId);
	const topic = topicId ? topicOf(library, topicId) : undefined;
	if (!subject || (topicId && (!topic || topic.subjectId !== subjectId))) {
		return <div className="p-6 text-sm"><p>That {topicId ? "topic" : "subject"} no longer exists.</p><Link href="/" className="mt-2 inline-block underline">Back to home</Link></div>;
	}
	const scope = topic ? { subjectId, topicId: topic.id } : { subjectId };
	const title = topic?.name ?? subject.name;
	const files: Material[] = materialsUnder(library, scope);
	const grouped = groupChats(library, chats);
	const group = grouped.subjects.find((g) => g.subject.id === subjectId);
	// A subject lists its own chats and every topic's (tagged); a topic lists its own.
	const here: Array<{ chat: ChatListItem; topicName: string }> = topic
		? (group?.topics.find((t) => t.topic.id === topic.id)?.chats ?? []).map((chat) => ({ chat, topicName: "" }))
		: [...(group?.chats ?? []).map((chat) => ({ chat, topicName: "" })), ...(group?.topics ?? []).flatMap((t) => t.chats.map((chat) => ({ chat, topicName: t.topic.name })))];
	const context = (topic ?? subject).context;
	const tabs = topic ? TOPIC_TABS : SUBJECT_TABS;
	const active = tabs.some((t) => t.id === activeTab) ? activeTab : topic ? "files" : "topics";

	const upload = async (list: FileList | File[]) => {
		const pdfs = Array.from(list).filter((f) => /\.(pdf|md|markdown|txt)$/i.test(f.name) || f.type === "application/pdf");
		if (!pdfs.length) { setMessage("Only PDF, Markdown (.md) and text (.txt) files can be added. Export slides (PowerPoint, Keynote) to PDF first."); return; }
		setBusy(true); setMessage("");
		const body = new FormData();
		body.set("subjectId", subjectId);
		if (topic) body.set("topicId", topic.id);
		for (const f of pdfs) body.append("files", f, f.name);
		try {
			const res = await fetch("/api/study/materials", { method: "POST", body });
			const data = await res.json() as { library?: Library; errors?: Array<{ fileName: string; error: string }>; error?: string; materials?: Array<{ alreadyStored: boolean; created: boolean }> };
			if (data.library) setLibrary(data.library);
			const errors = data.errors?.map((e) => `${e.fileName}: ${e.error}`) ?? (data.error ? [data.error] : []);
			const same = data.materials?.filter((m) => !m.created).length ?? 0;
			setMessage([...errors, same ? `${same} file${same === 1 ? " was" : "s were"} already here.` : ""].filter(Boolean).join(" "));
		} catch { setMessage("Could not upload."); }
		setBusy(false);
	};
	const run = async (body: unknown, after?: (lib: Library) => void) => {
		const r = await act(body);
		if (r.error || !r.library) { setMessage(r.error ?? "That did not work."); return; }
		setLibrary(r.library); setMessage(""); after?.(r.library);
	};
	const newChatHere = () => {
		try { localStorage.setItem(LAST_CHOICE_KEY, JSON.stringify({ subjectId, topicId: topic?.id ?? "" })); } catch { /* best-effort */ }
		router.push("/");
	};
	const createNotes = () => { setNotesTrigger(true); setActiveTab("notes"); };
	const addFiles = () => { setFilesTrigger(true); setActiveTab("files"); };
	const deleteScope = () => {
		setMenuOpen(false);
		const what = topic ? `the topic “${topic.name}”` : `the subject “${subject.name}” with all its topics`;
		if (!confirm(`Delete ${what}, its files and notes? Chats are kept but become unfiled. This cannot be undone.`)) return;
		void run({ action: topic ? "delete-topic" : "delete-subject", id: topic?.id ?? subject.id }, () => router.push(topic ? `/subjects/${subjectId}` : "/"));
	};

	const section = "mt-6";
	const h = "mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground";
	const btn = "inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs transition-colors hover:bg-accent disabled:opacity-50";
	return (
		<div className="flex h-dvh min-w-0 flex-col">
			<TopBar>
				<div className="flex min-w-0 flex-1 items-center gap-2">
					{topic && <Link href={`/subjects/${subject.id}`} className="block truncate text-xs text-muted-foreground hover:text-foreground">{subject.name}</Link>}
					<div className="min-w-0 flex-1">
						{renaming ? (
							<form onSubmit={(e) => { e.preventDefault(); void run({ action: topic ? "rename-topic" : "rename-subject", id: topic?.id ?? subject.id, name: nameDraft }, () => setRenaming(false)); }}>
								<input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={() => setRenaming(false)} onKeyDown={(e) => { if (e.key === "Escape") setRenaming(false); }} aria-label="Name" maxLength={120} className="w-full bg-transparent font-title text-3xl tracking-tight outline-none" />
							</form>
						) : (
							<h1 className="truncate font-title text-3xl tracking-tight"><button type="button" onClick={() => { setNameDraft(title); setRenaming(true); }} title="Rename" className="max-w-full truncate rounded-md px-1.5 -mx-1.5 text-left hover:bg-accent">{title}</button></h1>
						)}
					</div>
					{!topic && <SubjectColor subjectId={subjectId} color={subject.color} name={subject.name} onChanged={() => { void load(); }} />}
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<button type="button" className={btn} onClick={newChatHere} data-testid="new-chat-here"><MessageSquarePlusIcon className="size-3.5" />New chat here</button>
					<button type="button" className={btn} onClick={createNotes} data-testid="create-notes"><SparklesIcon className="size-3.5" />Create notes</button>
					<button type="button" className={btn} onClick={addFiles} data-testid="header-add-files"><UploadIcon className="size-3.5" />Add files</button>
					<div className="relative">
						<button type="button" aria-label="More actions" aria-expanded={menuOpen} data-testid="scope-more" onClick={() => setMenuOpen((o) => !o)} className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><EllipsisIcon className="size-4" /></button>
						{menuOpen && (
							<div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-lg border bg-card p-1 text-xs shadow-lg">
								<button type="button" onClick={deleteScope} data-testid="delete-scope" className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-destructive hover:bg-accent"><Trash2Icon className="size-3.5" />Delete {topic ? "topic" : "subject"}</button>
							</div>
						)}
					</div>
				</div>
			</TopBar>
			<div
				className="relative min-h-0 flex-1 overflow-y-auto"
				onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
				onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
				onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files); } }}
			>
				<div className="mx-auto w-full max-w-5xl px-5 pb-16 pt-4">
					{message && <p role="status" className="mb-3 rounded-md border bg-card px-3 py-2 text-xs">{message}</p>}

					{!topic && ((subject.ideas?.length ?? 0) > 0 || topicsOf(library, subjectId).length > 0) && (
						<section className="mb-1" data-testid="subject-map-section">
							<h2 className={h}>Map of {subject.name}</h2>
							<div className="relative h-[360px] w-full overflow-hidden rounded-xl border bg-card/40"><SubjectMap subjectId={subjectId} compact /></div>
						</section>
					)}

					<ScopeTabs tabs={tabs} active={active} onChange={setActiveTab} />

					<div className="mt-2" data-testid="scope-content">
						{active === "topics" && !topic && (
							<section className={section} data-testid="topics-section">
								<h2 className={h}>Topics</h2>
								<ul className="flex flex-col gap-1">
									{topicsOf(library, subjectId).map((t) => {
										const tFiles = materialsIn(library, { subjectId, topicId: t.id }).length;
										const tIdeas = t.ideas?.length ?? 0;
										const tNotes = notebooks.filter((n) => n.topicId === t.id).length;
										const lastChat = group?.topics.find((gt) => gt.topic.id === t.id)?.chats[0];
										return (
											<li key={t.id} className="rounded-lg border transition-colors hover:bg-accent/40">
													<Link href={`/subjects/${subjectId}/${t.id}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
														<span className="min-w-0 truncate font-medium">{t.name}</span>
														<span className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
															<span>{tFiles} files</span><span>{tIdeas} ideas</span><span>{tNotes} notes</span>
															<span>{lastChat ? `Chat · ${fmtDate(lastChat.updatedAt)}` : "No chats yet"}</span>
														</span>
													</Link>
													{tIdeas > 0 && (
														<div className="flex flex-wrap gap-1 px-3 pb-2" data-testid="topic-ideas">
															{(t.ideas ?? []).slice(0, 8).map((i) => <Link key={i.id} href={`/subjects/${subjectId}/${t.id}#ideas`} title={i.summary} className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">{i.name}</Link>)}
															{tIdeas > 8 && <Link href={`/subjects/${subjectId}/${t.id}#ideas`} className="px-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">+{tIdeas - 8} more</Link>}
														</div>
													)}
												</li>
										);
									})}
									{topicsOf(library, subjectId).length === 0 && <li className="text-sm text-muted-foreground">No topics yet. A topic groups one part of the subject: its files, notes and chats.</li>}
								</ul>
								<form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newTopic.trim()) void run({ action: "create-topic", subjectId, name: newTopic }, () => setNewTopic("")); }}>
									<input value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="New topic" aria-label="New topic name" maxLength={120} className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring" />
									<button type="submit" disabled={!newTopic.trim()} className={btn}>Add topic</button>
								</form>
							</section>
						)}

						{active === "files" && (
							<section className={section} data-testid="materials-section">
								<h2 className={h}>{topic ? "Topic files" : "Subject files"}</h2>
								<p className="mb-1 text-xs text-muted-foreground">{topic ? "Files here give the agent topic-wide context, and also appear in the subject's files." : "Everything in the subject: files added here are subject-wide, and every topic's files are listed too."} Drop PDF, Markdown or text files anywhere on this page, or attach them in a chat.</p>
								<FilesTable
									library={library}
									subjectId={subjectId}
									files={files}
									topicPage={!!topic}
									act={async (body) => { await run(body); }}
									onMessage={setMessage}
									onAddFiles={addFiles}
									onDropFiles={(list) => { void upload(list); }}
									busy={busy}
								/>
								<input ref={picker} type="file" accept=".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain" multiple hidden data-testid="material-input" onChange={(e) => { const list = e.currentTarget.files; if (list?.length) void upload(list); e.currentTarget.value = ""; }} />
							</section>
						)}

						{active === "ideas" && topic && (
							<IdeasSection library={library} subjectId={subjectId} topicId={topic.id} chatTitles={new Map(chats.map((c) => [c.id, c.title]))} act={async (body) => { await run(body); }} />
						)}

						{active === "notes" && (
							<div ref={notesWrap} className={section}>
								<NotesPanel subjectId={subjectId} topicId={topicId} label={title} files={topic ? [...materialsIn(library, scope), ...materialsIn(library, { subjectId })] : files} chats={here.map(({ chat }) => ({ id: chat.id, title: chat.title }))} />
							</div>
						)}

						{active === "flashcards" && <div className={section}><CardsPanel subjectId={subjectId} topicId={topicId} /></div>}

						{active === "chats" && (
							<section className={section} data-testid="chats-section">
								<h2 className={h}>Chats</h2>
								<ul className="flex flex-col gap-1">
									{here.map(({ chat: c, topicName }) => (
										<li key={c.id}><Link href={`/chat/${c.id}`} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-accent/60"><span className="min-w-0 flex-1 truncate">{c.title}</span>{topicName && <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">{topicName}</span>}</Link></li>
									))}
									{here.length === 0 && <li className="text-sm text-muted-foreground">No chats here yet.</li>}
								</ul>
							</section>
						)}

						{active === "knowledge" && (
							<>
								<IdeasSection library={library} subjectId={subjectId} topicId={topic?.id} chatTitles={new Map(chats.map((c) => [c.id, c.title]))} act={async (body) => { await run(body); }} />
								<section className={section} data-testid="context-section">
									<details className="group rounded-lg border bg-card">
										<summary className="cursor-pointer px-3 py-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">What the agent knows here</summary>
										<pre className="whitespace-pre-wrap border-t px-3 py-2 font-sans text-sm text-muted-foreground">{context.trim() || "Nothing recorded here yet."}</pre>
									</details>
								</section>
							</>
						)}
					</div>
				</div>
				{dragging && <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/85 text-sm">Drop files to add them to {title}</div>}
			</div>
		</div>
	);
}
