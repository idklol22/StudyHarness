"use client";

/**
 * A subject's or topic's files (owner 2026-11-19): open one to view its pages or slides; choose its topic yourself or
 * let the agent find topics; see which notebooks cover which of its pages, and what no notes cover yet.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CopyPlusIcon, FileTextIcon, FolderInputIcon, Trash2Icon } from "lucide-react";
import { useServerEvent } from "@/components/server-events";
import { coverageByFile, materialTopicName, otherTopicsOf, type Coverage, type Library, type Material } from "@/src/core";
import { PutInTopic } from "./suggestions-card";

type Act = (body: unknown) => Promise<void>;
interface NotebookCover { id: string; title: string; scopeName: string; href: string; covers?: Coverage[] }

const fmtBytes = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function FileList({ library, subjectId, files, topicPage, act, onMessage }: { library: Library; subjectId: string; files: readonly Material[]; topicPage: boolean; act: Act; onMessage: (m: string) => void }) {
	const [notebooks, setNotebooks] = useState<NotebookCover[]>([]);
	const [placing, setPlacing] = useState<{ id: string; mode: "move" | "link" } | null>(null);
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
	return (
		<>
			<ul className="flex flex-col gap-1" data-testid="file-list">
				{files.map((m) => {
					const cov = coverage.get(m.id);
					const topicName = materialTopicName(library, m);
					const pending = (library.suggestions ?? []).some((s) => s.materialId === m.id);
					return (
						<li key={m.id} className="rounded-lg border px-3 py-2 text-sm">
							<div className="flex items-center gap-2">
								<FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
								<Link href={`/subjects/${encodeURIComponent(subjectId)}/read/${encodeURIComponent(m.id)}?page=${m.pages?.from ?? 1}`} title="View pages" className="min-w-0 flex-1 truncate text-left hover:underline" data-testid="open-file">{m.fileName}</Link>
								{!topicPage && topicName && <Link href={`/subjects/${subjectId}/${m.scope.topicId}`} className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent">{topicName}</Link>}
								<span className="shrink-0 text-xs text-muted-foreground">{m.pages ? `pp. ${m.pages.from}–${m.pages.to} of ${m.pageCount}` : `${m.pageCount} ${m.kind === "text" ? "text pages" : "pages"}`} · {fmtBytes(m.bytes)}</span>
								{!m.scope.topicId && (
									<>
										<button type="button" onClick={() => setPlacing(placing?.id === m.id && placing.mode === "move" ? null : { id: m.id, mode: "move" })} title="Move this file into a topic you choose" className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-accent"><FolderInputIcon className="size-3" />Put in topic</button>
										{!pending && <button type="button" title="Let the agent read this file and suggest topics" onClick={() => { void act({ action: "understand-material", id: m.id }).then(() => onMessage(`Understanding ${m.fileName} — watch the activity panel; suggested topics will appear here.`)); }} className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-accent">Find topics</button>}
									</>
								)}
								<button type="button" onClick={() => setPlacing(placing?.id === m.id && placing.mode === "link" ? null : { id: m.id, mode: "link" })} title="Also add this file to another topic (it stays here too)" data-testid="link-file" className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-accent"><CopyPlusIcon className="size-3" />Also in topic</button>
								<button type="button" aria-label={`Remove ${m.fileName}`} title="Remove" onClick={() => void act({ action: "remove-material", id: m.id })} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"><Trash2Icon className="size-3.5" /></button>
							</div>
							{cov && (
								<div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-6 text-[11px] text-muted-foreground" data-testid="file-coverage">
									{cov.parts.map((p, i) => <Link key={i} href={p.href} className="hover:text-foreground hover:underline">pp. {p.from}–{p.to} → {p.title}</Link>)}
									<span>{cov.parts.length ? (cov.uncovered ? `${cov.uncovered} page${cov.uncovered === 1 ? "" : "s"} not in any notes yet` : "fully covered by notes") : "not in any notes yet"}</span>
								</div>
							)}
							{topicPage && otherTopicsOf(library, m.id).length > 0 && (
								<div className="mt-1 flex flex-wrap items-center gap-1 pl-6 text-[11px] text-muted-foreground">Also in:{otherTopicsOf(library, m.id).map((t) => <Link key={t.topicId} href={`/subjects/${subjectId}/${t.topicId}`} className="rounded-full border px-2 py-0.5 hover:bg-accent">{t.name}</Link>)}</div>
							)}
							{placing?.id === m.id && <PutInTopic library={library} subjectId={subjectId} materialId={m.id} act={act} mode={placing.mode} onDone={() => setPlacing(null)} />}
						</li>
					);
				})}
				{files.length === 0 && <li className="text-sm text-muted-foreground">No files yet.</li>}
			</ul>
		</>
	);
}
