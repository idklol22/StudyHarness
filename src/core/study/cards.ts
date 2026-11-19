/**
 * Study flashcards (Study overhaul, owner 2026-11-19): cards live with a topic (or a subject, subject-wide), are
 * written by the agent while teaching or by the learner, and are studied in three modes:
 *   due          FSRS-due cards (spaced repetition), soonest first;
 *   progressive  one TOPIC at a time, weakest topic first (from past ratings and lapses), weakest cards first —
 *                "optimize them based on my past records";
 *   all          everything selected, weakest first.
 * Pure: a `CardSet` is plain data the store persists per scope; every function returns new data.
 */
import { createSchedule, isDue, rate, type Rating, type Schedule } from "./fsrs.ts";

export interface Review { at: number; rating: Rating }
export interface Card {
	id: string;
	q: string;
	a: string;
	/** The grouping label (the topic's name; "General" for subject-wide cards). Set when the set is loaded. */
	group: string;
	createdBy: "agent" | "learner";
	createdAt: number;
	updatedAt: number;
	/** Where in the material it came from, when known. */
	source?: { materialId?: string; page?: number };
	schedule: Schedule;
	reviews: Review[];
}
export interface CardSet { version: 1; cards: Card[] }
export const emptyCards = (): CardSet => ({ version: 1, cards: [] });

const fail = (m: string): never => { throw new Error(m); };
const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+\n/g, "\n").trim() : "");
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const MAX_REVIEWS = 60;
const MAX_TEXT = 4000;

export interface NewCard { q: unknown; a: unknown; group?: string; source?: Card["source"] }

/** Add cards, skipping any whose question already exists (case/space-insensitively). */
export function addCards(set: CardSet, inputs: readonly NewCard[], createdBy: Card["createdBy"] = "agent", now = Date.now(), makeId: () => string = () => `card_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`): { set: CardSet; added: Card[]; skipped: number } {
	if (!inputs.length) fail("Give at least one card.");
	const seen = new Set(set.cards.map((c) => norm(c.q)));
	const added: Card[] = [];
	let skipped = 0;
	for (const input of inputs) {
		const q = text(input.q), a = text(input.a);
		if (!q || !a) fail("Every card needs a question (q) and an answer (a).");
		if (q.length > MAX_TEXT || a.length > MAX_TEXT) fail(`Keep questions and answers under ${MAX_TEXT} characters.`);
		if (seen.has(norm(q))) { skipped++; continue; }
		seen.add(norm(q));
		added.push({ id: makeId(), q, a, group: text(input.group) || "General", createdBy, createdAt: now, updatedAt: now, ...(input.source ? { source: input.source } : {}), schedule: createSchedule(now), reviews: [] });
	}
	return { set: { ...set, cards: [...set.cards, ...added] }, added, skipped };
}

const find = (set: CardSet, id: string): Card => set.cards.find((c) => c.id === id) ?? fail("That card no longer exists.");

/** Change a card's wording; its schedule and history are kept. */
export function editCard(set: CardSet, id: string, patch: { q?: unknown; a?: unknown }, now = Date.now()): CardSet {
	const card = find(set, id);
	const q = patch.q === undefined ? card.q : text(patch.q), a = patch.a === undefined ? card.a : text(patch.a);
	if (!q || !a) fail("A card needs a question and an answer.");
	if (set.cards.some((c) => c.id !== id && norm(c.q) === norm(q))) fail("Another card already has that question.");
	return { ...set, cards: set.cards.map((c) => (c.id === id ? { ...c, q, a, updatedAt: now } : c)) };
}

export function removeCard(set: CardSet, id: string): CardSet {
	find(set, id);
	return { ...set, cards: set.cards.filter((c) => c.id !== id) };
}

/** Record a review (1 again, 2 hard, 3 good, 4 easy) with FSRS scheduling. */
export function rateCard(set: CardSet, id: string, rating: number, now = Date.now()): { set: CardSet; card: Card } {
	const card = find(set, id);
	const schedule = rate(card.schedule, rating, now);
	const next: Card = { ...card, schedule, reviews: [...card.reviews, { at: now, rating: rating as Rating }].slice(-MAX_REVIEWS), updatedAt: now };
	return { set: { ...set, cards: set.cards.map((c) => (c.id === id ? next : c)) }, card: next };
}

/** How shaky a group of cards is: 0 = solid, higher = weaker (never seen, recent hard/again, lapses). */
export function weakness(cards: readonly Card[]): number {
	if (!cards.length) return 0;
	let score = 0;
	for (const c of cards) {
		const low = c.reviews.slice(-3).filter((r) => r.rating <= 2).length;
		score += (c.reviews.length === 0 ? 1.5 : 0) + low * 2 + (c.schedule.lapses ?? 0) * 0.8;
	}
	return score / cards.length;
}

export type StudyMode = "due" | "progressive" | "all";
export interface Queue { cards: Card[]; /** progressive only: the topic being studied now and the order of the rest. */ group?: string; groupOrder: string[] }

/** The cards to study now. `groups` limits to those topics. */
export function studyQueue(cards: readonly Card[], options: { mode: StudyMode; groups?: readonly string[] | null }, now = Date.now()): Queue {
	const pool = options.groups?.length ? cards.filter((c) => options.groups!.includes(c.group)) : [...cards];
	const weak = (c: Card) => weakness([c]);
	if (options.mode === "all") return { cards: pool.sort((a, b) => weak(b) - weak(a)), groupOrder: [] };
	if (options.mode === "due") return { cards: pool.filter((c) => isDue(c.schedule, now)).sort((a, b) => a.schedule.due - b.schedule.due), groupOrder: [] };
	if (options.mode !== "progressive") return fail("mode must be due, progressive or all.");
	const byGroup = new Map<string, Card[]>();
	for (const c of pool) byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]);
	const order = [...byGroup.entries()]
		.map(([group, list]) => ({ group, weak: weakness(list), due: list.filter((c) => isDue(c.schedule, now)).length }))
		.filter((x) => x.due > 0 || x.weak > 0.5)
		.sort((a, b) => b.weak - a.weak || b.due - a.due || a.group.localeCompare(b.group));
	if (!order.length) return { cards: [], groupOrder: [] };
	const current = [...byGroup.get(order[0]!.group)!].sort((a, b) => weak(b) - weak(a));
	return { cards: current, group: order[0]!.group, groupOrder: order.map((x) => x.group) };
}

export interface GroupSummary { group: string; total: number; due: number; weakness: number }
/** Per-group counts for the topic list ("study these topics"). */
export function groupSummaries(cards: readonly Card[], now = Date.now()): GroupSummary[] {
	const by = new Map<string, Card[]>();
	for (const c of cards) by.set(c.group, [...(by.get(c.group) ?? []), c]);
	return [...by.entries()].map(([group, list]) => ({ group, total: list.length, due: list.filter((c) => isDue(c.schedule, now)).length, weakness: weakness(list) })).sort((a, b) => a.group.localeCompare(b.group));
}
