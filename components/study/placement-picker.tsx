"use client";

/**
 * Where does this chat live, and how does it start? (Study overhaul, owner 2026-11-19.) Shown above the new-chat
 * composer on Home and in the draft view: pick a SUBJECT, optionally a TOPIC of it (or the whole subject), create
 * either on the spot, then choose "From scratch" or "Check what I know first" — asked every time, never defaulted.
 * The last subject/topic is remembered; the start mode is not.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { emptyLibrary, topicsOf, type ChatPlacement, type Library } from "@/src/core";
import { emptyChoice, LAST_CHOICE_KEY, missingPlacement, placementFromChoice, restoreChoice, type Choice, type StartMode } from "./placement";

const NEW = "__new__";

export interface PlacementState {
	library: Library;
	loaded: boolean;
	choice: Choice;
	/** What to send with the chat, or null while the choice is incomplete. */
	placement: ChatPlacement | null;
	/** Why Start is blocked ("" when ready). */
	missing: string;
	setSubject(id: string): void;
	setTopic(id: string): void;
	setStartMode(mode: StartMode): void;
	createSubject(name: string): Promise<void>;
	createTopic(name: string): Promise<void>;
	error: string;
}

async function post(body: unknown): Promise<{ library?: Library; error?: string }> {
	try {
		const res = await fetch("/api/study/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
		return await res.json() as { library?: Library; error?: string };
	} catch { return { error: "Could not reach the app." }; }
}

/** The picker's state. `practice` chats need no start mode. */
export function useStudyPlacement(practice = false): PlacementState {
	const [library, setLibrary] = useState<Library>(emptyLibrary());
	const [loaded, setLoaded] = useState(false);
	const [choice, setChoice] = useState<Choice>(emptyChoice);
	const [error, setError] = useState("");

	const refresh = useCallback(async (): Promise<Library | null> => {
		try {
			const res = await fetch("/api/study/library", { cache: "no-store" });
			const data = await res.json() as { library?: Library };
			if (data.library) { setLibrary(data.library); return data.library; }
		} catch { /* offline: the picker stays empty */ }
		return null;
	}, []);

	useEffect(() => {
		let alive = true;
		void refresh().then((lib) => {
			if (!alive) return;
			setLoaded(true);
			if (!lib) return;
			try { setChoice((cur) => cur.subjectId ? cur : restoreChoice(lib, JSON.parse(localStorage.getItem(LAST_CHOICE_KEY) ?? "null"))); } catch { /* none remembered */ }
		});
		return () => { alive = false; };
	}, [refresh]);

	const remember = (c: Choice) => { try { localStorage.setItem(LAST_CHOICE_KEY, JSON.stringify({ subjectId: c.subjectId, topicId: c.topicId })); } catch { /* best-effort */ } };
	const update = (patch: Partial<Choice>) => setChoice((cur) => { const next = { ...cur, ...patch }; remember(next); return next; });

	return {
		library, loaded, choice, error,
		placement: useMemo(() => placementFromChoice(library, choice, practice), [library, choice, practice]),
		missing: missingPlacement(library, choice, practice),
		setSubject: (id) => update({ subjectId: id, topicId: "" }),
		setTopic: (id) => update({ topicId: id }),
		setStartMode: (mode) => update({ startMode: mode }),
		async createSubject(name) {
			setError("");
			const r = await post({ action: "create-subject", name });
			if (r.error || !r.library) { setError(r.error ?? "Could not create the subject."); return; }
			setLibrary(r.library);
			const subject = r.library.subjects.find((s) => s.name.toLowerCase() === name.trim().replace(/\s+/g, " ").toLowerCase());
			if (subject) update({ subjectId: subject.id, topicId: "" });
		},
		async createTopic(name) {
			setError("");
			if (!choice.subjectId) return;
			const r = await post({ action: "create-topic", subjectId: choice.subjectId, name });
			if (r.error || !r.library) { setError(r.error ?? "Could not create the topic."); return; }
			setLibrary(r.library);
			const topic = topicsOf(r.library, choice.subjectId).find((t) => t.name.toLowerCase() === name.trim().replace(/\s+/g, " ").toLowerCase());
			if (topic) update({ topicId: topic.id });
		},
	};
}

const SELECT = "h-7 max-w-[14rem] rounded-md border border-border/60 bg-background px-2 text-[11px] text-foreground outline-none transition-colors hover:border-border focus-visible:border-ring";

/** The pure view (state in, events out) so it renders in any test harness. */
export function PlacementPickerView({ state, practice = false, showMissing = false }: { state: PlacementState; practice?: boolean; showMissing?: boolean }) {
	const [creating, setCreating] = useState<"" | "subject" | "topic">("");
	const [name, setName] = useState("");
	const topics = state.choice.subjectId ? topicsOf(state.library, state.choice.subjectId) : [];
	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		const value = name.trim();
		if (!value) return;
		if (creating === "subject") await state.createSubject(value); else if (creating === "topic") await state.createTopic(value);
		setName(""); setCreating("");
	};
	return (
		<div data-testid="study-placement" className="mb-2 flex flex-wrap items-center gap-2">
			<select
				aria-label="Subject"
				data-testid="placement-subject"
				className={SELECT}
				value={creating === "subject" ? NEW : state.choice.subjectId}
				onChange={(e) => {
					if (e.target.value === NEW) { setCreating("subject"); setName(""); } else { setCreating(""); state.setSubject(e.target.value); }
				}}
			>
				<option value="" disabled>Subject…</option>
				{state.library.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
				<option value={NEW}>＋ New subject…</option>
			</select>
			{state.choice.subjectId && (
				<select
					aria-label="Topic"
					data-testid="placement-topic"
					className={SELECT}
					value={creating === "topic" ? NEW : state.choice.topicId}
					onChange={(e) => {
						if (e.target.value === NEW) { setCreating("topic"); setName(""); } else { setCreating(""); state.setTopic(e.target.value); }
					}}
				>
					<option value="">Whole subject</option>
					{topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
					<option value={NEW}>＋ New topic…</option>
				</select>
			)}
			{creating && (
				<form onSubmit={(e) => void submit(e)} className="flex items-center gap-1" data-testid="placement-create">
					<input
						autoFocus
						value={name}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={(e) => { if (e.key === "Escape") { setCreating(""); setName(""); } }}
						placeholder={creating === "subject" ? "New subject name" : "New topic name"}
						aria-label={creating === "subject" ? "New subject name" : "New topic name"}
						maxLength={120}
						className="h-7 w-44 rounded-md border border-border/60 bg-background px-2 text-[11px] outline-none focus-visible:border-ring"
					/>
					<button type="submit" disabled={!name.trim()} className="h-7 rounded-md border border-border/60 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40">Add</button>
				</form>
			)}
			{!practice && (
				<div role="radiogroup" aria-label="How to start" data-testid="placement-start-mode" className="flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5">
					{([["scratch", "From scratch"], ["check", "Check what I know first"]] as const).map(([mode, label]) => (
						<button
							key={mode}
							type="button"
							role="radio"
							aria-checked={state.choice.startMode === mode}
							data-testid={`start-mode-${mode}`}
							onClick={() => state.setStartMode(mode)}
							className={`rounded-sm px-2 py-0.5 text-[11px] transition-colors ${state.choice.startMode === mode ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
						>
							{label}
						</button>
					))}
				</div>
			)}
			{state.choice.subjectId && (
				<Link
					href={`/subjects/${state.choice.subjectId}${state.choice.topicId ? `/${state.choice.topicId}` : ""}#files`}
					data-testid="placement-add-files"
					className="rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					Only adding notes or files? Add them here
				</Link>
			)}
			{(state.error || (showMissing && state.missing)) && (
				<p role="alert" data-testid="placement-hint" className="basis-full text-[11px] text-destructive">{state.error || state.missing}</p>
			)}
		</div>
	);
}

/** The picker bound to its state hook (Home and the draft view own the state; this is the convenient pairing). */
export function StudyPlacementPicker(props: { state: PlacementState; practice?: boolean; showMissing?: boolean }) {
	return <PlacementPickerView {...props} />;
}
