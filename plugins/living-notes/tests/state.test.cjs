'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newConcept, applyAnswer, sessionQueue, nextRevisitAfter } = require('../src/state.cjs');

const T0 = Date.UTC(2026, 0, 1, 10);
const day = n => T0 + n * 86400000;
const make = () => newConcept({ id: 'c1', title: 'Gradient', slides: [4, 5] });

test('a concept must cite slides', () => {
  assert.throws(() => newConcept({ id: 'x', title: 'X', slides: [] }), /slide/);
});

test('right without hints: new -> ok, not solid', () => {
  const c = applyAnswer(make(), { grade: 'right', session: 's1', now: T0 });
  assert.equal(c.status, 'ok');
});

test('ok becomes solid only on a LATER session', () => {
  let c = applyAnswer(make(), { grade: 'right', session: 's1', now: T0 });
  c = applyAnswer(c, { grade: 'right', session: 's1', now: T0 + 1000 });
  assert.equal(c.status, 'ok', 'same session must not promote');
  c = applyAnswer(c, { grade: 'right', session: 's2', now: day(3) });
  assert.equal(c.status, 'solid');
});

test('a hinted right answer never promotes', () => {
  let c = applyAnswer(make(), { grade: 'right', hinted: true, session: 's1', now: T0 });
  assert.equal(c.status, 'shaky');
  c = applyAnswer(c, { grade: 'right', hinted: true, session: 's2', now: day(1) });
  assert.equal(c.status, 'shaky');
});

test('wrong answer drops anything to shaky and records the learner words', () => {
  let c = applyAnswer(make(), { grade: 'right', session: 's1', now: T0 });
  c = applyAnswer(c, { grade: 'right', session: 's2', now: day(2) });
  assert.equal(c.status, 'solid');
  c = applyAnswer(c, { grade: 'wrong', session: 's3', now: day(9), text: 'slope is always positive', note: 'Slide 4: can be negative' });
  assert.equal(c.status, 'shaky');
  assert.equal(c.wrong[0].text, 'slope is always positive');
  assert.equal(c.cleanStreak, 0);
  assert.equal(c.okSession, null);
});

test('missing demotes solid to ok, others to shaky', () => {
  let c = applyAnswer(make(), { grade: 'right', session: 's1', now: T0 });
  c = applyAnswer(c, { grade: 'right', session: 's2', now: day(2) });
  assert.equal(applyAnswer(c, { grade: 'missing', session: 's3', now: day(9) }).status, 'ok');
  const ok = applyAnswer(make(), { grade: 'right', session: 's1', now: T0 });
  assert.equal(applyAnswer(ok, { grade: 'missing', session: 's2', now: day(1) }).status, 'shaky');
});

test('after a promotion, getting it wrong in the same session then right needs a later session again', () => {
  let c = applyAnswer(make(), { grade: 'wrong', session: 's1', now: T0 });
  c = applyAnswer(c, { grade: 'right', session: 's1', now: T0 + 1 });
  assert.equal(c.status, 'ok');
  c = applyAnswer(c, { grade: 'right', session: 's1', now: T0 + 2 });
  assert.equal(c.status, 'ok');
});

test('revisit gaps grow 1, 3, 7, 14 days', () => {
  let c = applyAnswer(make(), { grade: 'right', session: 's1', now: T0 });
  const gaps = [];
  const days = () => Math.round((new Date(c.nextRevisit) - Date.UTC(2026, 0, 1)) / 86400000);
  gaps.push(days());
  for (let i = 2; i <= 4; i++) { c = applyAnswer(c, { grade: 'right', session: 's' + i, now: T0 }); gaps.push(days()); }
  assert.deepEqual(gaps, [1, 3, 7, 14]);
});

test('exam date compresses the revisit gap and caps it before the exam', () => {
  const exam = day(4);
  assert.equal(nextRevisitAfter(14, T0, exam), new Date(Date.UTC(2026, 0, 3)).toISOString());
  assert.equal(nextRevisitAfter(14, T0, day(-1)), new Date(Date.UTC(2026, 0, 1)).toISOString());
});

test('session queue: shaky first, then due, then new; not-yet-due ok excluded', () => {
  const shaky = applyAnswer(newConcept({ id: 'a', title: 'A', slides: [1], order: 2 }), { grade: 'wrong', session: 's', now: T0 });
  const ok = applyAnswer(newConcept({ id: 'b', title: 'B', slides: [2], order: 1 }), { grade: 'right', session: 's', now: T0 });
  const fresh = newConcept({ id: 'c', title: 'C', slides: [3], order: 0 });
  assert.deepEqual(sessionQueue([fresh, ok, shaky], T0 + 1000).map(c => c.id), ['a', 'c']);
  assert.deepEqual(sessionQueue([fresh, ok, shaky], day(5)).map(c => c.id), ['a', 'b', 'c']);
});

test('applyAnswer is pure and validates input', () => {
  const c = make();
  applyAnswer(c, { grade: 'right', session: 's1', now: T0 });
  assert.equal(c.status, 'new');
  assert.throws(() => applyAnswer(c, { grade: 'great', session: 's' }), /Grade/);
  assert.throws(() => applyAnswer(c, { grade: 'right' }), /session/);
});
