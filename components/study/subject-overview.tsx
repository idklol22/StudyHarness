"use client";

/**
 * The subject/topic Overview (Task 4): what to do, how much of each PDF is covered, deadlines and recent activity.
 * It uses the data the scope page already has (library, chats, notebook covers) and fetches only the two new payloads
 * (cards for the due count, progress for read/noted pages). All numbers and wording come from src/core/study/overview.ts.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
	DEADLINE_KINDS, buildTodo, coverageRows, coverageTotals, deadlineLabel, daysUntil, materialsUnder, recentItems,
	relativeDue, timeAgo, upcoming, type Card, type Capture, type CaptureStatus, type ChatListItem, type DeadlineKind,
	type GroupSummary, type Library, type MaterialProgress, type RecentItem, type StudyScope, type TodoItem,
} from "@/src/core";
import { useServerEvent } from "@/components/server-events";

interface NotebookCover { id: string; title: string; createdAt: string; scopeName: string; href: string; topicId?: string; covers?: Array<{ materialId: string; from: number; to: number }> }

export interface SubjectOverviewProps {
	subjectId: string;
	topicId?: string;
	library: Library;
	chats: ChatListItem[];
	notebooks: NotebookCover[];
	/** Deadline edits replace the scope page's library so every tab stays in step. */
	onLibrary: (library: Library) => void;
}

type CardsData = { cards: Card[]; groups: GroupSummary[] };

const fmtDue = (due: string): string => {
	const date = new Date(due);
	if (!Number.isFinite(date.getTime())) return due.slice(0, 10);
	return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
};

/** One computed action, always a link (tab links work through the tab bar's hash listener). */
function TodoLink({ item }: { item: TodoItem }) {
	return (
		<li>
			<Link href={item.href} className={`flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent ${item.danger ? "text-destructive" : ""}`}>
				<span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-current" />
				<span className="min-w-0 break-words">{item.label}</span>
			</Link>
		</li>
	);
}

const RECENT_LABEL: Record<RecentItem["kind"], string> = { file: "File", chat: "Chat", note: "Notes" };
const CAPTURE_STATUS: Record<CaptureStatus, string> = { processing: "processing", added: "added", failed: "failed" };
const CAPTURE_TYPES = "image/png,image/jpeg,image/webp";

export function SubjectOverview({ subjectId, topicId, library, chats, notebooks, onLibrary }: SubjectOverviewProps) {
	const scope: StudyScope = { subjectId, ...(topicId ? { topicId } : {}) };
	const path = `/subjects/${subjectId}${topicId ? `/${topicId}` : ""}`;
	const [cards, setCards] = useState<CardsData | null>(null);
	const [progress, setProgress] = useState<MaterialProgress[]>([]);
	const [error, setError] = useState("");
	const [showDone, setShowDone] = useState(false);
	const [title, setTitle] = useState("");
	const [due, setDue] = useState("");
	const [kind, setKind] = useState<DeadlineKind>("assignment");
	const [captures, setCaptures] = useState<Capture[]>([]);
	const [captureFiles, setCaptureFiles] = useState<File[]>([]);
	const [captureText, setCaptureText] = useState("");
	const [captureBusy, setCaptureBusy] = useState(false);
	const [dragging, setDragging] = useState(false);

	const load = useCallback(async () => {
		const query = new URLSearchParams({ subjectId, ...(topicId ? { topicId } : {}) }).toString();
		try {
			const [c, p, i] = await Promise.all([
				fetch(`/api/study/cards?${query}`, { cache: "no-store" }).then((r) => r.json() as Promise<CardsData>),
				fetch(`/api/study/progress?subjectId=${encodeURIComponent(subjectId)}`, { cache: "no-store" }).then((r) => r.json() as Promise<{ materials?: MaterialProgress[] }>),
				fetch(`/api/study/inbox?subjectId=${encodeURIComponent(subjectId)}`, { cache: "no-store" }).then((r) => r.json() as Promise<{ captures?: Capture[] }>),
			]);
			setCards(c.cards ? c : { cards: [], groups: [] });
			setProgress(p.materials ?? []);
			setCaptures(i.captures ?? []);
		} catch { setError("Could not load the overview."); }
	}, [subjectId, topicId]);
	useEffect(() => { void load(); }, [load]);
	useServerEvent("sources-changed", () => { void load(); });

	const act = async (body: Record<string, unknown>): Promise<boolean> => {
		try {
			const res = await fetch("/api/study/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
			const data = await res.json() as { library?: Library; error?: string };
			if (!data.library) { setError(data.error ?? "That did not work."); return false; }
			onLibrary(data.library); setError(""); return true;
		} catch { setError("Could not reach the app."); return false; }
	};

	const addCaptureFiles = (incoming: FileList | File[] | null) => {
		const images = Array.from(incoming ?? []).filter((f) => ["image/png", "image/jpeg", "image/webp"].includes(f.type));
		if (images.length) setCaptureFiles((prev) => [...prev, ...images].slice(0, 12));
	};

	const sendCapture = async (body: FormData) => {
		setCaptureBusy(true);
		setError("");
		try {
			const res = await fetch("/api/study/inbox", { method: "POST", body });
			const data = await res.json() as { capture?: Capture; error?: string };
			if (!data.capture) { setError(data.error ?? "Could not add that capture."); return; }
			setCaptureFiles([]);
			setCaptureText("");
			await load();
		} catch { setError("Could not reach the app."); }
		finally { setCaptureBusy(false); }
	};

	const addCapture = async () => {
		if (!captureFiles.length && !captureText.trim()) return;
		const body = new FormData();
		body.set("subjectId", subjectId);
		if (topicId) body.set("topicId", topicId);
		for (const file of captureFiles) body.append("files", file);
		if (captureText.trim()) body.set("text", captureText);
		await sendCapture(body);
	};

	const retryCapture = async (id: string) => {
		const body = new FormData();
		body.set("captureId", id);
		await sendCapture(body);
	};

	const files = materialsUnder(library, scope);
	const rows = coverageRows(files, progress);
	const totals = coverageTotals(rows);
	const dueCards = cards?.groups.reduce((n, g) => n + g.due, 0) ?? 0;
	const todo = buildTodo({ scope, library, now: new Date(), dueCards, progress });
	const inScope = (d: { subjectId: string; topicId?: string }) => d.subjectId === subjectId && (topicId === undefined || d.topicId === undefined || d.topicId === topicId);
	const allDeadlines = (library.deadlines ?? []).filter((d) => inScope(d) && (showDone || !d.done)).sort((a, b) => Date.parse(a.due) - Date.parse(b.due) || a.title.localeCompare(b.title));
	const deadlines = showDone ? allDeadlines : upcoming(library, subjectId, new Date(), topicId);
	const recent = recentItems({ scope, library, chats, notebooks });

	const card = "min-w-0 rounded-lg border bg-card p-3";
	const heading = "mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground";
	const field = "h-8 min-w-0 rounded-md border border-border bg-background px-2 text-xs outline-none";

	return (
		<section className="mt-4 min-w-0" data-testid="overview-section">
			{error && <p role="alert" className="mb-3 rounded-md border border-destructive/40 bg-card px-3 py-2 text-xs text-destructive">{error}</p>}
			<div className={card} data-testid="overview-inbox">
				<h2 className={heading}>Inbox</h2>
				<div className="grid min-w-0 gap-2 sm:grid-cols-2">
					<div
						data-testid="inbox-drop"
						onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
						onDragLeave={() => setDragging(false)}
						onDrop={(e) => { e.preventDefault(); setDragging(false); addCaptureFiles(e.dataTransfer.files); }}
						className={`flex min-h-20 items-center justify-center rounded-md border border-dashed px-3 py-2 text-center text-xs ${dragging ? "bg-accent text-foreground" : "text-muted-foreground"}`}
					>
						<span>
							Drop screenshots here or{" "}
							<label className="cursor-pointer underline">
								browse
								<input type="file" accept={CAPTURE_TYPES} multiple aria-label="Choose screenshots" className="hidden" onChange={(e) => { addCaptureFiles(e.target.files); e.target.value = ""; }} />
							</label>
							{" "}(PNG, JPG, WebP)
						</span>
					</div>
					<div className="flex min-w-0 flex-col gap-2">
						<textarea
							value={captureText}
							onChange={(e) => setCaptureText(e.target.value)}
							onPaste={(e) => addCaptureFiles(e.clipboardData.files)}
							placeholder="Paste class text here"
							aria-label="Paste class text"
							data-testid="inbox-paste"
							className="min-h-16 min-w-0 flex-1 rounded-md border border-border bg-background p-2 text-xs outline-none"
						/>
						<button type="button" data-testid="inbox-add" disabled={captureBusy || (!captureFiles.length && !captureText.trim())} onClick={() => void addCapture()} className="h-8 shrink-0 rounded-md border border-border px-3 text-xs transition-colors hover:bg-accent disabled:opacity-50">Add</button>
					</div>
				</div>
				{captureFiles.length > 0 && (
					<ul className="mt-2 flex flex-wrap gap-1" data-testid="inbox-selected">
						{captureFiles.map((file, i) => (
							<li key={`${file.name}-${i}`} className="flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">
								<span className="truncate">{file.name}</span>
								<button type="button" aria-label={`Remove ${file.name}`} className="text-muted-foreground hover:text-foreground" onClick={() => setCaptureFiles((prev) => prev.filter((_, n) => n !== i))}>×</button>
							</li>
						))}
					</ul>
				)}
				<ul className="mt-2 flex flex-col gap-1" data-testid="inbox-list">
					{captures.length === 0 ? <li className="text-xs text-muted-foreground">No captures yet.</li> : captures.map((c) => (
						<li key={c.id} className="flex min-w-0 items-center gap-2 text-xs">
							<span className="min-w-0 flex-1 truncate">{c.files.length ? `${c.files.length} screenshot${c.files.length === 1 ? "" : "s"}` : "Pasted text"}</span>
							<span title={c.error} className={`shrink-0 rounded-full border px-2 py-0.5 ${c.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{CAPTURE_STATUS[c.status]}</span>
							{c.status === "failed" && <button type="button" data-testid="inbox-retry" className="shrink-0 rounded-md border border-border px-2 py-0.5 transition-colors hover:bg-accent" onClick={() => void retryCapture(c.id)}>Retry</button>}
						</li>
					))}
				</ul>
			</div>
			<div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
				<div className={card} data-testid="overview-todo">
					<h2 className={heading}>To do</h2>
					{todo.length === 0 ? (
						<p className="text-sm text-muted-foreground" data-testid="overview-todo-empty">You&apos;re all caught up.</p>
					) : (
						<ul className="flex flex-col gap-0.5">{todo.map((item) => <TodoLink key={item.id} item={item} />)}</ul>
					)}
				</div>

				<div className={card} data-testid="overview-coverage">
					<h2 className={heading}>
						Coverage <span className="normal-case tracking-normal">· {totals.readPages}/{totals.pages} pp read · {totals.notedPages}/{totals.pages} pp noted</span>
					</h2>
					{rows.length === 0 ? <p className="text-sm text-muted-foreground">No files here yet.</p> : (
						<ul className="flex flex-col gap-2">
							{rows.map((r) => (
								<li key={r.materialId} className="min-w-0">
									<div className="flex min-w-0 items-baseline justify-between gap-2 text-xs">
										<Link href={`/subjects/${subjectId}/read/${r.materialId}`} className="min-w-0 truncate hover:text-foreground" title={r.title}>{r.title}</Link>
										<span className="shrink-0 text-muted-foreground">{r.readPages}/{r.pageCount} pp</span>
									</div>
									<div className="relative mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted" title={`${r.readPct}% read · ${r.notedPct}% noted`}>
										<div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${r.readPct}%` }} />
										<div className="absolute inset-y-0 left-0 bg-muted-foreground" style={{ width: `${r.notedPct}%` }} />
									</div>
								</li>
							))}
						</ul>
					)}
				</div>

				<div className={card} id="deadlines" data-testid="overview-deadlines">
					<div className="mb-2 flex flex-wrap items-center gap-2">
						<h2 className={`${heading} mr-auto`}>Deadlines</h2>
						<label className="flex items-center gap-1.5 text-xs text-muted-foreground">
							<input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} aria-label="Show done" />Show done
						</label>
					</div>
					{deadlines.length === 0 ? <p className="text-sm text-muted-foreground">Nothing coming up.</p> : (
						<ul className="mb-3 flex flex-col gap-1">
							{deadlines.map((d) => (
								<li key={d.id} className="group flex min-w-0 items-center gap-2 text-sm">
									<input type="checkbox" checked={!!d.done} aria-label={`Done: ${d.title}`} onChange={() => void act({ action: "toggle-deadline", id: d.id })} />
									<span className={`min-w-0 flex-1 truncate ${d.done ? "text-muted-foreground line-through" : daysUntil(d.due) < 0 ? "text-destructive" : ""}`} title={deadlineLabel(d)}>{d.title}</span>
									<span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">{d.kind}</span>
									<span className="shrink-0 text-xs text-muted-foreground" title={relativeDue(d.due)}>{fmtDue(d.due)} · {relativeDue(d.due)}</span>
									<button type="button" aria-label={`Delete ${d.title}`} title="Delete" className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100" onClick={() => void act({ action: "remove-deadline", id: d.id })}>×</button>
								</li>
							))}
						</ul>
					)}
					<form className="flex min-w-0 flex-wrap gap-2 border-t pt-3" data-testid="deadline-add-form" onSubmit={(e) => {
						e.preventDefault();
						if (!title.trim() || !due) return;
						void act({ action: "add-deadline", subjectId, ...(topicId ? { topicId } : {}), title, due, kind }).then((ok) => { if (ok) { setTitle(""); setDue(""); } });
					}}>
						<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New deadline" aria-label="Deadline title" maxLength={120} className={`${field} flex-1`} />
						<input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Deadline date" className={field} />
						<select value={kind} onChange={(e) => setKind(e.target.value as DeadlineKind)} aria-label="Deadline kind" className={field}>
							{DEADLINE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
						</select>
						<button type="submit" disabled={!title.trim() || !due} className="h-8 shrink-0 rounded-md border border-border px-3 text-xs transition-colors hover:bg-accent disabled:opacity-50">Add</button>
					</form>
				</div>

				<div className={card} data-testid="overview-recent">
					<h2 className={heading}>Recent</h2>
					{recent.length === 0 ? <p className="text-sm text-muted-foreground">Nothing here yet.</p> : (
						<ul className="flex flex-col gap-1">
							{recent.map((r) => (
								<li key={r.id} className="flex min-w-0 items-baseline gap-2 text-xs">
									<Link href={r.href} className="min-w-0 flex-1 truncate hover:text-foreground" title={r.title}>{r.title}</Link>
									<span className="shrink-0 text-muted-foreground">{RECENT_LABEL[r.kind]} · {timeAgo(r.at)}</span>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</section>
	);
}
