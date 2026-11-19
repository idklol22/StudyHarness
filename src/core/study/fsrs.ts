/**
 * FSRS-6 spaced-repetition scheduling for Study flashcards.
 *
 * Selectively adapted from ts-fsrs 5.2.3 (FSRS-6), MIT, Open Spaced Repetition — see FSRS-LICENSE.txt in this
 * folder. Dependency-free, deterministic (no fuzz, no optimizer), pure: a schedule is data; `rate` returns the next one.
 * Ratings: 1 again, 2 hard, 3 good, 4 easy. States: 0 new, 1 learning, 2 review, 3 relearning.
 */

const W = Object.freeze([
	0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194,
	0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629,
	1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
]) as readonly number[];
const w = (i: number): number => W[i]!;
const MINUTE = 60000;
const DAY = 86400000;
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const round8 = (v: number) => +v.toFixed(8);
const DECAY = -w(20);
const FACTOR = round8(Math.exp(Math.pow(DECAY, -1) * Math.log(0.9)) - 1);

export type Rating = 1 | 2 | 3 | 4;
export interface Schedule {
	/** Epoch ms when the card is next due. */
	due: number;
	stability: number;
	difficulty: number;
	elapsed_days: number;
	scheduled_days: number;
	reps: number;
	lapses: number;
	learning_steps: number;
	state: 0 | 1 | 2 | 3;
	last_review: number | null;
	/** Logical review day (set in the review state), so dues survive timezone changes. */
	dueDay?: string;
}
export interface SchedulerSettings {
	retention?: number;
	learningSteps?: number[];
	relearningSteps?: number[];
	/** Hour the study day rolls over (0–23). */
	dayStart?: number;
}

function timestamp(now: number): number {
	if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new RangeError("Expected a finite epoch-millisecond timestamp");
	return now;
}

export function dayBounds(now: number, startHour = 4): { start: number; end: number } {
	timestamp(now);
	if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) throw new RangeError("dayStart must be an integer from 0 to 23");
	const start = new Date(now);
	start.setHours(startHour, 0, 0, 0);
	if (+start > now) { start.setDate(start.getDate() - 1); start.setHours(startHour, 0, 0, 0); }
	const end = new Date(start);
	end.setDate(end.getDate() + 1);
	end.setHours(startHour, 0, 0, 0);
	return { start: +start, end: +end };
}

export function studyDay(now: number, startHour = 4): string {
	const date = new Date(dayBounds(now, startHour).start);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function ordinal(now: number, startHour: number): number {
	const date = new Date(dayBounds(now, startHour).start);
	return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY;
}

function reviewDue(now: number, days: number, dayStart: number): number {
	const date = new Date(dayBounds(now, dayStart).start);
	date.setDate(date.getDate() + days);
	date.setHours(dayStart, 0, 0, 0); // restore the rollover even across a DST gap
	return +date;
}

interface Resolved { learningSteps: number[]; relearningSteps: number[]; dayStart: number; modifier: number }
function settingsFor(settings: SchedulerSettings): Resolved {
	const retention = settings.retention ?? 0.9;
	if (!Number.isFinite(retention) || retention <= 0 || retention > 1) throw new RangeError("retention must be in (0, 1]");
	const learningSteps = settings.learningSteps ?? [1, 10];
	const relearningSteps = settings.relearningSteps ?? [10];
	for (const steps of [learningSteps, relearningSteps]) {
		if (!Array.isArray(steps) || steps.some((step) => !Number.isFinite(step) || step <= 0)) throw new RangeError("Learning steps must be arrays of positive minutes");
	}
	const dayStart = settings.dayStart ?? 4;
	dayBounds(0, dayStart);
	return { learningSteps, relearningSteps, dayStart, modifier: round8((Math.pow(retention, 1 / DECAY) - 1) / FACTOR) };
}

export function createSchedule(now = Date.now()): Schedule {
	return { due: timestamp(now), stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, reps: 0, lapses: 0, learning_steps: 0, state: 0, last_review: null };
}

const initDifficulty = (rating: number) => round8(w(4) - Math.exp((rating - 1) * w(5)) + 1);

function nextDifficulty(difficulty: number, rating: number): number {
	const delta = round8(-w(6) * (rating - 3) * (10 - difficulty) / 9);
	return clamp(round8(w(7) * initDifficulty(4) + (1 - w(7)) * (difficulty + delta)), 1, 10);
}

function shortStability(stability: number, rating: number): number {
	const increase = Math.pow(stability, -w(19)) * Math.exp(w(17) * (rating - 3 + w(18)));
	return round8(clamp(stability * (rating >= 3 ? Math.max(increase, 1) : increase), 0.001, 36500));
}

function reviewStability(schedule: Schedule, rating: number, elapsed: number): number {
	const d = schedule.difficulty, s = schedule.stability;
	const r = round8(Math.pow(1 + FACTOR * elapsed / s, DECAY));
	if (rating === 1) {
		const forgotten = round8(clamp(w(11) * Math.pow(d, -w(12)) * (Math.pow(s + 1, w(13)) - 1) * Math.exp((1 - r) * w(14)), 0.001, 36500));
		return clamp(round8(s / Math.exp(w(17) * w(18))), 0.001, forgotten);
	}
	const hard = rating === 2 ? w(15) : 1;
	const easy = rating === 4 ? w(16) : 1;
	return round8(clamp(s * (1 + Math.exp(w(8)) * (11 - d) * Math.pow(s, -w(9)) * (Math.exp((1 - r) * w(10)) - 1) * hard * easy), 0.001, 36500));
}

const interval = (stability: number, settings: Resolved) => clamp(Math.round(stability * settings.modifier), 1, 36500);

function learningInfo(schedule: Schedule, rating: number, settings: Resolved): { minutes: number; step: number } {
	const steps = schedule.state === 2 || schedule.state === 3 ? settings.relearningSteps : settings.learningSteps;
	let step = schedule.learning_steps || 0;
	if (schedule.state === 1 && rating >= 3) step += 1;
	if (steps.length === 0 || step >= steps.length) return { minutes: 0, step: 0 };
	if (schedule.state === 2) return { minutes: steps[step]!, step: 0 };
	if (rating === 1) return { minutes: steps[0]!, step: 0 };
	if (rating === 2) return { minutes: Math.round(steps.length === 1 ? steps[0]! * 1.5 : (steps[0]! + steps[1]!) / 2), step };
	if (rating === 3 && steps[step + 1]) return { minutes: Math.round(steps[step + 1]!), step: step + 1 };
	return { minutes: 0, step: 0 };
}

function applySteps(next: Schedule, previous: Schedule, rating: number, now: number, settings: Resolved): void {
	const { minutes, step } = learningInfo(previous, rating, settings);
	if (minutes > 0) {
		next.learning_steps = step;
		next.scheduled_days = Math.floor(minutes / 1440);
		next.state = minutes < 1440 ? (previous.state === 2 ? 3 : ((previous.state || 1) as 1 | 3)) : 2;
		next.due = now + Math.round(minutes) * MINUTE;
	} else {
		next.learning_steps = 0;
		next.state = 2;
		next.scheduled_days = interval(next.stability, settings);
		next.due = reviewDue(now, next.scheduled_days, settings.dayStart);
	}
}

/** The schedule after one review. */
export function rate(schedule: Schedule, rating: number, now = Date.now(), settings: SchedulerSettings = {}): Schedule {
	timestamp(now);
	if (!Number.isInteger(rating) || rating < 1 || rating > 4) throw new RangeError("rating must be 1–4");
	if (!schedule || !Number.isInteger(schedule.state) || schedule.state < 0 || schedule.state > 3) throw new RangeError("Invalid schedule state");
	const options = settingsFor(settings);
	const steps = schedule.state === 2 || schedule.state === 3 ? options.relearningSteps : options.learningSteps;
	if (steps.length && schedule.learning_steps >= steps.length) schedule = { ...schedule, learning_steps: steps.length - 1 }; // settings edits apply when graded
	const elapsed = schedule.state === 0 || schedule.last_review == null ? 0 : Math.max(0, ordinal(now, options.dayStart) - ordinal(schedule.last_review, options.dayStart));
	const next: Schedule = { ...schedule, elapsed_days: elapsed, reps: schedule.reps + 1, last_review: now };
	if (schedule.state === 0) {
		next.stability = Math.max(w(rating - 1), 0.1);
		next.difficulty = clamp(initDifficulty(rating), 1, 10);
	} else {
		next.difficulty = nextDifficulty(schedule.difficulty, rating);
		next.stability = schedule.state === 2 ? reviewStability(schedule, rating, elapsed) : shortStability(schedule.stability, rating);
	}
	if (schedule.state !== 2 || rating === 1) {
		if (schedule.state === 2) next.lapses += 1;
		applySteps(next, schedule, rating, now, options);
	} else {
		const hard = Math.min(interval(reviewStability(schedule, 2, elapsed), options), interval(reviewStability(schedule, 3, elapsed), options));
		const good = Math.max(interval(reviewStability(schedule, 3, elapsed), options), hard + 1);
		const easy = Math.max(interval(reviewStability(schedule, 4, elapsed), options), good + 1);
		next.scheduled_days = ({ 2: hard, 3: good, 4: easy } as Record<number, number>)[rating]!;
		next.state = 2;
		next.learning_steps = 0;
		next.due = reviewDue(now, next.scheduled_days, options.dayStart);
	}
	if (next.state === 2) next.dueDay = studyDay(next.due, options.dayStart);
	else delete next.dueDay;
	return next;
}

export function isDue(schedule: Schedule, now = Date.now(), startHour = 4): boolean {
	const today = studyDay(now, startHour);
	// Logical review dates survive timezone and rollover-setting changes.
	if (schedule.state === 2 && schedule.dueDay) return today >= schedule.dueDay;
	return schedule.due <= now;
}
