'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStore } = require('../src/store.cjs');
const { createPages } = require('../src/pages.cjs');
const study = require('../src/study.cjs');
const { createStudyTools } = require('../src/study-tools.cjs');

// A tiny valid-looking PNG (signature + IHDR-sized header + padding).
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]).toString('base64');
const reply = (obj) => ({ stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify(obj) }] });
const concept = (title, slides, extra = {}) => ({ title, topic: 'Regression', summary: `${title} summary`, slides, visual: '', technique: '', steps: [], qa: [{ q: `What is ${title}?`, a: `${title} is …` }], links: [], ...extra });

function harness(replies = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-tools-'));
  const store = openStore(path.join(dir, 'decks'));
  const pages = createPages(path.join(dir, 'pages'));
  const subjects = study.openSubjects(dir);
  const events = [];
  const ctx = {
    inference: {
      catalog: async () => ({ models: [], slots: { vision: { model: { provider: 'p', id: 'vision' } } } }),
      complete: async () => replies.shift(),
    },
    documents: {
      pdfInfo: async (p) => ({ path: p, pageCount: 5 }),
      renderPdfPages: async ({ pages: nums }) => nums.map((n) => ({ page: n, png: PNG, width: 160, height: 90, text: `slide ${n} text` })),
    },
  };
  const touched = [];
  const create = createStudyTools({ ctx, store, subjects, pages, graphSync: { touch: (id) => touched.push(id) }, notify: (e) => events.push(e) });
  const tools = Object.fromEntries(create({ chatId: 'chat_1', agent: 'teacher' }).map((t) => [t.name, t]));
  const run = async (name, args, onUpdate) => (await tools[name].execute('call', args, undefined, onUpdate)).content.map((c) => c.text ?? `[${c.type}]`).join('\n');
  return { run, tools, store, subjects, events, touched, pages };
}

test('topic notebooks: open in a subject, then concepts, notes and cards grow while teaching', async () => {
  const h = harness();
  assert.match(await h.run('study_notebook', { action: 'status' }), /No notebook/);
  await assert.rejects(h.run('study_concept', { title: 'x', topic: 't', summary: 's' }), /No notebook is attached/);
  assert.match(await h.run('study_notebook', { action: 'open', subject: 'Machine Learning', title: 'Linear regression', origin: 'topic' }), /Linear regression.*Machine Learning/);
  await h.run('study_concept', { title: 'Least squares', topic: 'Fitting', summary: 'Minimise squared error.' });
  await h.run('study_note', { concept: 'Least squares', callout: { kind: 'exam', text: 'Derivation is examined.' } });
  await h.run('study_cards', { action: 'add', cards: [{ concept: 'Least squares', q: 'What does least squares minimise?', a: 'The sum of squared residuals.' }] });
  assert.match(await h.run('study_grade', { concept: 'Least squares', grade: 'right', learner_answer: 'squared error', feedback: 'Correct.' }), /is now ok/);
  const deck = study.ensureNotebook(h.store.get(h.subjects.notebookForChat('chat_1')));
  assert.equal(deck.concepts[0].callouts[0].kind, 'exam');
  assert.equal(deck.cards.length, 1);
  assert.ok(deck.activity.length >= 4, 'every change is in the activity feed');
  assert.ok(h.events.length > 0, 'the live pane is notified');
  assert.ok(h.touched.length > 0, 'learned content syncs to the knowledge graph');
  // Reopening by the same title in the same subject reuses the notebook.
  await h.run('study_notebook', { action: 'open', subject: 'machine learning', title: 'Linear Regression' });
  assert.equal(h.store.list().length, 1);
});

test('importing slides reports progress and builds concepts, flashcards and screenshots', async () => {
  const h = harness([
    reply({ concepts: [concept('Slope', [1, 2], { figures: [{ slide: 2, caption: 'fit line' }] }), concept('Intercept', [3])] }),
    reply({ concepts: [concept('Residuals', [5])] }),
  ]);
  const updates = [];
  const out = await h.run('study_import_slides', { path: '/tmp/lecture3.pdf', subject: 'Statistics' }, (u) => updates.push(u.content[0].text));
  assert.match(out, /3 new concepts, 3 flashcards, 1 slide screenshots/);
  assert.deepEqual(updates.map((u) => u.match(/\((\d+)%\)/)[1]), ['80', '100']);
  const deck = study.ensureNotebook(h.store.get(h.subjects.notebookForChat('chat_1')));
  assert.equal(deck.title, 'lecture3');
  assert.equal(deck.sources[0].pageCount, 5);
  assert.deepEqual(deck.concepts.map((c) => c.title), ['Slope', 'Intercept', 'Residuals']);
  assert.ok(h.pages.has(deck.id, 4), 'slide images are stored for screenshots');
  assert.match(deck.activity.map((a) => a.text).join('\n'), /Read slides 1–4 of 5 \(80%\): found Slope, Intercept/);
});

test('figures go into the notes and can be shown in chat; practice queues and rates cards', async () => {
  const h = harness([reply({ concepts: [concept('Slope', [1, 2])] }), reply({ concepts: [] })]);
  await h.run('study_import_slides', { path: '/tmp/l.pdf' });
  const shown = await h.tools.study_figure.execute('c', { concept: 'Slope', slide: 2, caption: 'fit', show: true });
  assert.ok(shown.content.some((c) => c.type === 'image' && c.mimeType === 'image/png'));
  await assert.rejects(h.run('study_figure', { concept: 'Slope', slide: 4 }), /not part of this concept/);
  const next = await h.run('study_practice_next', { mode: 'all' });
  const id = next.split(' ')[0];
  assert.match(await h.run('study_practice_rate', { id, rating: 3 }), /Rated 3/);
  const deck = study.ensureNotebook(h.store.get(h.subjects.notebookForChat('chat_1')));
  assert.equal(deck.cards[0].reviews.length, 1);
  assert.equal(deck.concepts[0].figures.length, 1);
});
