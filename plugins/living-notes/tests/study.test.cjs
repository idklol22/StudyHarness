'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const study = require('../src/study.cjs');

const deck = () => study.ensureNotebook({ id: 'nb1', title: 'Lecture 3', concepts: [] });
const T = Date.parse('2026-11-18T10:00:00Z');

test('subjects: ensure is idempotent by name; chats attach to notebooks; old decks are adopted into Unsorted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-'));
  const s = study.openSubjects(dir);
  const ml = s.ensure('Machine Learning');
  assert.equal(s.ensure('machine learning').id, ml.id);
  s.assign('nb1', ml.id);
  s.attachChat('chat_a', 'nb1');
  assert.equal(s.notebookForChat('chat_a'), 'nb1');
  assert.equal(s.adopt(['nb1', 'old']), 1);
  assert.equal(s.list().find((x) => x.id === s.subjectOf('old')).name, study.UNSORTED);
  s.forget('nb1');
  assert.equal(s.notebookForChat('chat_a'), null);
});

test('concepts grow from teaching (no slides needed) and are found by id or title', () => {
  const d = deck();
  const { concept, created } = study.addConcept(d, { title: 'Gradient descent', topic: 'Optimisation', summary: 'Step downhill.' }, T);
  assert.ok(created);
  assert.equal(study.addConcept(d, { title: 'gradient descent' }).created, false, 'no duplicates');
  assert.equal(study.conceptOf(d, 'Gradient Descent').id, concept.id);
  assert.throws(() => study.conceptOf(d, 'Nope'), /Unknown concept/);
  assert.match(d.activity.at(-1).text, /Added concept "Gradient descent"/);
});

test('notes never lose content: adds and callouts append, edits keep the previous wording', () => {
  const d = deck();
  study.addConcept(d, { title: 'Bias-variance', summary: 'Old summary.' }, T);
  study.noteUpdate(d, { concept: 'Bias-variance', add: 'Learner analogy: darts.' }, T);
  study.noteUpdate(d, { concept: 'Bias-variance', callout: { kind: 'exam', text: 'Asked every year.' } }, T);
  study.noteUpdate(d, { concept: 'Bias-variance', edit_summary: 'New summary.' }, T);
  const c = d.concepts[0];
  assert.equal(c.discussion.length, 1);
  assert.deepEqual(c.callouts.map((x) => x.kind), ['exam']);
  assert.equal(c.summary, 'New summary.');
  assert.deepEqual(c.revisions.map((r) => [r.field, r.before]), [['summary', 'Old summary.']]);
  assert.throws(() => study.noteUpdate(d, { concept: 'Bias-variance', callout: { kind: 'bogus', text: 'x' } }), /Callout kind/);
  assert.throws(() => study.noteUpdate(d, { concept: 'Bias-variance' }), /Nothing to change/);
});

test('flashcards: add (deduplicated), edit, remove, rate with FSRS', () => {
  const d = deck();
  study.addConcept(d, { title: 'ROC curve', topic: 'Evaluation' }, T);
  const [card] = study.addCards(d, [{ concept: 'ROC curve', q: 'What does the ROC curve plot?', a: 'TPR vs FPR.' }, { q: 'what does the roc curve plot?', a: 'dup' }], 'ingest', T);
  assert.equal(d.cards.length, 1);
  assert.equal(card.topic, 'Evaluation');
  study.editCard(d, { id: card.id, a: 'True positive rate against false positive rate.' }, T);
  study.rateCard(d, card.id, 3, T);
  assert.equal(d.cards[0].reviews.length, 1);
  assert.ok(d.cards[0].schedule.reps === 1);
  study.removeCard(d, card.id, T);
  assert.equal(d.cards.length, 0);
});

test('study queue: due, all (weakest first) and progressive (weakest topic first)', () => {
  const d = deck();
  study.addCards(d, [
    { topic: 'A', q: 'a1', a: '1' }, { topic: 'A', q: 'a2', a: '2' },
    { topic: 'B', q: 'b1', a: '1' }, { topic: 'B', q: 'b2', a: '2' },
  ], 'ingest', T);
  // Topic A has been studied and is solid; topic B was failed.
  for (const c of d.cards.filter((x) => x.topic === 'A')) { study.rateCard(d, c.id, 4, T); study.rateCard(d, c.id, 4, T + 60_000); }
  for (const c of d.cards.filter((x) => x.topic === 'B')) study.rateCard(d, c.id, 1, T);
  const later = T + 5 * 60_000;
  const prog = study.studyQueue(d.cards, { mode: 'progressive' }, later);
  assert.equal(prog.topic, 'B');
  assert.ok(prog.cards.every((c) => c.topic === 'B'));
  assert.equal(study.studyQueue(d.cards, { mode: 'all', topics: ['A'] }, later).cards.length, 2);
  assert.ok(study.studyQueue(d.cards, { mode: 'due' }, later).cards.every((c) => c.topic === 'B'));
});

test('notebook summary counts concepts, cards and due cards', () => {
  const d = deck();
  study.addConcept(d, { title: 'X', topic: 'T' }, T);
  study.addCards(d, [{ q: 'q', a: 'a' }], 'ingest', T);
  const s = study.notebookSummary(d, 'sub1');
  assert.equal(s.concepts, 1);
  assert.equal(s.cards, 1);
  assert.equal(s.subjectId, 'sub1');
  assert.deepEqual(s.topics, ['T']);
});
