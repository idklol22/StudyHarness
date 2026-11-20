"use client";

/**
 * New-chat placement as a compact context bar (owner 2026-11-20): [● Subject ▾] and
 * [Whole subject ▾ | Topic | 3 topics ▾]. Either button opens a two-column, searchable picker above the
 * composer — one column for single-select subjects, one for multi-select topics of the highlighted subject.
 * `MentionMenu` stays for the `@` shorthand. State comes from useStudyPlacement; this file only renders it.
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { subjectColor, topicsOf } from "@/src/core";
import { subjectColorCss } from "./subject-color";
import { LAST_CHOICE_KEY, lastChoice, matchesQuery, orderedSubjects, placementLabel, type MentionOption } from "./placement";
import type { PlacementState } from "./placement-picker";

type Column = "subject" | "topics";
type Remembered = { subjectId: string; topicIds: string[] };

const BUTTON = "inline-flex h-8 max-w-[15rem] items-center gap-1.5 rounded-lg border border-border/60 bg-background px-3 text-[11px] text-foreground transition-colors hover:border-border hover:bg-accent";
const INPUT = "h-8 w-full rounded-md border border-border/60 bg-background px-2 text-[11px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring";
const ROW = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-accent";
const DOT = "size-2 shrink-0 rounded-full";

export function Highlight({ text, query }: { text: string; query: string }): ReactNode {
	const q = query.trim();
	if (!q) return text;
	const lower = text.toLowerCase(), needle = q.toLowerCase();
	const out: ReactNode[] = [];
	let at = 0, found = lower.indexOf(needle);
	while (found >= 0) {
		if (found > at) out.push(text.slice(at, found));
		out.push(<mark key={found} data-testid="context-highlight" className="rounded-sm bg-accent px-0 text-foreground">{text.slice(found, found + needle.length)}</mark>);
		at = found + needle.length;
		found = lower.indexOf(needle, at);
	}
	if (at < text.length) out.push(text.slice(at));
	return out.length ? out : text;
}

/** The summary text on the second button: Whole subject / Topic / 3 topics. */
export function topicButtonLabel(state: PlacementState): string {
	if (!state.choice.subjectId) return "Whole subject";
	const n = state.choice.topicIds.length;
	if (!n) return "Whole subject";
	if (n === 1) return topicsOf(state.library, state.choice.subjectId).find((t) => t.id === state.choice.topicIds[0])?.name ?? "Topic";
	return `${n} topics`;
}

/** The two-column picker itself. Pure state-in/events-out so static render tests can use it. */
export function ContextPanel({
	state,
	last,
	focus = "subject",
	onClose,
	onDone,
}: {
	state: PlacementState;
	last?: Remembered;
	focus?: Column;
	onClose?: () => void;
	onDone?: () => void;
}) {
	const [column, setColumn] = useState<Column>(focus);
	const [subjectQuery, setSubjectQuery] = useState("");
	const [topicQuery, setTopicQuery] = useState("");
	const [subjectIndex, setSubjectIndex] = useState(0);
	const [topicIndex, setTopicIndex] = useState(0);
	const [creating, setCreating] = useState<"" | "subject" | "topic">("");
	const [name, setName] = useState("");
	const subjectRef = useRef<HTMLInputElement>(null);
	const topicRef = useRef<HTMLInputElement>(null);

	useEffect(() => { setColumn(focus); }, [focus]);
	useEffect(() => {
		(column === "subject" ? subjectRef : topicRef).current?.focus();
	}, [column]);

	const remembered = last ?? { subjectId: state.choice.subjectId, topicIds: state.choice.topicIds };
	const subjects = orderedSubjects(state.library, remembered.subjectId).filter((s) => matchesQuery(s.name, subjectQuery));
	const selectedSubject = state.choice.subjectId;
	const topicRows = [
		{ id: "", name: "Whole subject", files: 0, whole: true },
		...topicsOf(state.library, selectedSubject).map((t) => ({
			id: t.id, name: t.name, whole: false,
			files: state.library.materials.filter((m) => m.scope.subjectId === selectedSubject && m.scope.topicId === t.id).length,
		})),
	].filter((row) => row.whole || !topicQuery.trim() || matchesQuery(row.name, topicQuery));
	const sIndex = Math.min(subjectIndex, Math.max(0, subjects.length - 1));
	const tIndex = Math.min(topicIndex, Math.max(0, topicRows.length - 1));
	const summary = state.choice.subjectId ? placementLabel(state.library, state.choice) : "Choose a subject";

	const selectSubject = (id: string) => {
		if (!id || !state.library.subjects.some((s) => s.id === id)) return;
		if (id !== state.choice.subjectId) state.setSubject(id); // changing subject resets topics to Whole subject
		setColumn("topics");
		setTopicIndex(0);
	};
	const toggleTopic = (id: string) => {
		if (!state.choice.subjectId) return;
		state.toggleTopic(id);
	};
	const done = () => { onDone?.(); onClose?.(); };
	const close = () => {
		if (creating) { setCreating(""); setName(""); return; }
		onClose?.();
	};
	const submit = async (e: FormEvent) => {
		e.preventDefault();
		const value = name.trim();
		if (!value) return;
		if (creating === "subject") await state.createSubject(value); else if (creating === "topic") await state.createTopic(value);
		setName(""); setCreating("");
	};
	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
		if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); done(); return; }
		if ((e.target as HTMLElement).dataset?.pickerCreate !== undefined) return; // the inline form owns its keys
		if (e.key === "Tab") {
			e.preventDefault();
			const next: Column = column === "subject" ? "topics" : "subject";
			setColumn(next);
			return;
		}
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			const delta = e.key === "ArrowDown" ? 1 : -1;
			if (column === "subject") setSubjectIndex(Math.max(0, Math.min(subjects.length - 1, sIndex + delta)));
			else setTopicIndex(Math.max(0, Math.min(topicRows.length - 1, tIndex + delta)));
			return;
		}
		if (column === "subject" && e.key === "Enter") {
			e.preventDefault();
			const row = subjects[sIndex];
			if (row) selectSubject(row.id);
			return;
		}
		if (column === "topics") {
			if (e.key === " ") {
				e.preventDefault();
				const row = topicRows[tIndex];
				if (row) toggleTopic(row.id);
			} else if (e.key === "Enter") { e.preventDefault(); done(); }
		}
	};
	const fileCount = (subjectId: string) => state.library.materials.filter((m) => m.scope.subjectId === subjectId).length;
	const createForm = (kind: "subject" | "topic") => (
		<form data-testid={`context-create-${kind}`} onSubmit={(e) => void submit(e)} className="flex items-center gap-1 px-2 pb-2">
			<input
				autoFocus data-picker-create="true" value={name} maxLength={120}
				onChange={(e) => setName(e.target.value)}
				onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setCreating(""); setName(""); } }}
				placeholder={`New ${kind} name`} aria-label={`New ${kind} name`} className={INPUT}
			/>
			<button type="submit" disabled={!name.trim()} className="h-8 shrink-0 rounded-md border border-border/60 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40">Add</button>
		</form>
	);

	return (
		<div
			data-testid="context-panel"
			role="dialog"
			aria-label="Choose what this chat is about"
			onKeyDown={onKeyDown}
			className="absolute bottom-full left-0 z-50 mb-2 flex h-[380px] max-h-[calc(100vh-120px)] w-[min(640px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xl"
		>
			<div data-testid="context-tabs" role="tablist" aria-label="Picker column" className="flex shrink-0 border-b sm:hidden">
				{(["subject", "topics"] as const).map((tab) => (
					<button key={tab} type="button" role="tab" aria-selected={column === tab} data-testid={`context-tab-${tab}`}
						onClick={() => setColumn(tab)} className={`flex-1 px-3 py-2 text-[11px] ${column === tab ? "bg-accent text-foreground" : "text-muted-foreground"}`}>
						{tab === "subject" ? "Subjects" : "Topics"}
					</button>
				))}
			</div>
			<div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-2">
				<section data-testid="context-column-subject" role="tabpanel" aria-label="Subjects" className={`min-h-0 flex-col border-border sm:flex ${column === "subject" ? "flex" : "hidden"}`}>
					<div className="shrink-0 p-2">
						<div className="px-1 pb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Subjects</div>
						<input
							ref={subjectRef} value={subjectQuery} autoFocus={focus === "subject"}
							onChange={(e) => { setSubjectQuery(e.target.value); setSubjectIndex(0); }}
							onFocus={() => setColumn("subject")}
							placeholder="Search subjects…" aria-label="Search subjects" data-testid="context-search-subject" className={INPUT}
						/>
					</div>
					<div data-testid="context-subject-list" role="listbox" aria-label="Subjects" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
						{subjects.map((s, i) => (
							<button
								key={s.id} type="button" role="option" aria-selected={selectedSubject === s.id}
								data-testid={`context-subject-${s.id}`}
								onMouseEnter={() => { setColumn("subject"); setSubjectIndex(i); }}
								onClick={() => selectSubject(s.id)}
								className={`${ROW} ${selectedSubject === s.id ? "bg-accent text-foreground" : "text-muted-foreground"} ${i === sIndex ? "ring-1 ring-border" : ""}`}
							>
								<span aria-hidden="true" className={DOT} style={{ background: subjectColorCss(subjectColor(state.library.subjects, s.id)) }} />
								<span className="min-w-0 flex-1 truncate"><Highlight text={s.name} query={subjectQuery} /></span>
								<span className="shrink-0 text-[10px] text-muted-foreground">{fileCount(s.id)} files · {topicsOf(state.library, s.id).length} topics</span>
							</button>
						))}
						{subjects.length === 0 && <p className="px-2 py-1 text-[11px] text-muted-foreground">No subjects found.</p>}
					</div>
					<div className="shrink-0 border-t p-2">
						{creating === "subject" ? createForm("subject") : (
							<button type="button" data-testid="context-new-subject" onClick={() => { setCreating("subject"); setName(""); }} className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">+ New subject</button>
						)}
					</div>
				</section>
				<section data-testid="context-column-topics" role="tabpanel" aria-label="Topics" className={`min-h-0 flex-col sm:flex sm:border-l sm:border-border ${column === "topics" ? "flex" : "hidden"}`}>
					<div className="shrink-0 p-2">
						<div className="px-1 pb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Topics</div>
						<input
							ref={topicRef} value={topicQuery} autoFocus={focus === "topics"}
							onChange={(e) => { setTopicQuery(e.target.value); setTopicIndex(0); }}
							onFocus={() => setColumn("topics")}
							placeholder="Search topics…" aria-label="Search topics" data-testid="context-search-topic" className={INPUT}
						/>
					</div>
					<div data-testid="context-topic-list" role="group" aria-label="Topics" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
						{topicRows.map((row, i) => {
							const checked = row.whole ? state.choice.topicIds.length === 0 : state.choice.topicIds.includes(row.id);
							return (
								<button
									key={row.id || "whole"} type="button" role="checkbox" aria-checked={checked}
									data-testid={row.whole ? "context-topic-whole" : `context-topic-${row.id}`}
									onMouseEnter={() => { setColumn("topics"); setTopicIndex(i); }}
									onClick={() => toggleTopic(row.id)}
									className={`${ROW} ${checked ? "text-foreground" : "text-muted-foreground"} ${i === tIndex ? "ring-1 ring-border" : ""}`}
								>
									<span aria-hidden="true" className={`grid size-3.5 shrink-0 place-items-center rounded-sm border border-border text-[10px] ${checked ? "bg-primary text-primary-foreground" : ""}`}>{checked ? "✓" : ""}</span>
									<span className="min-w-0 flex-1 truncate"><Highlight text={row.name} query={topicQuery} /></span>
									{!row.whole && <span className="shrink-0 text-[10px] text-muted-foreground">{row.files} files</span>}
								</button>
							);
						})}
						{topicRows.length === 0 && <p className="px-2 py-1 text-[11px] text-muted-foreground">No topics found.</p>}
					</div>
					<div className="shrink-0 border-t p-2">
						{creating === "topic" ? createForm("topic") : (
							<button type="button" data-testid="context-new-topic" disabled={!selectedSubject} onClick={() => { setCreating("topic"); setName(""); }} className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40">+ New topic</button>
						)}
					</div>
				</section>
			</div>
			<div className="flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2">
				<span data-testid="context-summary" className="min-w-0 truncate text-[11px] text-muted-foreground">{summary}</span>
				<button type="button" data-testid="context-done" onClick={done} className="h-8 shrink-0 rounded-md bg-primary px-3 text-[11px] text-primary-foreground transition-colors hover:bg-primary/90">Done</button>
			</div>
			{(state.error || state.missing) && <p role="alert" data-testid="placement-hint" className="sr-only">{state.error || state.missing}</p>}
		</div>
	);
}

/** The compact bar above the composer. */
export function ContextPickerBar({
	state,
	showMissing = false,
	last,
}: {
	state: PlacementState;
	showMissing?: boolean;
	last?: Remembered;
}) {
	const [open, setOpen] = useState(false);
	const [focus, setFocus] = useState<Column>("subject");
	const remembered = last ?? { subjectId: state.choice.subjectId, topicIds: state.choice.topicIds };
	const subjectName = state.library.subjects.find((s) => s.id === state.choice.subjectId)?.name ?? "Subject";
	const openPanel = (which: Column) => { setFocus(which); setOpen(true); };

	return (
		<div data-testid="context-bar" className="relative mb-2 flex flex-wrap items-center gap-1.5">
			<button type="button" data-testid="context-subject-button" aria-expanded={open && focus === "subject"} onClick={() => openPanel("subject")} className={BUTTON}>
				<span aria-hidden="true" className={DOT} style={{ background: subjectColorCss(subjectColor(state.library.subjects, state.choice.subjectId)) }} />
				<span className="max-w-[11rem] truncate">{subjectName}</span>
				<ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
			</button>
			<button type="button" data-testid="context-topics-button" aria-expanded={open && focus === "topics"} disabled={!state.choice.subjectId} onClick={() => openPanel("topics")} className={`${BUTTON} disabled:opacity-50`}>
				<span className="max-w-[11rem] truncate">{topicButtonLabel(state)}</span>
				<ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
			</button>
			{open && <ContextPanel state={state} last={remembered} focus={focus} onClose={() => setOpen(false)} onDone={() => setOpen(false)} />}
			{(state.error || (showMissing && state.missing)) && (
				<p role="alert" data-testid="placement-hint" className="basis-full text-[11px] text-destructive">{state.error || state.missing}</p>
			)}
		</div>
	);
}

/** The bar with the remembered choice read on the client (empty on the server). */
export function BoundContextPickerBar(props: { state: PlacementState; showMissing?: boolean }) {
	return <ContextPickerBar {...props} last={typeof window === "undefined" ? undefined : lastChoice()} />;
}

/** Compatibility name: the old pill rows are gone, but the old import still renders the new bar. */
export const PlacementPills = ContextPickerBar;
export const BoundPlacementPills = BoundContextPickerBar;
export { LAST_CHOICE_KEY };

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
