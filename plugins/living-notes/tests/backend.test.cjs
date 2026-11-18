'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { activate } = require('../src/backend.cjs');

const reply = (obj) => ({ stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify(obj) }] });
const concept = (title, slides, extra = {}) => ({ title, topic: 'Calculus', summary: `${title} summary`, slides, visual: '', technique: '', steps: [], qa: [], links: [], ...extra });

function harness(replies) {
  const handlers = new Map(); const agents = new Map(); const cleanups = [];
  const calls = [];
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ln-test-'));
  const ctx = {
    dataDirectory, signal: new AbortController().signal, cleanup: f => cleanups.push(f), handle: (n, f) => handlers.set(n, f),
    inference: { catalog: async () => ({ models: [{ provider: 'p', id: 'm' }] }), complete: async (req) => { calls.push(req); return replies.shift(); } },
    agents: { register: () => () => {}, create: async () => { const a = { id: 'agent1', pending: [], status: 'idle', messages: [] }; agents.set(a.id, a); return a; },
      send: async (id, text) => { agents.get(id).messages.push(text); return agents.get(id); }, get: id => agents.get(id), answer: async () => ({}), abort() {} },
  };
  const built = [];
  activate(ctx, { htmlToPdf: async (html, out) => { fs.writeFileSync(out, Buffer.alloc(800, 1)); return out; }, buildHtml: (md, opts) => { built.push({ md, opts }); return `<html>${md}</html>`; } });
  return { call: (n, i) => handlers.get(n)(i), calls, agents, dataDirectory, built };
}
const model = { provider: 'p', id: 'm' };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]).toString('base64');
const pages = (...ns) => ns.map(n => ({ n, text: `text of slide ${n}`, image: JPEG, w: 160, h: 90 }));

test('slides -> concepts: images go to the model, source text comes from the PDF', async () => {
  const h = harness([reply({ concepts: [concept('Limits', [1, 2]), concept('Derivative', [3], { links: ['Limits'] })] })]);
  const deck = await h.call('create-deck', { title: 'Calc', pageCount: 3 });
  const r = await h.call('ingest-batch', { id: deck.id, pages: pages(1, 2, 3), model });
  assert.equal(r.found, 2);
  assert.ok(h.calls[0].context.messages[0].content.some(c => c.type === 'image'));
  const done = await h.call('ingest-finish', { id: deck.id });
  assert.deepEqual(done.concepts.map(c => c.title), ['Limits', 'Derivative']);
  assert.match(done.concepts[0].source, /\[slide 1\] text of slide 1/);
  assert.deepEqual(done.concepts[1].links, ['limits']);
  assert.ok(done.concepts.every(c => c.slides.length));
});

test('a reply citing slides that were not sent is rejected and retried with feedback', async () => {
  const h = harness([reply({ concepts: [concept('Ghost', [99])] }), reply({ concepts: [concept('Real', [1])] })]);
  const deck = await h.call('create-deck', { title: 'Calc' });
  const r = await h.call('ingest-batch', { id: deck.id, pages: pages(1), model });
  assert.deepEqual(r.titles, ['Real']);
  assert.match(JSON.stringify(h.calls[1].context.messages[0].content), /rejected/);
});

test('two bad replies fail honestly', async () => {
  const h = harness([{ stopReason: 'stop', content: [{ type: 'text', text: 'nope' }] }, { stopReason: 'stop', content: [{ type: 'text', text: 'still nope' }] }]);
  const deck = await h.call('create-deck', { title: 'Calc' });
  await assert.rejects(h.call('ingest-batch', { id: deck.id, pages: pages(1), model }), /Could not read slides/);
});

test('unavailable model is refused; session starts with the queue', async () => {
  const h = harness([reply({ concepts: [concept('Limits', [1])] })]);
  const deck = await h.call('create-deck', { title: 'Calc' });
  await assert.rejects(h.call('ingest-batch', { id: deck.id, pages: pages(1), model: { provider: 'x', id: 'y' } }), /not available/);
  await h.call('ingest-batch', { id: deck.id, pages: pages(1), model });
  await h.call('ingest-finish', { id: deck.id });
  await h.call('start-session', { deckId: deck.id, model });
  assert.match(h.agents.get('agent1').messages[0], /"concept_id": "limits"/);
});

test('same slides, different answers: the exported notes differ', async () => {
  const make = async (grade) => {
    const h = harness([reply({ concepts: [concept('Limits', [1], { steps: [{ math: 'x^2', note: 'square' }] })] })]);
    const deck = await h.call('create-deck', { title: 'Calc' });
    await h.call('ingest-batch', { id: deck.id, pages: pages(1), model });
    await h.call('ingest-finish', { id: deck.id });
    await h.call('start-session', { deckId: deck.id, model });
    const { applyAnswer } = require('../src/state.cjs');
    const d = await h.call('get-deck', { id: deck.id });
    d.concepts[0] = applyAnswer(d.concepts[0], { grade, session: 's', text: 'my answer', note: 'because slide 1' });
    require('../src/store.cjs').openStore(path.join(h.dataDirectory, 'decks')).save(d);
    return (await h.call('notes-markdown', { id: deck.id }));
  };
  const a = await make('right'), b = await make('wrong');
  assert.notEqual(a, b);
  assert.match(b, /my answer/);
  assert.doesNotMatch(a, /my answer/);
});

test('export-pdf returns base64 and cleans up', async () => {
  const h = harness([reply({ concepts: [concept('Limits', [1])] })]);
  const deck = await h.call('create-deck', { title: 'My: Deck?' });
  await h.call('ingest-batch', { id: deck.id, pages: pages(1), model });
  await h.call('ingest-finish', { id: deck.id });
  const pdf = await h.call('export-pdf', { id: deck.id });
  assert.equal(pdf.name, 'My Deck.pdf');
  assert.equal(Buffer.from(pdf.base64, 'base64').length, 800);
});

test('state file round trip: import-deck validates', async () => {
  const h = harness([]);
  await assert.rejects(async () => h.call('import-deck', { deck: { id: 'x', title: 'T', concepts: [{ id: 'c', status: 'weird', slides: [1] }] } }), /status/);
});

test('slide images are stored, figures can be added, and the export embeds them', async () => {
  const h = harness([reply({ concepts: [concept('Limits', [1, 2])] })]);
  const deck = await h.call('create-deck', { title: 'Calc' });
  await h.call('ingest-batch', { id: deck.id, pages: pages(1, 2), model });
  await h.call('ingest-finish', { id: deck.id });
  const withFigure = await h.call('add-figure', { id: deck.id, concept_id: 'limits', slide: 2, crop: [0.1, 0.2, 0.5, 0.4], caption: 'The plot' });
  assert.deepEqual(withFigure.concepts[0].figures, [{ slide: 2, crop: [0.1, 0.2, 0.5, 0.4], caption: 'The plot' }]);
  await h.call('export-pdf', { id: deck.id });
  const { md, opts } = h.built.at(-1);
  assert.ok(md.includes(['~~~figure', 'slide: 2', 'crop: 0.1,0.2,0.5,0.4', 'caption: The plot'].join('\n')));
  assert.ok(opts.images[2].src.startsWith('data:image/jpeg;base64,'));
  assert.deepEqual([opts.images[2].w, opts.images[2].h], [160, 90]);
  const removed = await h.call('remove-figure', { id: deck.id, concept_id: 'limits', slide: 2 });
  assert.deepEqual(removed.concepts[0].figures, []);
});

test('figures need a stored image, a slide of that concept and a sane crop', async () => {
  const h = harness([reply({ concepts: [concept('Limits', [1])] })]);
  const deck = await h.call('create-deck', { title: 'Calc' });
  await h.call('ingest-batch', { id: deck.id, pages: pages(1), model });
  await h.call('ingest-finish', { id: deck.id });
  const fail = (args, re) => assert.rejects(async () => h.call('add-figure', { id: deck.id, concept_id: 'limits', ...args }), re);
  await fail({ slide: 9 }, /not part of this concept/);
  await fail({ slide: 1, crop: [0.8, 0.8, 0.5, 0.5] }, /crop must be/);
  await fail({ slide: 1, crop: [0, 0, 0.01, 0.5] }, /crop must be/);
  const bad = harness([reply({ concepts: [concept('X', [1])] })]);
  const d2 = await bad.call('create-deck', { title: 'Y' });
  await assert.rejects(async () => bad.call('ingest-batch', { id: d2.id, pages: [{ n: 1, text: 't', image: 'AAAA', w: 10, h: 10 }], model }), /not a JPEG/);
});

test('the model figures are validated against the concept slides', async () => {
  const h = harness([reply({ concepts: [concept('Limits', [1], { figures: [{ slide: 7, caption: 'bad' }] })] }), reply({ concepts: [concept('Limits', [1], { figures: [{ slide: 1, crop: [0.9, 0.9, 0.5, 0.5], caption: 'plot' }] })] })]);
  const deck = await h.call('create-deck', { title: 'Calc' });
  await h.call('ingest-batch', { id: deck.id, pages: pages(1), model });
  const done = await h.call('ingest-finish', { id: deck.id });
  assert.deepEqual(done.concepts[0].figures, [{ slide: 1, caption: 'plot' }]); // bad crop dropped to the whole slide
});
