"use client";

/**
 * The files tab on a subject/topic page. Two views: Library (grouped, sortable cards with first-page
 * thumbnails) and Table (the compact row list with coverage marks). The view choice is remembered in
 * localStorage. Both views share the search/sort bar and the per-file actions menu.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { ChevronDownIcon, ChevronRightIcon, CopyPlusIcon, EllipsisIcon, FileTextIcon, FolderInputIcon, LayoutGridIcon, ListIcon, PencilIcon, SearchIcon, SparklesIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useServerEvent } from "@/components/server-events";
import { coverageByFile, guessLectureMeta, materialTopicName, otherTopicsOf, sortMaterials, topicOf, topicsOf, type Library, type Material, type MaterialMeta } from "@/src/core";
import { PutInTopic, SuggestionsCard } from "./suggestions-card";

type Act = (body: unknown) => Promise<void>;
interface NotebookCover { id: string; title: string; scopeName: string; href: string; covers?: Array<{ materialId: string; from: number; to: number }> }
interface Placement { id: string; mode: "move" | "link" }
type FileView = "library" | "table";
type LibrarySort = Extract<FileSort, "name" | "added" | "lecture">;

export interface FileRow {
	id: string
	fileName: string
	topicName: string
	pageCount: number
	/** Covered source pages (0 = no notes cover it yet). */
	covered: number
	addedAt: string
}

/** A note handed over by the Planner (read-only here; the Planner is its source). */
export const isPlannerNote = (m: Pick<Material, "meta">): boolean => m.meta?.source === "planner";
/** The badge text of a Planner note. */
export const plannerBadge = (m: Pick<Material, "meta">): string => (m.meta?.finished === false ? "Unfinished" : "Finished");

export type FileSort = "name" | "topic" | "pages" | "coverage" | "added" | "lecture";

export const FILE_SORTS: ReadonlyArray<{ id: FileSort; label: string }> = [
	{ id: "name", label: "Name" },
	{ id: "topic", label: "Topic" },
	{ id: "pages", label: "Pages" },
	{ id: "coverage", label: "Coverage" },
	{ id: "added", label: "Recently added" },
];

const LIBRARY_SORTS: ReadonlyArray<{ id: FileSort; label: string }> = [
	{ id: "name", label: "Name" },
	{ id: "added", label: "Recently added" },
	{ id: "lecture", label: "Lecture" },
];

const KIND_LABELS: Record<NonNullable<MaterialMeta["kind"]>, string> = { slides: "Slides", handwritten: "Handwritten", assignment: "Assignment", other: "Other" };
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-12" → "12 Nov"; a stored date is always ISO, but never trust a hand-edited library blindly. */
function cardDate(iso: string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!m) return iso;
	const month = MONTH_LABELS[Number(m[2]) - 1];
	return month ? `${Number(m[3])} ${month}` : iso;
}

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

/** The small inline form opened by "Edit details" on a card. */
function EditDetailsForm({ material, meta, act, onDone, onMessage }: {
	material: Material
	meta: MaterialMeta
	act: Act
	onDone: () => void
	onMessage: (m: string) => void
}) {
	const [lecture, setLecture] = useState(meta.lecture === undefined ? "" : String(meta.lecture));
	const [date, setDate] = useState(meta.date ?? "");
	const [kind, setKind] = useState(meta.kind ?? "");
	const [title, setTitle] = useState(meta.title ?? material.fileName);
	const inputClass = "mt-0.5 h-7 w-full min-w-0 rounded-md border border-border bg-background px-1.5 text-xs text-foreground outline-none focus-visible:border-ring";
	const submit = (e: FormEvent) => {
		e.preventDefault();
		const value: MaterialMeta = {
			...(lecture.trim() ? { lecture: Number(lecture) } : {}),
			...(date ? { date } : {}),
			...(kind ? { kind: kind as NonNullable<MaterialMeta["kind"]> } : {}),
			...(title.trim() ? { title: title.trim() } : {}),
		};
		onDone();
		void act({ action: "set-meta", id: material.id, meta: value }).then(() => onMessage(`Saved details for ${material.fileName}.`));
	};
	return (
		<form onSubmit={submit} data-testid="edit-meta-form" className="absolute inset-x-1 bottom-1 z-40 grid grid-cols-2 gap-1.5 rounded-lg border bg-card p-2 text-xs shadow-lg">
			<label className="min-w-0">
				<span className="text-[11px] text-muted-foreground">Lecture</span>
				<input type="number" min={0} max={9999} value={lecture} onChange={(e) => setLecture(e.target.value)} data-testid="edit-meta-lecture" className={inputClass} />
			</label>
			<label className="min-w-0">
				<span className="text-[11px] text-muted-foreground">Date</span>
				<input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="edit-meta-date" className={inputClass} />
			</label>
			<label className="col-span-2 min-w-0">
				<span className="text-[11px] text-muted-foreground">Kind</span>
				<select value={kind} onChange={(e) => setKind(e.target.value)} data-testid="edit-meta-kind" className={inputClass}>
					<option value="">None</option>
					{(Object.keys(KIND_LABELS) as Array<NonNullable<MaterialMeta["kind"]>>).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
				</select>
			</label>
			<label className="col-span-2 min-w-0">
				<span className="text-[11px] text-muted-foreground">Title</span>
				<input type="text" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="edit-meta-title" className={inputClass} />
			</label>
			<div className="col-span-2 flex gap-1.5 pt-1">
				<button type="submit" data-testid="edit-meta-save" className="h-7 rounded-md bg-primary px-3 text-xs text-primary-foreground hover:opacity-90">Save</button>
				<button type="button" onClick={onDone} className="h-7 rounded-md border border-border px-3 text-xs hover:bg-accent">Cancel</button>
			</div>
		</form>
	);
}

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
	const [librarySort, setLibrarySort] = useState<LibrarySort>("lecture");
	const [view, setView] = useState<FileView>("library");
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
	const [notebooks, setNotebooks] = useState<NotebookCover[]>([]);
	const [placing, setPlacing] = useState<Placement | null>(null);
	const [menuFor, setMenuFor] = useState<string | null>(null);
	const [editFor, setEditFor] = useState<string | null>(null);
	const [over, setOver] = useState(false);

	useEffect(() => {
		try {
			const saved = localStorage.getItem("lh.files.view");
			if (saved === "library" || saved === "table") setView(saved);
		} catch { /* storage is best-effort */ }
	}, []);

	const switchView = (next: FileView) => {
		setView(next); setMenuFor(null); setEditFor(null);
		try { localStorage.setItem("lh.files.view", next); } catch { /* storage is best-effort */ }
	};

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

	/** Older files have no stored meta: guess it from their name rather than migrating the library. */
	const metaOf = (m: Material): MaterialMeta => m.meta ?? guessLectureMeta(m.fileName);
	const topicLabel = (m: Material) => (m.scope.topicId ? topicOf(library, m.scope.topicId)?.name ?? "" : "");
	const readerHref = (m: Material) => `/subjects/${encodeURIComponent(subjectId)}/read/${encodeURIComponent(m.id)}?page=${m.pages?.from ?? 1}`;
	const metaLine = (m: Material) => {
		const meta = metaOf(m);
		return [
			meta.lecture === undefined ? "" : `Lecture ${meta.lecture}`,
			meta.date ? cardDate(meta.date) : "",
			isPlannerNote(m) ? plannerBadge(m) : meta.kind ? KIND_LABELS[meta.kind] : "",
			isPlannerNote(m) ? "" : `${m.pageCount} pp`,
		].filter(Boolean).join(" · ");
	};

	const lowerQuery = query.trim().toLowerCase();
	const matchesQuery = (m: Material) => {
		if (!lowerQuery) return true;
		const meta = metaOf(m);
		const topic = topicLabel(m);
		return [m.fileName, meta.title ?? "", topic, topic ? "" : "Subject-wide"].some((s) => s.toLowerCase().includes(lowerQuery));
	};

	const groups = useMemo(() => {
		if (topicPage) {
			const topicId = files[0]?.scope.topicId;
			return [{ key: "topic", name: topicId ? topicOf(library, topicId)?.name ?? "Topic files" : "Topic files", files: [...files] }];
		}
		const own = files.filter((m) => !isPlannerNote(m));
		const planner = files.filter(isPlannerNote);
		return [
			...(planner.length ? [{ key: "from-planner", name: "From Planner", files: planner }] : []),
			...topicsOf(library, subjectId).map((t) => ({ key: t.id, name: t.name, files: own.filter((m) => m.scope.topicId === t.id) })),
			{ key: "subject-wide", name: "Subject-wide", files: own.filter((m) => !m.scope.topicId) },
		];
	}, [files, library, subjectId, topicPage]);

	const actAndClose = (id: string, body: unknown, message?: string) => {
		setMenuFor(null);
		void act(body).then(() => { if (message) onMessage(message); });
	};

	/** Shared by the table's ⋯ cell and the card's corner ⋯ button. */
	const actions = (m: Material) => {
		const pending = (library.suggestions ?? []).some((s) => s.materialId === m.id);
		return (
			<>
				<Link href={readerHref(m)} data-testid="file-action-view" onClick={() => setMenuFor(null)} className="rounded px-2 py-1.5 text-left hover:bg-accent">View pages</Link>
				{isPlannerNote(m)
					? <span data-testid="file-action-edit-in-planner" className="px-2 py-1.5 text-left text-muted-foreground">Edit in Planner</span>
					: <button type="button" data-testid="file-action-edit-meta" onClick={() => { setMenuFor(null); setEditFor(m.id); }} className="flex items-center gap-1.5 rounded px-2 py-1.5 text-left hover:bg-accent"><PencilIcon className="size-3" />Edit details</button>}
				{!m.scope.topicId && <button type="button" data-testid="file-action-put-in-topic" onClick={() => { setMenuFor(null); setPlacing({ id: m.id, mode: "move" }); }} className="flex items-center gap-1.5 rounded px-2 py-1.5 text-left hover:bg-accent"><FolderInputIcon className="size-3" />Put in topic</button>}
				<button type="button" data-testid="file-action-also-in-topic" onClick={() => { setMenuFor(null); setPlacing({ id: m.id, mode: "link" }); }} className="flex items-center gap-1.5 rounded px-2 py-1.5 text-left hover:bg-accent"><CopyPlusIcon className="size-3" />Also in topic</button>
				{!m.scope.topicId && !pending && <button type="button" data-testid="file-action-find-topics" onClick={() => actAndClose(m.id, { action: "understand-material", id: m.id }, `Understanding ${m.fileName} — watch the activity panel; suggested topics will appear here.`)} className="flex items-center gap-1.5 rounded px-2 py-1.5 text-left hover:bg-accent"><SparklesIcon className="size-3" />Find topics</button>}
				<button type="button" data-testid="file-action-remove" onClick={() => actAndClose(m.id, { action: "remove-material", id: m.id })} className="flex items-center gap-1.5 rounded px-2 py-1.5 text-left text-destructive hover:bg-accent"><Trash2Icon className="size-3" />Remove</button>
			</>
		);
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
					<select value={view === "library" ? librarySort : sort} onChange={(e) => view === "library" ? setLibrarySort(e.target.value as LibrarySort) : setSort(e.target.value as FileSort)} aria-label="Sort files" data-testid="file-sort" className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:border-ring">
						{(view === "library" ? LIBRARY_SORTS : FILE_SORTS).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
					</select>
				</label>
				<div className="flex items-center rounded-md border border-border p-0.5 text-xs" role="group" aria-label="Files view" data-testid="files-view-toggle">
					{(["library", "table"] as const).map((v) => (
						<button
							key={v}
							type="button"
							aria-pressed={view === v}
							data-testid={`files-view-${v}`}
							onClick={() => switchView(v)}
							className={`inline-flex h-7 items-center gap-1.5 rounded px-2 ${view === v ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
						>
							{v === "library" ? <LayoutGridIcon className="size-3.5" /> : <ListIcon className="size-3.5" />}
							{v === "library" ? "Library" : "Table"}
						</button>
					))}
				</div>
				<button
					type="button"
					disabled={busy}
					onClick={() => onAddFiles?.()}
					data-testid="add-file"
					className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs transition-colors hover:bg-accent disabled:opacity-50"
				><UploadIcon className="size-3.5" />{busy ? "Uploading…" : "Add files"}</button>
			</div>

			{view === "library" ? (
				<div data-testid="files-library">
					{groups.map((group) => {
						const visible = sortMaterials(group.files.filter(matchesQuery), librarySort);
						const isCollapsed = collapsed[group.key] === true;
						const count = lowerQuery ? visible.length : group.files.length;
						return (
							<section key={group.key} className="mb-3 rounded-lg border" data-testid="library-group">
								<button
									type="button"
									onClick={() => setCollapsed((prev) => ({ ...prev, [group.key]: !isCollapsed }))}
									aria-expanded={!isCollapsed}
									data-testid="library-group-toggle"
									className="flex w-full min-w-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-left text-xs font-medium hover:bg-accent/40"
								>
									{isCollapsed ? <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />}
									<span className="min-w-0 truncate">{group.name}</span>
									<span className="shrink-0 text-muted-foreground">{count} file{count === 1 ? "" : "s"}</span>
								</button>
								{!isCollapsed && (
									<div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 p-2" data-testid="library-grid">
										{visible.map((m) => {
											const meta = metaOf(m);
											const title = meta.title?.trim() || m.fileName;
											const open = menuFor === m.id;
											const href = readerHref(m);
											return (
												<article key={m.id} className="relative min-w-0 rounded-lg border bg-card" data-testid="library-card">
													<div className="aspect-[4/3] w-full overflow-hidden rounded-t-lg bg-muted">
														<Link href={href} data-testid="open-file" title="View pages" className="block h-full w-full">
															{m.kind === "text"
																? <span className="flex h-full w-full items-center justify-center"><FileTextIcon className="size-10 text-muted-foreground" /></span>
																// eslint-disable-next-line @next/next/no-img-element -- cached JPEGs from our own page route; a plain lazy <img> is specified
																: <img src={`/api/study/pages/${encodeURIComponent(m.id)}/${m.pages?.from ?? 1}`} alt="" loading="lazy" className="h-full w-full object-cover object-top" />}
														</Link>
													</div>
													<button
														type="button"
														aria-label={`Actions for ${m.fileName}`}
														aria-expanded={open}
														data-testid="file-menu"
														onClick={() => setMenuFor(open ? null : m.id)}
														className="absolute right-1 top-1 z-20 rounded bg-background/90 p-1 text-muted-foreground hover:text-foreground"
													><EllipsisIcon className="size-4" /></button>
													{open && <div className="absolute right-1 top-9 z-30 flex w-44 flex-col rounded-lg border bg-card p-1 text-xs shadow-lg" data-testid="file-menu-items">{actions(m)}</div>}
													<div className="min-w-0 p-2">
														<Link href={href} data-testid="library-card-title" title={title} className="line-clamp-2 block break-words text-xs font-medium leading-snug hover:underline">{title}</Link>
														<p className="mt-1 truncate text-[11px] text-muted-foreground" data-testid="library-card-meta">{metaLine(m)}</p>
													</div>
													{editFor === m.id && <EditDetailsForm material={m} meta={meta} act={act} onDone={() => setEditFor(null)} onMessage={onMessage} />}
												</article>
											);
										})}
										{visible.length === 0 && <p className="col-span-full py-3 text-center text-xs text-muted-foreground">{files.length ? "No files match your search." : "No files yet. Drop PDFs above or add them in a chat."}</p>}
									</div>
								)}
							</section>
						);
					})}
				</div>
			) : (
				<div className="rounded-lg border">
					<table className="w-full text-left text-xs" data-testid="files-table-grid">
						<thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
							<tr>
								<th className="px-3 py-1.5 font-medium">Name</th>
								<th className="hidden px-3 py-1.5 font-medium sm:table-cell">Topic</th>
								<th className="hidden px-3 py-2 text-right font-medium md:table-cell">Pages</th>
								<th className="hidden px-3 py-1.5 font-medium lg:table-cell">Covered by notes</th>
								<th className="hidden px-3 py-2 text-right font-medium md:table-cell">Added</th>
								<th className="w-10 px-2 py-2"><span className="sr-only">Actions</span></th>
							</tr>
						</thead>
						<tbody>
							{shown.map((row) => {
								const m = byId.get(row.id);
								if (!m) return null;
								const cov = coverage.get(m.id);
								const open = menuFor === m.id;
								return (
									<tr key={m.id} className="border-t align-top hover:bg-accent/40" data-testid="file-row">
										<td className="max-w-0 px-3 py-2">
											<div className="flex items-center gap-1.5">
												<FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
												<Link href={readerHref(m)} data-testid="open-file" title="View pages" className="min-w-0 truncate text-left hover:underline">{m.fileName}</Link>
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
												<div className="absolute right-2 top-full z-20 flex w-44 flex-col rounded-lg border bg-card p-1 text-xs shadow-lg" data-testid="file-menu-items">{actions(m)}</div>
											)}
										</td>
									</tr>
								);
							})}
							{shown.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-muted-foreground">{files.length ? "No files match your search." : "No files yet. Drop PDFs above or add them in a chat."}</td></tr>}
						</tbody>
					</table>
				</div>
			)}

			{placing && <div className="mt-2"><PutInTopic library={library} subjectId={subjectId} materialId={placing.id} act={act} mode={placing.mode} onDone={() => setPlacing(null)} /></div>}
		</div>
	);
}
