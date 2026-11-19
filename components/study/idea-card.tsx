"use client";

/** The card for an idea picked on a map: what it means, the files (with pages) and the chats about it. */
import Link from "next/link";
import type { MapIdea, MapSubject, MapTopic } from "@/src/core";

export function IdeaCard({ picked, onClose }: { picked: { idea: MapIdea; subject: MapSubject; topic?: MapTopic }; onClose: () => void }) {
	return (
		<div className="max-h-[50vh] overflow-y-auto rounded-xl border bg-card/95 p-3 text-xs shadow-lg backdrop-blur" data-testid="map-idea-card">
			<div className="mb-1 flex items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="truncate text-[11px] text-muted-foreground">{picked.subject.name}{picked.topic ? ` › ${picked.topic.name}` : ""}</div>
					<div className="font-medium text-card-foreground">{picked.idea.name}</div>
				</div>
				<button type="button" aria-label="Close" onClick={onClose} className="rounded px-1 text-muted-foreground hover:text-foreground">×</button>
			</div>
			{picked.idea.summary && <p className="mb-2 text-muted-foreground">{picked.idea.summary}</p>}
			<div className="mb-1 font-medium">Files</div>
			{picked.idea.files.length ? (
				<ul className="mb-2 flex flex-col gap-0.5">{picked.idea.files.map((f) => <li key={f.materialId}><Link href={f.href} className="hover:underline">{f.label}</Link>{f.pages && <span className="text-muted-foreground"> · pages {f.pages}</span>}</li>)}</ul>
			) : <p className="mb-2 text-muted-foreground">None yet.</p>}
			<div className="mb-1 font-medium">Chats</div>
			{picked.idea.chats.length ? (
				<ul className="flex flex-col gap-0.5">{picked.idea.chats.map((c) => <li key={c.id}><Link href={c.href} className="hover:underline">{c.title}</Link></li>)}</ul>
			) : <p className="text-muted-foreground">No chat about it yet.</p>}
		</div>
	);
}
