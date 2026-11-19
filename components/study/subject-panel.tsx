"use client";

/**
 * The sidebar's dedicated Subjects panel (Round 5 redesign): roomy subject rows with a colour dot,
 * quiet files/topics/chats counts, a chevron that reveals topics one level deep, and ALWAYS-VISIBLE
 * quick actions (new topic / new chat here / colour). Chats are NOT nested here — they live in the
 * flat Sessions list below. `useLibrary` stays exported from `subject-tree.tsx` (a re-export of the
 * hook below) because the graph view imports it from that path.
 *
 * The pure helpers (`subjectCounts`, `formatSubjectMeta`, `subjectRows`) and the presentational
 * `SubjectPanelView` are exported so the panel can be pinned with a static render (no browser).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRightIcon, MessageSquarePlusIcon, PlusIcon } from "lucide-react";
import { emptyLibrary, subjectColor, topicsOf, type Library, type Subject, type Topic } from "@/src/core";
import { cn } from "@/lib/utils";
import { groupChats, type ChatLike, type Grouped } from "./group-chats";
import { LAST_CHOICE_KEY } from "./placement";
import { SubjectColor, subjectColorCss } from "./subject-color";

const COLLAPSED_KEY = "lh.sidebar.collapsed.v1";

/** The library for the sidebar; the caller refetches on `sources-changed`. */
export function useLibrary(): { library: Library; refresh: () => void } {
	const [library, setLibrary] = useState<Library>(emptyLibrary());
	const refresh = useCallback(() => {
		void fetch("/api/study/library", { cache: "no-store" })
			.then((r) => r.json() as Promise<{ library?: Library }>)
			.then((d) => { if (d.library) setLibrary(d.library); })
			.catch(() => {});
	}, []);
	useEffect(() => { refresh(); }, [refresh]);
	return { library, refresh };
}

function useCollapsed(): [ReadonlySet<string>, (id: string) => void] {
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
	useEffect(() => {
		try {
			const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]") as unknown;
			if (Array.isArray(raw)) setCollapsed(new Set(raw.filter((v): v is string => typeof v === "string")));
		} catch { /* none */ }
	}, []);
	const toggle = useCallback((id: string) => setCollapsed((cur) => {
		const next = new Set(cur);
		if (next.has(id)) next.delete(id); else next.add(id);
		try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])); } catch { /* best-effort */ }
		return next;
	}), []);
	return [collapsed, toggle];
}

/* ── Pure helpers (exported for tests) ── */

export interface SubjectCounts {
	files: number;
	topics: number;
	chats: number;
}

/** Quiet meta for a subject row: every subject chats count includes its topics' chats. */
export function subjectCounts(library: Library, grouped: Grouped<ChatLike>, subjectId: string): SubjectCounts {
	const group = grouped.subjects.find((g) => g.subject.id === subjectId);
	const chats = group ? group.chats.length + group.topics.reduce((n, t) => n + t.chats.length, 0) : 0;
	return {
		files: library.materials.filter((m) => m.scope.subjectId === subjectId).length,
		topics: topicsOf(library, subjectId).length,
		chats,
	};
}

/** "1 file · 2 topics · 3 chats" — label formatting, pure and testable. */
export function formatSubjectMeta({ files, topics, chats }: SubjectCounts): string {
	const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
	return `${unit(files, "file")} · ${unit(topics, "topic")} · ${unit(chats, "chat")}`;
}

export interface SubjectRowData {
	subject: Subject;
	counts: SubjectCounts;
	topics: Array<{ topic: Topic; chatCount: number }>;
}

/** One row per subject, in the grouped display order (name order), with its counts and topics. */
export function subjectRows(library: Library, grouped: Grouped<ChatLike>): SubjectRowData[] {
	return grouped.subjects.map((g) => ({
		subject: g.subject,
		counts: subjectCounts(library, grouped, g.subject.id),
		topics: g.topics.map((t) => ({ topic: t.topic, chatCount: t.chats.length })),
	}));
}

/* ── Actions ── */

async function act(body: unknown): Promise<void> {
	await fetch("/api/study/library", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	}).catch(() => {});
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
				className="h-7 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring"
			/>
		</form>
	);
}

/* ── Presentational view (renderable with renderToStaticMarkup) ── */

export function SubjectPanelView({
	rows,
	library,
	collapsed,
	pathname,
	adding,
	onToggle,
	onAddSubject,
	onAddTopic,
	onNewChat,
	onCancelAdd,
	onCreateSubject,
	onCreateTopic,
	onChanged,
}: {
	rows: SubjectRowData[];
	library: Library;
	collapsed: ReadonlySet<string>;
	pathname: string;
	/** "" | "subject" | a subject id (new topic). */
	adding: string;
	onToggle: (id: string) => void;
	onAddSubject: () => void;
	onAddTopic: (subjectId: string) => void;
	onNewChat: (subjectId: string) => void;
	onCancelAdd: () => void;
	onCreateSubject: (name: string) => void;
	onCreateTopic: (subjectId: string, name: string) => void;
	onChanged: () => void;
}) {
	return (
		<section data-testid="subjects-panel" className="shrink-0 border-b border-border/60 pb-2">
			<div className="flex items-center justify-between gap-2 px-3 pb-1 pt-2">
				<h2 className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/70">Subjects</h2>
				<button
					type="button"
					data-testid="add-subject"
					aria-label="New subject"
					title="New subject"
					onClick={onAddSubject}
					className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					<PlusIcon className="size-3" />
					New subject
				</button>
			</div>

			{adding === "subject" && (
				<InlineAdd placeholder="New subject name" onCancel={onCancelAdd} onAdd={onCreateSubject} />
			)}

			{rows.length === 0 && adding !== "subject" && (
				<p className="px-3 py-2 text-xs text-muted-foreground">No subjects yet — add one above.</p>
			)}

			<div className="max-h-[45vh] overflow-y-auto px-2">
				{rows.map(({ subject, counts, topics }) => {
					const open = !collapsed.has(subject.id);
					const active = pathname === `/subjects/${subject.id}`;
					return (
						<div key={subject.id} data-testid={`subject-${subject.id}`}>
							<div
								className={cn(
									"group flex min-h-10 items-center gap-1.5 rounded-lg px-2 py-1.5",
									active ? "bg-accent" : "hover:bg-accent/60",
								)}
							>
								<button
									type="button"
									aria-expanded={open}
									aria-label={open ? `Collapse ${subject.name}` : `Expand ${subject.name}`}
									onClick={() => onToggle(subject.id)}
									className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
								>
									<ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
								</button>
								<span
									aria-hidden
									className="size-2 shrink-0 rounded-full"
									style={{ background: subjectColorCss(subjectColor(library.subjects, subject.id)) }}
								/>
								<span className="flex min-w-0 flex-1 flex-col">
									<Link href={`/subjects/${subject.id}`} className="truncate text-sm font-medium leading-5 text-foreground">
										{subject.name}
									</Link>
									<span className="truncate text-[10px] leading-4 tabular-nums text-muted-foreground/70">
										{formatSubjectMeta(counts)}
									</span>
								</span>
								{/* Always visible — the hover-only actions were the old tree's problem. */}
								<span className="flex shrink-0 items-center gap-0.5">
									<button
										type="button"
										aria-label={`New topic in ${subject.name}`}
										title="New topic"
										onClick={() => onAddTopic(subject.id)}
										className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
									>
										<PlusIcon className="size-3.5" />
									</button>
									<button
										type="button"
										aria-label={`New chat in ${subject.name}`}
										title="New chat here"
										onClick={() => onNewChat(subject.id)}
										className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
									>
										<MessageSquarePlusIcon className="size-3.5" />
									</button>
									<SubjectColor subjectId={subject.id} color={subject.color} name={subject.name} onChanged={onChanged} />
								</span>
							</div>
							{open && (
								<div className="ml-5 flex flex-col gap-0.5 border-l border-border/60 pl-2">
									{adding === subject.id && (
										<InlineAdd placeholder="New topic name" onCancel={onCancelAdd} onAdd={(name) => onCreateTopic(subject.id, name)} />
									)}
									{topics.map(({ topic, chatCount }) => {
										const topicActive = pathname === `/subjects/${subject.id}/${topic.id}`;
										return (
											<div
												key={topic.id}
												data-testid={`topic-${topic.id}`}
												className={cn(
													"flex min-h-8 items-center gap-2 rounded-md px-2 py-1",
													topicActive ? "bg-accent" : "hover:bg-accent/50",
												)}
											>
												<Link
													href={`/subjects/${subject.id}/${topic.id}`}
													className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground hover:text-foreground"
												>
													{topic.name}
												</Link>
												<span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
													{chatCount} {chatCount === 1 ? "chat" : "chats"}
												</span>
											</div>
										);
									})}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</section>
	);
}

/** The connected panel: owns collapse / inline-add state and wires the POST actions. */
export function SubjectsPanel({
	library,
	grouped,
	pathname,
	onChanged,
}: {
	library: Library;
	grouped: Grouped<ChatLike> | null;
	pathname: string;
	onChanged: () => void;
}) {
	const router = useRouter();
	const [collapsed, toggle] = useCollapsed();
	const [adding, setAdding] = useState("");
	const rows = useMemo(
		() => subjectRows(library, grouped ?? groupChats<ChatLike>(library, [])),
		[library, grouped],
	);
	const done = () => { setAdding(""); onChanged(); };
	// Same contract as the subject page's "New chat here" (scope-page.tsx): remember the placement,
	// then open Home, where the composer asks for the start mode before creating anything.
	const newChatHere = (subjectId: string) => {
		try { localStorage.setItem(LAST_CHOICE_KEY, JSON.stringify({ subjectId, topicId: "" })); } catch { /* best-effort */ }
		router.push("/");
	};
	return (
		<SubjectPanelView
			rows={rows}
			library={library}
			collapsed={collapsed}
			pathname={pathname}
			adding={adding}
			onToggle={toggle}
			onAddSubject={() => setAdding("subject")}
			onAddTopic={(subjectId) => setAdding(subjectId)}
			onCancelAdd={() => setAdding("")}
			onNewChat={newChatHere}
			onCreateSubject={(name) => void act({ action: "create-subject", name }).then(done)}
			onCreateTopic={(subjectId, name) => void act({ action: "create-topic", subjectId, name }).then(done)}
			onChanged={onChanged}
		/>
	);
}
