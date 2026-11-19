"use client";

/** The detail panel for an idea picked on the map or in the 3D graph (Round 5: enlarged):
 *  what it means, the files (with pages) and the chats about it. */
import Link from "next/link";
import type { MapIdea, MapSubject, MapTopic } from "@/src/core";

export function IdeaCard({ picked, onClose }: { picked: { idea: MapIdea; subject: MapSubject; topic?: MapTopic }; onClose: () => void }) {
	return (
		<div className="flex max-h-full flex-col overflow-y-auto rounded-xl border bg-card/95 p-4 text-sm shadow-xl backdrop-blur" data-testid="map-idea-card">
			<div className="flex items-start justify-between gap-3 border-b pb-3">
				<div className="min-w-0">
					<div className="truncate text-xs text-muted-foreground">{picked.subject.name}{picked.topic ? ` › ${picked.topic.name}` : ""}</div>
					<div className="mt-0.5 text-base font-medium text-card-foreground">{picked.idea.name}</div>
				</div>
				<button type="button" aria-label="Close details" onClick={onClose} className="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground">×</button>
			</div>
			{picked.idea.summary && <p className="py-3 leading-relaxed text-muted-foreground">{picked.idea.summary}</p>}
			<section className="border-t py-3">
				<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Files · {picked.idea.files.length}</div>
				{picked.idea.files.length ? (
					<ul className="flex flex-col gap-1.5">
						{picked.idea.files.map((f) => (
							<li key={f.materialId} className="flex items-start justify-between gap-2">
								<Link href={f.href} className="min-w-0 hover:underline">{f.label}</Link>
								{f.pages && <span className="shrink-0 text-xs text-muted-foreground">pages {f.pages}</span>}
							</li>
						))}
					</ul>
				) : <p className="text-muted-foreground">None yet.</p>}
			</section>
			<section className="border-t pt-3">
				<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Chats · {picked.idea.chats.length}</div>
				{picked.idea.chats.length ? (
					<ul className="flex flex-col gap-1.5">
						{picked.idea.chats.map((c) => <li key={c.id}><Link href={c.href} className="hover:underline">{c.title}</Link></li>)}
					</ul>
				) : <p className="text-muted-foreground">No chat about it yet.</p>}
			</section>
		</div>
	);
}
