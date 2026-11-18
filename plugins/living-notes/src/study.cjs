'use strict';
// Study (Living Notes, redesigned — owner, 2026-11-18): subjects → notebooks → concepts, notes,
// flashcards and an activity feed. A notebook is the existing deck record (one JSON file per deck,
// store.cjs), extended; older decks load unchanged and land in an "Unsorted" subject.
//
// Rules the owner set:
//   - notes are never deleted: the agent ADDS clarifications and callouts, and an EDIT keeps the
//     previous wording in the concept's revision history;
//   - flashcards can be added, edited and removed as the tutor learns what the learner knows;
//   - callouts mark what matters: revisit, crucial, likely exam material, common mistake, tip;
//   - every change is announced in the notebook's activity feed so the learner sees it happen.
//
// Pure functions over plain objects (the backend saves); the subjects index is its own small file.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const scheduler = require('../../flashcards/src/scheduler.cjs');

const fail = (m) => { throw new Error(m); };
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const now = () => Date.now();
const iso = (t) => new Date(t).toISOString();

const CALLOUTS = ['revisit', 'crucial', 'exam', 'mistake', 'tip'];
const CALLOUT_LABEL = { revisit: 'Revisit this', crucial: 'Crucial', exam: 'Likely exam material', mistake: 'Common mistake', tip: 'Tip' };
const ORIGINS = ['slides', 'topic', 'paper'];
const MAX_ACTIVITY = 400;
const UNSORTED = 'Unsorted';

// ─── Subjects index ────────────────────────────────────────────────────────────

function openSubjects(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'subjects.json');
  const read = () => {
    try {
      const v = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { version: 1, subjects: Array.isArray(v.subjects) ? v.subjects : [], notebooks: v.notebooks ?? {}, chats: v.chats ?? {} };
    } catch (e) {
      if (e.code === 'ENOENT') return { version: 1, subjects: [], notebooks: {}, chats: {} };
      throw e;
    }
  };
  const write = (v) => { const tmp = `${file}.${randomUUID()}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v, null, 2)); fs.renameSync(tmp, file); };
  const change = (fn) => { const v = read(); const out = fn(v); write(v); return out; };
  const findByName = (v, name) => v.subjects.find((s) => s.name.toLowerCase() === name.toLowerCase());
  return {
    read,
    list: () => read().subjects,
    /** The subject with this name, created when missing. */
    ensure(name) {
      const n = text(name) || UNSORTED;
      if (n.length > 120) fail('Subject names are at most 120 characters.');
      return change((v) => {
        const found = findByName(v, n);
        if (found) return found;
        const s = { id: randomUUID(), name: n, createdAt: iso(now()) };
        v.subjects.push(s);
        return s;
      });
    },
    rename(id, name) {
      const n = text(name);
      if (!n) fail('Give the subject a name.');
      return change((v) => {
        const s = v.subjects.find((x) => x.id === id) ?? fail('Subject not found.');
        if (findByName(v, n) && findByName(v, n).id !== id) fail('Another subject already has that name.');
        s.name = n;
        return s;
      });
    },
    assign(notebookId, subjectId) { return change((v) => { if (!v.subjects.some((s) => s.id === subjectId)) fail('Subject not found.'); v.notebooks[notebookId] = subjectId; return subjectId; }); },
    subjectOf: (notebookId) => read().notebooks[notebookId] ?? null,
    attachChat(chatId, notebookId) { return change((v) => { v.chats[chatId] = notebookId; return notebookId; }); },
    notebookForChat: (chatId) => read().chats[chatId] ?? null,
    forget(notebookId) {
      return change((v) => {
        delete v.notebooks[notebookId];
        for (const [c, n] of Object.entries(v.chats)) if (n === notebookId) delete v.chats[c];
      });
    },
    /** Older decks have no subject: file them under "Unsorted" (once, idempotent). */
    adopt(notebookIds) {
      const missing = notebookIds.filter((id) => !read().notebooks[id]);
      if (!missing.length) return 0;
      const unsorted = this.ensure(UNSORTED);
      change((v) => { for (const id of missing) v.notebooks[id] = unsorted.id; });
      return missing.length;
    },
  };
}

// ─── Notebook shape ──────────────────────────────────────────────────────────────

/** Fill the fields a Study notebook adds to a Living Notes deck (in place; returns it). */
function ensureNotebook(deck) {
  deck.origin = ORIGINS.includes(deck.origin) ? deck.origin : 'slides';
  deck.sources = Array.isArray(deck.sources) ? deck.sources : [];
  deck.cards = Array.isArray(deck.cards) ? deck.cards : [];
  deck.activity = Array.isArray(deck.activity) ? deck.activity : [];
  for (const c of deck.concepts) {
    c.callouts = Array.isArray(c.callouts) ? c.callouts : [];
    c.revisions = Array.isArray(c.revisions) ? c.revisions : [];
    c.discussion = Array.isArray(c.discussion) ? c.discussion : [];
    c.figures = Array.isArray(c.figures) ? c.figures : [];
  }
  return deck;
}

function log(deck, message, kind = 'info', t = now()) {
  deck.activity.push({ at: iso(t), kind, text: message });
  if (deck.activity.length > MAX_ACTIVITY) deck.activity.splice(0, deck.activity.length - MAX_ACTIVITY);
  return message;
}

const conceptOf = (deck, ref) => {
  const key = text(ref).toLowerCase();
  return deck.concepts.find((c) => c.id === ref) ?? deck.concepts.find((c) => c.title.toLowerCase() === key)
    ?? fail(`Unknown concept "${ref}". Known: ${deck.concepts.map((c) => c.title).slice(0, 30).join(', ') || '(none yet)'}.`);
};

const slugify = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'concept';

/** Add a concept the tutor is teaching (topic/paper notebooks grow this way; slides are optional). */
function addConcept(deck, { title, topic, summary, slides }, t = now()) {
  const name = text(title);
  if (!name) fail('A concept needs a title.');
  const existing = deck.concepts.find((c) => c.title.toLowerCase() === name.toLowerCase());
  if (existing) return { concept: existing, created: false };
  let id = slugify(name), n = 2;
  while (deck.concepts.some((c) => c.id === id)) id = `${slugify(name)}-${n++}`;
  const concept = {
    id, title: name, topic: text(topic) || 'General', summary: text(summary), order: deck.concepts.length,
    slides: Array.isArray(slides) ? slides.filter((x) => Number.isInteger(x) && x > 0) : [],
    status: 'new', right: [], missed: [], wrong: [], technique: '', steps: [], qa: [], source: '', visual: '',
    figures: [], discussion: [], links: [], callouts: [], revisions: [],
    timesAsked: 0, lastAsked: null, nextRevisit: null, cleanStreak: 0, okSession: null, history: [],
  };
  deck.concepts.push(concept);
  log(deck, `Added concept "${name}" to ${concept.topic}.`, 'concept', t);
  return { concept, created: true };
}

/** Notes only grow: add a clarification or a callout; edit the summary keeping the old wording. */
function noteUpdate(deck, args, t = now()) {
  const c = conceptOf(deck, args.concept);
  const changed = [];
  const add = text(args.add);
  if (add) { c.discussion.push({ text: add, at: iso(t) }); changed.push('a note'); log(deck, `Added a note to "${c.title}".`, 'note', t); }
  if (args.callout) {
    const kind = args.callout.kind;
    if (!CALLOUTS.includes(kind)) fail(`Callout kind must be one of ${CALLOUTS.join(', ')}.`);
    const body = text(args.callout.text);
    if (!body) fail('A callout needs text.');
    if (!c.callouts.some((x) => x.kind === kind && x.text === body)) {
      c.callouts.push({ kind, text: body, at: iso(t) });
      changed.push(`a "${CALLOUT_LABEL[kind]}" callout`);
      log(deck, `Marked "${c.title}": ${CALLOUT_LABEL[kind]}.`, 'callout', t);
    }
  }
  const summary = text(args.edit_summary);
  if (summary && summary !== c.summary) {
    c.revisions.push({ field: 'summary', before: c.summary, at: iso(t) });
    c.summary = summary;
    changed.push('the summary (previous wording kept)');
    log(deck, `Rewrote the summary of "${c.title}" (the old wording is kept in its history).`, 'note', t);
  }
  const technique = text(args.technique);
  if (technique && technique !== c.technique) {
    if (c.technique) c.revisions.push({ field: 'technique', before: c.technique, at: iso(t) });
    c.technique = technique;
    changed.push('exam technique');
    log(deck, `Updated the exam technique for "${c.title}".`, 'note', t);
  }
  if (!changed.length) fail('Nothing to change: give add, callout, edit_summary or technique.');
  return { concept: c, message: `Notes for "${c.title}": added/updated ${changed.join(', ')}.` };
}

// ─── Flashcards ─────────────────────────────────────────────────────────────────

function addCards(deck, cards, createdBy = 'tutor', t = now()) {
  if (!Array.isArray(cards) || !cards.length) fail('Give at least one card.');
  const added = [];
  for (const card of cards) {
    const q = text(card.q), a = text(card.a);
    if (!q || !a) fail('Every card needs a question (q) and an answer (a).');
    if (deck.cards.some((x) => x.q.toLowerCase() === q.toLowerCase())) continue; // no duplicates
    const concept = card.concept ? conceptOf(deck, card.concept) : null;
    const entry = {
      id: randomUUID(), conceptId: concept?.id ?? null, topic: text(card.topic) || concept?.topic || 'General',
      q, a, createdBy, createdAt: iso(t), updatedAt: iso(t), schedule: scheduler.createSchedule(t), reviews: [],
    };
    deck.cards.push(entry);
    added.push(entry);
  }
  if (added.length) log(deck, `Added ${added.length} flashcard${added.length === 1 ? '' : 's'}${added[0].topic ? ` to ${[...new Set(added.map((c) => c.topic))].join(', ')}` : ''}.`, 'cards', t);
  return added;
}

function editCard(deck, { id, q, a }, t = now()) {
  const card = deck.cards.find((c) => c.id === id) ?? fail('Card not found.');
  const nq = text(q), na = text(a);
  if (!nq && !na) fail('Give a new question or answer.');
  if (nq) card.q = nq;
  if (na) card.a = na;
  card.updatedAt = iso(t);
  log(deck, `Edited a flashcard: "${card.q.slice(0, 60)}".`, 'cards', t);
  return card;
}

function removeCard(deck, id, t = now()) {
  const i = deck.cards.findIndex((c) => c.id === id);
  if (i < 0) fail('Card not found.');
  const [card] = deck.cards.splice(i, 1);
  log(deck, `Removed a flashcard: "${card.q.slice(0, 60)}".`, 'cards', t);
  return card;
}

/** Record a review: 1 again, 2 hard, 3 good, 4 easy (FSRS-6, shared with the Flashcards plugin). */
function rateCard(deck, id, rating, t = now()) {
  const card = deck.cards.find((c) => c.id === id) ?? fail('Card not found.');
  card.schedule = scheduler.rate(card.schedule, rating, t);
  card.reviews.push({ at: iso(t), rating });
  if (card.reviews.length > 60) card.reviews.splice(0, card.reviews.length - 60);
  return card;
}

/** How shaky a set of cards is (0 = mastered … higher = weaker), from past ratings and lapses. */
function weakness(cards) {
  if (!cards.length) return 0;
  let score = 0;
  for (const c of cards) {
    const recent = c.reviews.slice(-3);
    const unseen = c.reviews.length === 0 ? 1.5 : 0;
    const low = recent.filter((r) => r.rating <= 2).length;
    score += unseen + low * 1.2 + (c.schedule.lapses ?? 0) * 0.8;
  }
  return score / cards.length;
}

/**
 * The cards to study.
 *   mode "due":         FSRS-due cards (and new ones), soonest first.
 *   mode "all":         every card in the selection, weakest first.
 *   mode "progressive": topic by topic, weakest topic first (from past ratings), new and failed
 *                       cards first inside it; returns only the current topic's cards plus the
 *                       order of the remaining topics.
 */
function studyQueue(cards, { mode = 'due', topics = null } = {}, t = now()) {
  const pool = topics && topics.length ? cards.filter((c) => topics.includes(c.topic)) : cards.slice();
  const cardWeak = (c) => weakness([c]);
  if (mode === 'all') return { cards: pool.sort((a, b) => cardWeak(b) - cardWeak(a)), topicOrder: [] };
  if (mode === 'due') {
    const due = pool.filter((c) => scheduler.isDue(c.schedule, t)).sort((a, b) => a.schedule.due - b.schedule.due);
    return { cards: due, topicOrder: [] };
  }
  if (mode !== 'progressive') fail('mode must be due, all or progressive.');
  const byTopic = new Map();
  for (const c of pool) byTopic.set(c.topic, [...(byTopic.get(c.topic) ?? []), c]);
  const order = [...byTopic.entries()]
    .map(([topic, list]) => ({ topic, weak: weakness(list), due: list.filter((c) => scheduler.isDue(c.schedule, t)).length }))
    .filter((x) => x.due > 0 || x.weak > 0.5)
    .sort((a, b) => b.weak - a.weak || b.due - a.due || (a.topic < b.topic ? -1 : 1));
  if (!order.length) return { cards: [], topicOrder: [] };
  const current = byTopic.get(order[0].topic).slice().sort((a, b) => cardWeak(b) - cardWeak(a));
  return { cards: current, topicOrder: order.map((x) => x.topic), topic: order[0].topic };
}

/** A compact summary of a notebook for lists (no heavy fields). */
function notebookSummary(deck, subjectId = null) {
  const statuses = Object.fromEntries(['new', 'shaky', 'ok', 'solid'].map((s) => [s, deck.concepts.filter((c) => c.status === s).length]));
  return {
    id: deck.id, title: deck.title, subjectId, origin: deck.origin ?? 'slides', updatedAt: deck.updatedAt ?? deck.createdAt,
    concepts: deck.concepts.length, cards: (deck.cards ?? []).length, sources: (deck.sources ?? []).map((s) => ({ id: s.id, fileName: s.fileName, pageCount: s.pageCount })),
    topics: [...new Set(deck.concepts.map((c) => c.topic))], counts: statuses,
    due: (deck.cards ?? []).filter((c) => scheduler.isDue(c.schedule)).length,
  };
}

module.exports = {
  CALLOUTS, CALLOUT_LABEL, ORIGINS, UNSORTED,
  openSubjects, ensureNotebook, log, conceptOf, addConcept, noteUpdate,
  addCards, editCard, removeCard, rateCard, weakness, studyQueue, notebookSummary,
};
