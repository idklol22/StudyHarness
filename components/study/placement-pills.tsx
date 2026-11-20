"use client";

/**
 * New-chat placement as one-click pills (owner 2026-11-20): subjects directly above the composer (last used first,
 * a few visible + "More…"), topic pills right after a subject is chosen, "+ New subject"/"+ New topic" inline, and an
 * `@` mention menu for the composer. State comes from useStudyPlacement; this file only renders it.
 */
import { useState, type FormEvent } from "react";
import { subjectColor } from "@/src/core";
import { subjectColorCss } from "./subject-color";
import { LAST_CHOICE_KEY, orderedSubjects, orderedTopics, type MentionOption } from "./placement";
import type { PlacementState } from "./placement-picker";

export const MAX_VISIBLE_SUBJECTS = 6;

function lastChoice(): { subjectId: string; topicId: string } {
	try {
		const r = JSON.parse(localStorage.getItem(LAST_CHOICE_KEY) ?? "null") as { subjectId?: string; topicId?: string } | null;
		return { subjectId: r?.subjectId ?? "", topicId: r?.topicId ?? "" };
	} catch { return { subjectId: "", topicId: "" }; }
}

const PILL = "inline-flex max-w-[14rem] shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors";
const IDLE = "border-border/60 bg-background text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground";
const ON = "border-primary bg-primary text-primary-foreground";
const SMALL = "h-6 px-2 text-[10.5px]";
const H = "h-7";
const INPUT = "h-7 w-40 rounded-full border border-border/60 bg-background px-3 text-[11px] text-foreground outline-none focus-visible:border-ring";

/** Subject pills + topic pills. `last` (the remembered choice) orders them; tests pass it in. */
export function PlacementPills({ state, showMissing = false, last }: { state: PlacementState; showMissing?: boolean; last?: { subjectId: string; topicId: string } }) {
	const [creating, setCreating] = useState<"" | "subject" | "topic">("");
	const [name, setName] = useState("");
	const [more, setMore] = useState(false);
	const [search, setSearch] = useState("");
	const remembered = last ?? { subjectId: "", topicId: "" };
	const all = orderedSubjects(state.library, remembered.subjectId);
	const selected = state.choice.subjectId;
	// The selected subject always stays visible even when it would fall in the overflow.
	const head = all.slice(0, MAX_VISIBLE_SUBJECTS);
	const picked = selected ? all.find((s) => s.id === selected) : undefined;
	const visible = picked && !head.some((s) => s.id === selected) ? [...head.slice(0, MAX_VISIBLE_SUBJECTS - 1), picked] : head;
	const overflow = all.filter((s) => !visible.some((v) => v.id === s.id));
	const hits = overflow.filter((s) => s.name.toLowerCase().includes(search.trim().toLowerCase()));
	const topics = selected ? orderedTopics(state.library, selected, remembered.topicId) : [];
	const submit = async (e: FormEvent) => {
		e.preventDefault();
		const value = name.trim();
		if (!value) return;
		if (creating === "subject") await state.createSubject(value); else if (creating === "topic") await state.createTopic(value);
		setName(""); setCreating("");
	};
	const form = (kind: "subject" | "topic") => (
		<form onSubmit={(e) => void submit(e)} data-testid={`pills-create-${kind}`} className="flex items-center gap-1">
			<input
				autoFocus value={name} maxLength={120}
				onChange={(e) => setName(e.target.value)}
				onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setCreating(""); setName(""); } }}
				placeholder={`New ${kind} name`} aria-label={`New ${kind} name`} className={INPUT}
			/>
			<button type="submit" disabled={!name.trim()} className={`${PILL} ${H} ${IDLE} disabled:opacity-40`}>Add</button>
		</form>
	);
	return (
		<div data-testid="placement-pills" className="mb-2 flex flex-col gap-1.5">
			<div data-testid="subject-pills" role="group" aria-label="Subject" className="flex flex-wrap items-center gap-1.5">
				{visible.map((s) => (
					<button
						key={s.id} type="button" data-testid={`subject-pill-${s.id}`} aria-pressed={selected === s.id}
						onClick={() => { setCreating(""); state.setSubject(selected === s.id ? "" : s.id); }}
						className={`${PILL} ${H} ${selected === s.id ? ON : IDLE}`}
					>
						<span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: subjectColorCss(subjectColor(state.library.subjects, s.id)) }} />
						<span className="truncate">{s.name}</span>
					</button>
				))}
				{overflow.length > 0 && (
					<div className="relative">
						<button type="button" data-testid="subject-pill-more" aria-expanded={more} onClick={() => setMore((o) => !o)} className={`${PILL} ${H} ${IDLE}`}>More…</button>
						{more && (
							<div data-testid="subject-more-list" className="absolute bottom-full left-0 z-50 mb-1 w-56 rounded-lg border bg-card p-2 shadow-lg">
								<input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setMore(false); } }} placeholder="Search subjects…" aria-label="Search subjects" className={`${INPUT} w-full`} />
								<div className="mt-1 max-h-40 overflow-y-auto">
									{hits.map((s) => (
										<button key={s.id} type="button" data-testid={`subject-more-${s.id}`} onClick={() => { state.setSubject(s.id); setMore(false); setSearch(""); }}
											className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
											<span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: subjectColorCss(subjectColor(state.library.subjects, s.id)) }} />
											<span className="truncate">{s.name}</span>
										</button>
									))}
									{hits.length === 0 && <p className="px-2 py-1 text-[11px] text-muted-foreground">No subjects found.</p>}
								</div>
							</div>
						)}
					</div>
				)}
				{creating === "subject" ? form("subject") : (
					<button type="button" data-testid="pill-new-subject" onClick={() => { setCreating("subject"); setName(""); }} className={`${PILL} ${H} border-dashed ${IDLE}`}>+ New subject</button>
				)}
				{state.loaded && all.length === 0 && creating !== "subject" && (
					<span data-testid="pills-empty-hint" className="text-[11px] text-muted-foreground">Create a subject to start your first chat.</span>
				)}
			</div>
			{selected && (
				<div data-testid="topic-pills" role="group" aria-label="Topic" className="flex flex-wrap items-center gap-1.5">
					<button type="button" data-testid="topic-pill-whole" aria-pressed={!state.choice.topicId} onClick={() => state.setTopic("")} className={`${PILL} ${SMALL} ${!state.choice.topicId ? ON : IDLE}`}>Whole subject</button>
					{topics.map((t) => (
						<button key={t.id} type="button" data-testid={`topic-pill-${t.id}`} aria-pressed={state.choice.topicId === t.id} onClick={() => { setCreating(""); state.setTopic(state.choice.topicId === t.id ? "" : t.id); }} className={`${PILL} ${SMALL} ${state.choice.topicId === t.id ? ON : IDLE}`}>
							<span className="truncate">{t.name}</span>
						</button>
					))}
					{creating === "topic" ? form("topic") : (
						<button type="button" data-testid="pill-new-topic" onClick={() => { setCreating("topic"); setName(""); }} className={`${PILL} ${SMALL} border-dashed ${IDLE}`}>+ New topic</button>
					)}
				</div>
			)}
			{(state.error || (showMissing && state.missing)) && (
				<p role="alert" data-testid="placement-hint" className="text-[11px] text-destructive">{state.error || state.missing}</p>
			)}
		</div>
	);
}

/** The pills with the remembered choice read on the client (empty on the server). */
export function BoundPlacementPills(props: { state: PlacementState; showMissing?: boolean }) {
	return <PlacementPills {...props} last={typeof window === "undefined" ? undefined : lastChoice()} />;
}

/** The `@` autocomplete: a small listbox above the composer. Keys are handled by the composer's onKeyDown. */
export function MentionMenu({ options, index, onPick }: { options: MentionOption[]; index: number; onPick(option: MentionOption): void }) {
	if (options.length === 0) return null;
	return (
		<div data-testid="mention-menu" role="listbox" aria-label="Mention a subject or topic" className="mb-1 max-h-48 w-72 overflow-y-auto rounded-lg border bg-card p-1 shadow-lg">
			{options.map((o, i) => (
				<button
					key={o.key} type="button" role="option" aria-selected={i === index} data-testid={`mention-option-${o.key}`}
					onMouseDown={(e) => { e.preventDefault(); onPick(o); }}
					className={`block w-full truncate rounded px-2 py-1 text-left text-[11px] ${i === index ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent"}`}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}
