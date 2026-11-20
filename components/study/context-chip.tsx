"use client";

/** Context chip helpers: the pure label rule and the read-only chip for existing chats. New chats pick placement with the context bar (placement-pills.tsx). */
import Link from "next/link";
import { useEffect, useState } from "react";
import { emptyLibrary, type ChatPlacement, type Library } from "@/src/core";
import { placementLabel } from "./placement";

/** Accepts a Choice (new chat) OR a ChatPlacement (existing chat): both carry scope + start mode. */
type ChipChoice = { subjectId: string; topicId?: string; topicIds?: string[]; startMode?: string };

/** Pure: the chip's text. Mirrors placementLabel, adding the (never-defaulted) start mode. */
export function contextChipLabel(library: Library, choice: ChipChoice, practice = false): string {
	const scope = placementLabel(library, choice);
	const mode = practice ? "Practice" : "";
	return [scope, mode].filter(Boolean).join(" · ");
}

/** Read-only chip for an EXISTING chat's dock: shows its placement, navigates to the subject/topic page.
 *  No editing: no popover, no PUT, no mutation. Names are enriched from the library when it arrives. */
export function ReadOnlyContextChip({ placement, practice = false, className = "" }: { placement: ChatPlacement; practice?: boolean; className?: string }) {
	const [library, setLibrary] = useState<Library>(emptyLibrary());
	useEffect(() => {
		let alive = true;
		fetch("/api/study/library", { cache: "no-store" })
			.then((r) => r.json() as Promise<{ library?: Library }>)
			.then((data) => { if (alive && data.library) setLibrary(data.library); })
			.catch(() => { /* offline: the ids still name the chip */ });
		return () => { alive = false; };
	}, []);
	const label = contextChipLabel(library, placement, practice) || placement.subjectId;
	const ids = placement.topicIds ?? (placement.topicId ? [placement.topicId] : []);
	const href = `/subjects/${placement.subjectId}${ids.length === 1 ? `/${ids[0]}` : ""}`;
	return (
		<Link
			href={href}
			data-testid="chat-context-chip"
			title={`Open ${label}`}
			className={`mb-2 inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${className}`}
		>
			<span aria-hidden="true">◈</span>
			<span className="truncate">{label}</span>
		</Link>
	);
}
