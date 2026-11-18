"use client";

/**
 * The subject page and the topic page (Study overhaul, owner 2026-11-19). One component, two scopes:
 *   - SUBJECT: its topics (add / open), subject-wide materials, its chats;
 *   - TOPIC: topic-wide materials, its chats.
 * Materials are PDFs uploaded into the scope (a file already stored is referenced, never copied again; slides in other
 * formats must be exported to PDF first). The running context the agent keeps for the scope is shown read-only.
 * "New chat here" opens Home with this subject/topic preselected.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileTextIcon, MessageSquarePlusIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { materialsIn, subjectOf, topicOf, topicsOf, type Library, type Material } from "@/src/core/study/model";
import type { ChatListItem } from "@/src/core";
import { LAST_CHOICE_KEY } from "./placement";
import { groupChats } from "./group-chats";

const fmtBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

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
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [newTopic, setNewTopic] = useState("");
	const [renaming, setRenaming] = useState(false);
	const [nameDraft, setNameDraft] = useState("");
	const [dragging, setDragging] = useState(false);
	const picker = useRef<HTMLInputElement>(null);

	const load = useCallback(async () => {
		try {
			const [lib, list] = await Promise.all([
				fetch("/api/study/library", { cache: "no-store" }).then((r) => r.json() as Promise<{ library: Library }>),
				fetch("/api/chats", { cache: "no-store" }).then((r) => r.json() as Promise<{ chats: ChatListItem[] }>),
			]);
			setLibrary(lib.library); setChats(list.chats);
		} catch { setMessage("Could not load this page."); }
	}, []);
	useEffect(() => { void load(); }, [load]);

	if (!library) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
	const subject = subjectOf(library, subjectId);
	const topic = topicId ? topicOf(library, topicId) : undefined;
	if (!subject || (topicId && (!topic || topic.subjectId !== subjectId))) {
		return <div className="p-6 text-sm"><p>That {topicId ? "topic" : "subject"} no longer exists.</p><Link href="/" className="mt-2 inline-block underline">Back to home</Link></div>;
	}
	const scope = topic ? { subjectId, topicId: topic.id } : { subjectId };
	const title = topic?.name ?? subject.name;
	const files: Material[] = materialsIn(library, scope);
	const grouped = groupChats(library, chats);
	const group = grouped.subjects.find((g) => g.subject.id === subjectId);
	const here = topic ? group?.topics.find((t) => t.topic.id === topic.id)?.chats ?? [] : group?.chats ?? [];
	const context = (topic ?? subject).context;

	const upload = async (list: FileList | File[]) => {
		const pdfs = Array.from(list).filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
		if (!pdfs.length) { setMessage("Only PDF files can be added. Export slides (PowerPoint, Keynote) to PDF first."); return; }
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

	const section = "mt-6";
	const h = "mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground";
	const btn = "inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs transition-colors hover:bg-accent disabled:opacity-50";
	return (
		<div className="flex h-dvh min-w-0 flex-col">
			<TopBar>
				<div className="min-w-0 flex-1">
					{topic && <Link href={`/subjects/${subject.id}`} className="block truncate text-xs text-muted-foreground hover:text-foreground">{subject.name}</Link>}
					{renaming ? (
						<form onSubmit={(e) => { e.preventDefault(); void run({ action: topic ? "rename-topic" : "rename-subject", id: topic?.id ?? subject.id, name: nameDraft }, () => setRenaming(false)); }}>
							<input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={() => setRenaming(false)} onKeyDown={(e) => { if (e.key === "Escape") setRenaming(false); }} aria-label="Name" maxLength={120} className="w-full bg-transparent font-title text-3xl tracking-tight outline-none" />
						</form>
					) : (
						<h1 className="truncate font-title text-3xl tracking-tight"><button type="button" onClick={() => { setNameDraft(title); setRenaming(true); }} title="Rename" className="max-w-full truncate rounded-md px-1.5 -mx-1.5 text-left hover:bg-accent">{title}</button></h1>
					)}
				</div>
				<button type="button" className={btn} onClick={newChatHere} data-testid="new-chat-here"><MessageSquarePlusIcon className="size-3.5" />New chat here</button>
			</TopBar>
			<div
				className="relative min-h-0 flex-1 overflow-y-auto"
				onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
				onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
				onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files); } }}
			>
				<div className="mx-auto w-full max-w-3xl px-5 pb-16 pt-4">
					{message && <p role="status" className="mb-3 rounded-md border bg-card px-3 py-2 text-xs">{message}</p>}

					{!topic && (
						<section className={section} data-testid="topics-section">
							<h2 className={h}>Topics</h2>
							<ul className="flex flex-col gap-1">
								{topicsOf(library, subjectId).map((t) => (
									<li key={t.id}>
										<Link href={`/subjects/${subjectId}/${t.id}`} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-accent/60">
											<span className="truncate">{t.name}</span>
											<span className="shrink-0 text-xs text-muted-foreground">{materialsIn(library, { subjectId, topicId: t.id }).length} files</span>
										</Link>
									</li>
								))}
								{topicsOf(library, subjectId).length === 0 && <li className="text-sm text-muted-foreground">No topics yet. A topic groups one part of the subject: its files, notes and chats.</li>}
							</ul>
							<form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newTopic.trim()) void run({ action: "create-topic", subjectId, name: newTopic }, () => setNewTopic("")); }}>
								<input value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="New topic" aria-label="New topic name" maxLength={120} className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring" />
								<button type="submit" disabled={!newTopic.trim()} className={btn}>Add topic</button>
							</form>
						</section>
					)}

					<section className={section} data-testid="materials-section">
						<h2 className={h}>{topic ? "Topic files" : "Subject-wide files"}</h2>
						<p className="mb-2 text-xs text-muted-foreground">{topic ? "PDFs here give the agent topic-wide context." : "PDFs here give the agent context across every topic of the subject."} Drop PDFs anywhere on this page.</p>
						<ul className="flex flex-col gap-1">
							{files.map((m) => (
								<li key={m.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
									<FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
									<span className="min-w-0 flex-1 truncate">{m.fileName}</span>
									<span className="shrink-0 text-xs text-muted-foreground">{m.pageCount} pages · {fmtBytes(m.bytes)}</span>
									<button type="button" aria-label={`Remove ${m.fileName}`} title="Remove" onClick={() => void run({ action: "remove-material", id: m.id })} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"><Trash2Icon className="size-3.5" /></button>
								</li>
							))}
							{files.length === 0 && <li className="text-sm text-muted-foreground">No files yet.</li>}
						</ul>
						<input ref={picker} type="file" accept=".pdf,application/pdf" multiple hidden data-testid="material-input" onChange={(e) => { const list = e.currentTarget.files; if (list?.length) void upload(list); e.currentTarget.value = ""; }} />
						<button type="button" disabled={busy} onClick={() => picker.current?.click()} className={`${btn} mt-2`} data-testid="add-material"><UploadIcon className="size-3.5" />{busy ? "Uploading…" : "Add PDFs"}</button>
					</section>

					{context.trim() && (
						<section className={section} data-testid="context-section">
							<h2 className={h}>What the agent knows here</h2>
							<p className="whitespace-pre-wrap rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">{context}</p>
						</section>
					)}

					<section className={section} data-testid="chats-section">
						<h2 className={h}>Chats</h2>
						<ul className="flex flex-col gap-1">
							{here.map((c) => (
								<li key={c.id}><Link href={`/chat/${c.id}`} className="block truncate rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-accent/60">{c.title}</Link></li>
							))}
							{here.length === 0 && <li className="text-sm text-muted-foreground">No chats here yet.</li>}
						</ul>
					</section>

					<section className={`${section} border-t pt-4`}>
						<button
							type="button"
							className={`${btn} text-destructive`}
							onClick={() => {
								const what = topic ? `the topic “${topic.name}”` : `the subject “${subject.name}” with all its topics`;
								if (!confirm(`Delete ${what}, its files and notes? Chats are kept but become unfiled. This cannot be undone.`)) return;
								void run({ action: topic ? "delete-topic" : "delete-subject", id: topic?.id ?? subject.id }, () => router.push(topic ? `/subjects/${subjectId}` : "/"));
							}}
						>
							<Trash2Icon className="size-3.5" />Delete {topic ? "topic" : "subject"}
						</button>
					</section>
				</div>
				{dragging && <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/85 text-sm">Drop PDFs to add them to {title}</div>}
			</div>
		</div>
	);
}

