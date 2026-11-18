'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newConcept } = require('../src/state.cjs');
const { performGrade, performNoteUpdate, queueMessage } = require('../src/tutor.cjs');
const { buildNotesMarkdown } = require('../src/notes.cjs');

const deck = () => ({ id: 'd', title: 'Maths', examDate: null, concepts: [newConcept({ id: 'a', title: 'Derivative', slides: [3, 4] })] });
const session = (hinted = []) => ({ id: 's1', hinted: new Set(hinted) });
const args = (o = {}) => ({ concept_id: 'a', grade: 'right', confidence: 'sure', learner_answer: 'the slope', feedback: 'Matches slide 3.', slides: [3], ...o });

test('a sure right answer is recorded and status decided by code', () => {
  const r = performGrade(deck(), session(), args());
  assert.equal(r.deck.concepts[0].status, 'ok');
  assert.match(r.message, /now ok/);
});

test('unsure grades record nothing', () => {
  const d = deck();
  const r = performGrade(d, session(), args({ confidence: 'unsure' }));
  assert.equal(r.deck, d);
  assert.equal(d.concepts[0].timesAsked, 0);
});

test('a hint given earlier forces hinted, so no promotion', () => {
  const r = performGrade(deck(), session(['a']), args());
  assert.equal(r.deck.concepts[0].status, 'shaky');
  assert.match(r.message, /hinted/);
});

test('grades must cite slides belonging to the concept', () => {
  assert.throws(() => performGrade(deck(), session(), args({ slides: [9] })), /not part of this concept/);
  assert.throws(() => performGrade(deck(), session(), args({ slides: [] })), /Cite/);
});

test('learner answer and feedback are mandatory; unknown concept refused', () => {
  assert.throws(() => performGrade(deck(), session(), args({ learner_answer: ' ' })), /learner_answer/);
  assert.throws(() => performGrade(deck(), session(), args({ feedback: '' })), /feedback/);
  assert.throws(() => performGrade(deck(), session(), args({ concept_id: 'zzz' })), /Unknown concept_id/);
});

test('wrong answer stores the learner words for the mistakes log', () => {
  const r = performGrade(deck(), session(), args({ grade: 'wrong', learner_answer: 'area under curve', feedback: 'It is slope (slide 3).' }));
  assert.equal(r.deck.concepts[0].wrong[0].text, 'area under curve');
  assert.equal(r.deck.concepts[0].status, 'shaky');
});

test('queue message lists due concepts, or says nothing is due', () => {
  assert.match(queueMessage(deck()), /"concept_id": "a"/);
  const d = deck(); d.concepts = [];
  assert.match(queueMessage(d), /Nothing is due/);
});

test('discussion updates the notes without touching status', () => {
  const r = performNoteUpdate(deck(), session(), { concept_id: 'a', slides: [3], clarification: 'Slope is rise over run: $f(x+h)-f(x)$ over $h$.', add_qa: [{ q: 'Why divide by h?', a: 'To get a rate, not a change.' }], technique: 'Always write the limit first.' });
  const c = r.deck.concepts[0];
  assert.equal(c.status, 'new');
  assert.equal(c.timesAsked, 0);
  const md = buildNotesMarkdown({ title: 'M', concepts: r.deck.concepts });
  assert.match(md, /:::discussion/);
  assert.match(md, /Slope is rise over run/);
  assert.match(md, /Why divide by h\?/);
  assert.match(md, /Always write the limit first/);
});

test('note updates must cite slides of that concept and change something', () => {
  assert.throws(() => performNoteUpdate(deck(), session(), { concept_id: 'a', slides: [9], clarification: 'x' }), /not part of this concept/);
  assert.throws(() => performNoteUpdate(deck(), session(), { concept_id: 'a', slides: [3] }), /Nothing to update/);
});

test('every concept shows its worked example (even new); solid keeps only the key formula', () => {
  const d = deck(); d.concepts[0].steps = [{ math: 'a=b', note: 'first' }, { math: 'c=d', note: 'last' }];
  assert.match(buildNotesMarkdown({ title: 'M', concepts: d.concepts }), /Worked example[\s\S]*a=b[\s\S]*c=d/);
  d.concepts[0].status = 'solid';
  const md = buildNotesMarkdown({ title: 'M', concepts: d.concepts });
  assert.match(md, /Key formula/);
  assert.doesNotMatch(md, /a=b/);
});
