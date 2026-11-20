"use client";

/**
 * The compact files table on a subject/topic page (Round 5): one row per file with its topic, pages, which notes
 * cover it and when it was added, a search/sort bar, and a per-row actions menu. The actions are the ones the file
 * list has always offered — open pages, choose a topic, add to another topic, let the agent find topics, remove.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CopyPlusIcon, EllipsisIcon, FileTextIcon, FolderInputIcon, SearchIcon, SparklesIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useServerEvent } from "@/components/server-events";
import { coverageByFile, materialTopicName, otherTopicsOf, type Library, type Material } from "@/src/core";
import { PutInTopic, SuggestionsCard } from "./suggestions-card";

type Act = (body: unknown) => Promise<void>;
interface NotebookCover { id: string; title: string; scopeName: string; href: string; covers?: Array<{ materialId: string; from: number; to: number }> }
interface Placement { id: string; mode: "move" | "link" }

export interface FileRow {
	id: string
	fileName: string
	topicName: string
	pageCount: number
	/** Covered source pages (0 = no notes cover it yet). */
	covered: number
	addedAt: string
}

export type FileSort = "name" | "topic" | "pages" | "coverage" | "added";

export const FILE_SORTS: ReadonlyArray<{ id: FileSort; label: string }> = [
	{ id: "name", label: "Name" },
	{ id: "topic", label: "Topic" },
	{ id: "pages", label: "Pages" },
	{ id: "coverage", label: "Coverage" },
	{ id: "added", label: "Recently added" },
];

/** Filter by name (or topic), then sort. Ties keep their input order; the input is never mutated. */
export function sortFiles<F extends FileRow>(files: readonly F[], query: string, sort: FileSort): F[] {
	const q = query.trim().toLowerCase();
	const decorate = files.map((file, index) => ({ file, index }));
	const matching = q ? decorate.filter(({ file }) => file.fileName.toLowerCase().includes(q) || file.topicName.toLowerCase().includes(q)) : decorate;
	const compare = (a: F, b: F): number => {
		switch (sort) {
			case "name": return a.fileName.localeCompare(b.fileName);
			case "topic": return a.topicName.localeCompare(b.topicName);
			case "pages": return a.pageCount - b.pageCount;
			case "coverage": return a.covered - b.covered;
			case "added": return b.addedAt.localeCompare(a.addedAt);
			default: return 0;
		}
	};
	matching.sort((a, b) => compare(a.file, b.file) || a.index - b.index);
	return matching.map(({ file }) => file);
}

const fmtDate = (value: string) => {
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
};

export function FilesTable({
	library,
	subjectId,
	files,
	topicPage,
	act,
	onMessage,
	onAddFiles,
	onDropFiles,
	busy = false,
}: {
	library: Library
	subjectId: string
	files: readonly Material[]
	topicPage: boolean
	act: Act
	onMessage: (m: string) => void
	/** Wired by the page: open the Files tab and focus the file picker. */
	onAddFiles?: () => void
	/** Wired by the page: upload files dropped on the table header. */
	onDropFiles?: (list: FileList | File[]) => void
	busy?: boolean
}) {
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<FileSort>("name");
	const [notebooks, setNotebooks] = useState<NotebookCover[]>([]);
	const [placing, setPlacing] = useState<Placement | null>(null);
	const [menuFor, setMenuFor] = useState<string | null>(null);
	const [over, setOver] = useState(false);

	const load = useCallback(async () => {
		try {
			const r = await fetch(`/api/study/notes?view=coverage&subjectId=${encodeURIComponent(subjectId)}`);
			const d = await r.json() as { notebooks?: NotebookCover[] };
			if (d.notebooks) setNotebooks(d.notebooks);
		} catch { /* coverage marks are optional */ }
	}, [subjectId]);
	useEffect(() => { void load(); }, [load]);
	useServerEvent("sources-changed", () => { void load(); });

	const coverage = coverageByFile(files, notebooks);
	const rows = useMemo<FileRow[]>(() => files.map((m) => {
		const cov = coverage.get(m.id);
		const usable = (m.pages?.to ?? m.pageCount) - (m.pages?.from ?? 1) + 1;
		return {
			id: m.id,
			fileName: m.fileName,
			topicName: topicPage ? "" : materialTopicName(library, m),
			pageCount: m.pageCount,
			covered: cov ? Math.max(0, usable - cov.uncovered) : 0,
			addedAt: m.addedAt,
		};
	}), [files, library, topicPage, coverage]);
	const shown = useMemo(() => sortFiles(rows, query, sort), [rows, query, sort]);
	const byId = useMemo(() => new Map(files.map((m) => [m.id, m])), [files]);

	const actAndClose = (id: string, body: unknown, message?: string) => {
		setMenuFor(null);
		void act(body).then(() => { if (message) onMessage(message); });
	};

	return (
		<div data-testid="files-table">
			{/* The caller may show the banner instead; showing it here keeps the Files tab self-contained. */}
			{!topicPage && <SuggestionsCard library={library} subjectId={subjectId} act={act} />}

			<div
				className={`mb-2 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-2 py-2 ${over ? "border-primary bg-primary/5" : "border-border"}`}
				data-testid="files-table-header"
				onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
				onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
				onDrop={(e) => { e.stopPropagation(); if (e.dataTransfer.files.length) { e.preventDefault(); setOver(false); onDropFiles?.(e.dataTransfer.files); } }}
			>
				<label className="flex min-w-[10rem] flex-1 items-center gap-1.5">
					<SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search files"
						aria-label="Search files"
						data-testid="file-search"
						className="h-8 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
					/>
				</label>
				<label className="flex items-center gap-1.5 text-xs text-muted-foreground">
					Sort
					<select value={sort} onChange={(e) => setSort(e.target.value as FileSort)} aria-label="Sort files" data-testid="file-sort" className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:border-ring">
						{FILE_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
					</select>
				</label>
				<button
					type="button"
					disabled={busy}
					onClick={() => onAddFiles?.()}
					data-testid="add-file"
					className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs transition-colors hover:bg-accent disabled:opacity-50"
				><UploadIcon className="size-3.5" />{busy ? "Uploading…" : "Add files"}</button>
			</div>

			<div className="rounded-lg border">
				<table className="w-full text-left text-xs" data-testid="files-table-grid">
					<thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
						<tr>
							<th className="px-3 py-2 font-medium">Name</th>
							<th className="hidden px-3 py-2 font-medium sm:table-cell">Topic</th>
							<th className="hidden px-3 py-2 text-right font-medium md:table-cell">Pages</th>
							<th className="hidden px-3 py-2 font-medium lg:table-cell">Covered by notes</th>
							<th className="hidden px-3 py-2 font-medium md:table-cell">Added</th>
							<th className="w-10 px-2 py-2"><span className="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{shown.map((row) => {
							const m = byId.get(row.id);
							if (!m) return null;
							const cov = coverage.get(m.id);
							const pending = (library.suggestions ?? []).some((s) => s.materialId === m.id);
							const open = menuFor === m.id;
							return (
								<tr key={m.id} className="border-t align-top hover:bg-accent/40" data-testid="file-row">
									<td className="max-w-0 px-3 py-2">
										<div className="flex items-center gap-1.5">
											<FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
											<Link href={`/subjects/${encodeURIComponent(subjectId)}/read/${encodeURIComponent(m.id)}?page=${m.pages?.from ?? 1}`} data-testid="open-file" title="View pages" className="min-w-0 truncate text-left hover:underline">{m.fileName}</Link>
										</div>
										{topicPage && otherTopicsOf(library, m.id).length > 0 && (
											<div className="mt-0.5 flex flex-wrap items-center gap-1 pl-5 text-[11px] text-muted-foreground">
												Also in:{otherTopicsOf(library, m.id).map((t) => <Link key={t.topicId} href={`/subjects/${subjectId}/${t.topicId}`} className="rounded-full border px-1.5 py-0.5 hover:bg-accent">{t.name}</Link>)}
											</div>
										)}
									</td>
									<td className="hidden px-3 py-2 sm:table-cell">
										{row.topicName
											? <Link href={`/subjects/${subjectId}/${m.scope.topicId}`} className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent">{row.topicName}</Link>
											: <span className="text-[11px] text-muted-foreground">Subject-wide</span>}
									</td>
									<td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">{m.pages ? `${m.pages.from}–${m.pages.to}` : m.pageCount}</td>
									<td className="hidden px-3 py-2 lg:table-cell" data-testid="file-coverage">
										{cov?.parts.length ? (
											<div className="flex flex-col gap-0.5">
												{cov.parts.map((p, i) => <Link key={i} href={p.href} className="truncate hover:text-foreground hover:underline">pp. {p.from}–{p.to} → {p.title}</Link>)}
												<span className="text-[11px] text-muted-foreground">{cov.uncovered ? `${cov.uncovered} page${cov.uncovered === 1 ? "" : "s"} uncovered` : "fully covered"}</span>
											</div>
										) : <span className="text-[11px] text-muted-foreground">Not covered yet</span>}
									</td>
									<td className="hidden whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground md:table-cell">{fmtDate(row.addedAt)}</td>
									<td className="relative px-2 py-2 text-right">
										<button
											type="button"
											aria-label={`Actions for ${m.fileName}`}
											aria-expanded={open}
											data-testid="file-menu"
											onClick={() => setMenuFor(open ? null : m.id)}
											className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
										><EllipsisIcon className="size-4" /></button>
										{open && (
											<div className="absolute right-2 top-full z-20 flex w-44 flex-col rounded-lg border bg-card p-1 text-xs shadow-lg" data-testid="file-menu-items">
												<Link href={`/subjects/${encodeURIComponent(subjectId)}/read/${encodeURIComponent(m.id)}?page=${m.pages?.from ?? 1}`} data-testid="file-action-view" onClick={() => setMenuFor(null)} className="rounded px-2 py-1.5 text-left hover:bg-accent">View pages</Link>
												{!m.scope.topicId && <button type="button" data-testid="file-action-put-in-topic" onClick={() => { setMenuFor(null); setPlacing({ id: m.id, mode: "move" }); }} className="flex items-center gap-1.5 rounded px-2 py-1.5 text-left hover:bg-accent"><FolderInputIcon className="size-3" />Put in topic</button>}
												<button type="button" data-testid="file-action-also-in-topic" onClick={() => { setMenuFor(null); setPlacing({ id: m.id, mode: "link" }); }} className="flex items-center gap-1.5 rounded px-2 py-1.5 text-left hover:bg-accent"><CopyPlusIcon className="size-3" />Also in topic</button>
												{!m.scope.topicId && !pending && <button type="button" data-testid="file-action-find-topics" onClick={() => actAndClose(m.id, { action: "understand-material", id: m.id }, `Understanding ${m.fileName} — watch the activity panel; suggested topics will appear here.`)} className="flex items-center gap-1.5 rounded px-2 py-1.5 text-left hover:bg-accent"><SparklesIcon className="size-3" />Find topics</button>}
												<button type="button" data-testid="file-action-remove" onClick={() => actAndClose(m.id, { action: "remove-material", id: m.id })} className="flex items-center gap-1.5 rounded px-2 py-1.5 text-left text-destructive hover:bg-accent"><Trash2Icon className="size-3" />Remove</button>
											</div>
										)}
									</td>
								</tr>
							);
						})}
						{shown.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-muted-foreground">{files.length ? "No files match your search." : "No files yet. Drop PDFs above or add them in a chat."}</td></tr>}
					</tbody>
				</table>
			</div>

			{placing && <div className="mt-2"><PutInTopic library={library} subjectId={subjectId} materialId={placing.id} act={act} mode={placing.mode} onDone={() => setPlacing(null)} /></div>}
		</div>
	);
}
