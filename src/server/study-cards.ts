/**
 * Study cards service: a scope's flashcards for the Cards panel (the learner adds, edits and removes cards here;
 * the agent adds cards and records ratings through its own tools). A topic scope holds that topic's cards, a
 * subject scope holds the subject's own ("General") plus every topic's, each labelled with its topic's name.
 */
import { addCards, editCard, emptyCards, groupSummaries, removeCard, type Card, type CardSet, type GroupSummary } from "../core/study/cards.ts";
import { topicOf, topicsOf, type StudyScope } from "../core/study/model.ts";
import { studyStore } from "../store/study.ts";
import { checkedScope } from "./study-notes.ts";
import { study } from "./study-runtime.ts";

const load = (key: string): CardSet => studyStore.readDoc<CardSet>("cards", key, emptyCards());

function owners(scope: StudyScope): Array<{ key: string; group: string }> {
	const lib = study.library();
	if (scope.topicId) return [{ key: scope.topicId, group: topicOf(lib, scope.topicId)!.name }];
	return [{ key: scope.subjectId, group: "General" }, ...topicsOf(lib, scope.subjectId).map((t) => ({ key: t.id, group: t.name }))];
}

export function readCards(scope: StudyScope): { cards: Card[]; groups: GroupSummary[] } {
	checkedScope(scope);
	const cards = owners(scope).flatMap((o) => load(o.key).cards.map((c) => ({ ...c, group: o.group })));
	return { cards, groups: groupSummaries(cards) };
}

export type CardOp =
	| { kind: "add"; q: unknown; a: unknown; topicId?: string }
	| { kind: "edit"; id: string; q?: unknown; a?: unknown }
	| { kind: "remove"; id: string };

/** The learner's card changes. New cards go to the topic (or the chosen topic of a subject page), else the subject. */
export function changeCards(scope: StudyScope, op: CardOp): { cards: Card[]; groups: GroupSummary[] } {
	checkedScope(scope);
	const all = owners(scope);
	if (op.kind === "add") {
		const target = all.find((o) => o.key === (op.topicId ?? scope.topicId ?? scope.subjectId)) ?? all[0]!;
		const result = addCards(load(target.key), [{ q: op.q, a: op.a, group: target.group }], "learner");
		studyStore.writeDoc("cards", target.key, result.set);
		if (!result.added.length) throw new Error("You already have a card with that question.");
	} else {
		const owner = all.find((o) => load(o.key).cards.some((c) => c.id === op.id));
		if (!owner) throw new Error("That card no longer exists.");
		const set = load(owner.key);
		studyStore.writeDoc("cards", owner.key, op.kind === "remove" ? removeCard(set, op.id) : editCard(set, op.id, { q: op.q, a: op.a }));
	}
	return readCards(scope);
}
