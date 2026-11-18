"use client";

/**
 * The sidebar's Subjects tree (Study overhaul, owner 2026-11-19): Subject → Topics → chats, with "+ Subject" and
 * per-subject "+ topic" inline. Subject and topic names open their pages; chevrons collapse (remembered per device).
 * Chats are rendered by the caller (so rows keep the sidebar's rename/context-menu behavior).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { emptyLibrary, type Library } from "@/src/core/study/model";
import type { ChatLike, Grouped } from "./group-chats";

const COLLAPSED_KEY = "lh.sidebar.collapsed.v1";

function useCollapsed(): [ReadonlySet<string>, (id: string) => void] {
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
	useEffect(() => {
		try { const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]") as unknown; if (Array.isArray(raw)) setCollapsed(new Set(raw.filter((v): v is string => typeof v === "string"))); } catch { /* none */ }
	}, []);
	const toggle = useCallback((id: string) => setCollapsed((cur) => {
		const next = new Set(cur);
		if (next.has(id)) next.delete(id); else next.add(id);
		try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])); } catch { /* best-effort */ }
		return next;
	}), []);
	return [collapsed, toggle];
}

/** The library for the sidebar; the caller refetches on `sources-changed`. */
export function useLibrary(): { library: Library; refresh: () => void } {
	const [library, setLibrary] = useState<Library>(emptyLibrary());
	const refresh = useCallback(() => {
		void fetch("/api/study/library", { cache: "no-store" }).then((r) => r.json() as Promise<{ library?: Library }>).then((d) => { if (d.library) setLibrary(d.library); }).catch(() => {});
	}, []);
	useEffect(() => { refresh(); }, [refresh]);
	return { library, refresh };
}

async function act(body: unknown): Promise<void> {
	await fetch("/api/study/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
}

function InlineAdd({ placeholder, onAdd, onCancel }: { placeholder: string; onAdd: (name: string) => void; onCancel: () => void }) {
	const [name, setName] = useState("");
	return (
		<form
			onSubmit={(e) => { e.preventDefault(); if (name.trim()) onAdd(name.trim()); }}
			className="px-2 py-1"
		>
			<input
				autoFocus
				value={name}
				maxLength={120}
				aria-label={placeholder}
				placeholder={placeholder}
				onChange={(e) => setName(e.target.value)}
				onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}
				onBlur={() => { if (!name.trim()) onCancel(); }}
				className="h-6 w-full rounded-sm border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring"
			/>
		</form>
	);
}

export function SubjectTree<C extends ChatLike>({
	grouped,
	renderChat,
	onChanged,
	pathname,
}: {
	grouped: Grouped<C>;
	renderChat: (chat: C) => React.ReactNode;
	onChanged: () => void;
	pathname: string;
}) {
	const [collapsed, toggle] = useCollapsed();
	const [adding, setAdding] = useState<"" | "subject" | string>(""); // "subject" or a subject id (new topic)
	const done = () => { setAdding(""); onChanged(); };
	const heading = "flex items-center gap-1 rounded-md px-1 py-1 text-xs";
	return (
		<div data-testid="subject-tree" className="flex flex-col gap-0.5">
			<div className="flex items-center justify-between px-2 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground/70">
				<span>Subjects</span>
				<button type="button" aria-label="New subject" title="New subject" data-testid="add-subject" onClick={() => setAdding("subject")} className="rounded p-0.5 hover:bg-accent hover:text-foreground"><PlusIcon className="size-3" /></button>
			</div>
			{adding === "subject" && <InlineAdd placeholder="New subject name" onCancel={() => setAdding("")} onAdd={(name) => void act({ action: "create-subject", name }).then(done)} />}
			{grouped.subjects.length === 0 && adding !== "subject" && (
				<p className="px-2 py-2 text-xs text-muted-foreground">No subjects yet. Add one with +, or pick “New subject” when you start a chat.</p>
			)}
			{grouped.subjects.map(({ subject, chats, topics }) => {
				const open = !collapsed.has(subject.id);
				const subjectActive = pathname === `/subjects/${subject.id}`;
				return (
					<div key={subject.id} data-testid={`subject-${subject.id}`}>
						<div className={`${heading} group ${subjectActive ? "bg-accent text-foreground" : "text-foreground/90 hover:bg-accent/60"}`}>
							<button type="button" aria-expanded={open} aria-label={open ? `Collapse ${subject.name}` : `Expand ${subject.name}`} onClick={() => toggle(subject.id)} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
								<ChevronRightIcon className={`size-3 transition-transform ${open ? "rotate-90" : ""}`} />
							</button>
							<Link href={`/subjects/${subject.id}`} className="min-w-0 flex-1 truncate font-medium">{subject.name}</Link>
							<button type="button" aria-label={`New topic in ${subject.name}`} title="New topic" onClick={() => setAdding(subject.id)} className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"><PlusIcon className="size-3" /></button>
						</div>
						{open && (
							<div className="ml-3 flex flex-col gap-0.5 border-l border-border/60 pl-1.5">
								{adding === subject.id && <InlineAdd placeholder="New topic name" onCancel={() => setAdding("")} onAdd={(name) => void act({ action: "create-topic", subjectId: subject.id, name }).then(done)} />}
								{chats.map((c) => renderChat(c))}
								{topics.map(({ topic, chats: topicChats }) => {
									const topicOpen = !collapsed.has(topic.id);
									const topicActive = pathname === `/subjects/${subject.id}/${topic.id}`;
									return (
										<div key={topic.id} data-testid={`topic-${topic.id}`}>
											<div className={`${heading} ${topicActive ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}>
												<button type="button" aria-expanded={topicOpen} aria-label={topicOpen ? `Collapse ${topic.name}` : `Expand ${topic.name}`} onClick={() => toggle(topic.id)} className="rounded p-0.5 hover:text-foreground">
													<ChevronRightIcon className={`size-3 transition-transform ${topicOpen ? "rotate-90" : ""}`} />
												</button>
												<Link href={`/subjects/${subject.id}/${topic.id}`} className="min-w-0 flex-1 truncate">{topic.name}</Link>
												{topicChats.length > 0 && <span className="text-[10px] tabular-nums">{topicChats.length}</span>}
											</div>
											{topicOpen && topicChats.length > 0 && <div className="ml-3 flex flex-col gap-0.5 border-l border-border/60 pl-1.5">{topicChats.map((c) => renderChat(c))}</div>}
										</div>
									);
								})}
							</div>
						)}
					</div>
				);
			})}
			{grouped.unfiled.length > 0 && (
				<div data-testid="unfiled" className="mt-2">
					<div className="px-2 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground/70">Not filed</div>
					<div className="flex flex-col gap-0.5">{grouped.unfiled.map((c) => renderChat(c))}</div>
				</div>
			)}
		</div>
	);
}
