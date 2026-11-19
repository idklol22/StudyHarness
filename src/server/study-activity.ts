/**
 * What the Study agents are doing right now, so the activity dock can SAY it (owner 2026-11-19: "tell me that the
 * agent is understanding these files and what it is doing"). In-memory and live-only: a piece of work announces itself,
 * reports each step, and finishes; finished work disappears from the dock.
 */
import { emit } from "../core/events.ts";

export interface StudyWork { id: string; title: string; /** Latest step. */ activity: string; /** Every step so far, newest last. */ log: string[]; startedAt: number }

const active = new Map<string, StudyWork>();
const MAX_LOG = 40;
const STALE_MS = 45 * 60_000;
let counter = 0;

const announce = () => emit("activity-changed", {});

export interface WorkHandle { say(step: string): void; done(): void }

/** Start reporting a piece of work (e.g. "Understanding week1.md"). Always call `done()` (use try/finally). */
export function beginStudyWork(title: string, first = "Starting…"): WorkHandle {
	const id = `study_${Date.now().toString(36)}_${++counter}`;
	const work: StudyWork = { id, title, activity: first, log: [first], startedAt: Date.now() };
	active.set(id, work);
	announce();
	return {
		say(step) {
			const line = step.replace(/\s+/g, " ").trim().slice(0, 400);
			if (!line || !active.has(id)) return;
			work.activity = line;
			work.log = [...work.log, line].slice(-MAX_LOG);
			announce();
		},
		done() { if (active.delete(id)) announce(); },
	};
}

/** The running work, oldest first (anything stuck for 45 minutes is dropped). */
export function studyWorkSnapshot(now = Date.now()): StudyWork[] {
	for (const [id, w] of active) if (now - w.startedAt > STALE_MS) active.delete(id);
	return [...active.values()].sort((a, b) => a.startedAt - b.startedAt);
}
