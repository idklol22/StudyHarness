'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newConcept, applyAnswer } = require('../src/state.cjs');
const { buildNotesMarkdown } = require('../src/notes.cjs');

const T0 = Date.UTC(2026, 0, 1, 10);
const base = () => ([
  { ...newConcept({ id: 'a', title: 'Derivative', summary: 'Rate of change of f at a point.', slides: [3, 4], topic: 'Calculus', order: 0 }),
    technique: 'Write the limit definition first.', steps: [{ math: "f'(x)=\\lim_{h\\to0}\\frac{f(x+h)-f(x)}{h}", note: 'Slope of a tiny secant line.' }],
    qa: [{ q: 'What does f\'(x) measure?', a: 'Instantaneous rate of change.', slides: [3] }] },
  { ...newConcept({ id: 'b', title: 'Chain rule', summary: 'Derivative of a composition.', slides: [7], topic: 'Calculus', order: 1 }) },
]);

test('different answers produce different notes from the same slides', () => {
  const strong = base(); strong[0] = applyAnswer(strong[0], { grade: 'right', session: 's1', now: T0 });
  strong[0] = applyAnswer(strong[0], { grade: 'right', session: 's2', now: T0 + 3 * 86400000 });
  const weak = base(); weak[0] = applyAnswer(weak[0], { grade: 'wrong', session: 's1', now: T0, text: 'it is the area under the curve', note: 'It is the slope, not area (slide 3).' });
  const a = buildNotesMarkdown({ title: 'Maths', concepts: strong }, T0);
  const b = buildNotesMarkdown({ title: 'Maths', concepts: weak }, T0);
  assert.notEqual(a, b);
  assert.ok(!a.includes('Worked example'), 'solid concepts are compressed');
  assert.ok(b.includes('Worked example'), 'shaky concepts are expanded');
  assert.match(b, /:::revisit/);
  assert.match(b, /I said:\*\* it is the area under the curve/);
  assert.match(b, /Actually:\*\* It is the slope/);
  assert.ok(!a.includes('Come back to this'));
});

test('every concept heading and Q&A cites slides', () => {
  const md = buildNotesMarkdown({ title: 'M', concepts: base() }, T0);
  assert.match(md, /### Derivative .*\[\[slide 3\]\] \[\[slide 4\]\]/);
  const c = base(); c[0] = applyAnswer(c[0], { grade: 'wrong', session: 's', now: T0, text: 'x', note: 'y' });
  assert.match(buildNotesMarkdown({ title: 'M', concepts: c }, T0), /A:\*\* Instantaneous rate of change\. \[\[slide 3\]\]/);
});

test('maths is one step per line with a plain-language note', () => {
  const c = base(); c[0] = applyAnswer(c[0], { grade: 'wrong', session: 's', now: T0, text: 'x', note: 'y' });
  const md = buildNotesMarkdown({ title: 'M', concepts: c }, T0);
  assert.match(md, /1\. \$\$f'\(x\)=.*\$\$\n   > Slope of a tiny secant line\./);
});

test('technique box appears per topic; revisit list leads the notes', () => {
  const c = base(); c[1] = applyAnswer(c[1], { grade: 'missing', session: 's', now: T0, text: 'forgot inner derivative', note: 'multiply by inner derivative' });
  const md = buildNotesMarkdown({ title: 'M', concepts: c }, T0);
  assert.match(md, /:::technique\n\*\*How to answer these\*\*\n- Write the limit definition first\./);
  assert.ok(md.indexOf('Revisit first') < md.indexOf('## Calculus'));
});
