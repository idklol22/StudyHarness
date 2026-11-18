'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStore } = require('../src/store.cjs');
const { newConcept, applyAnswer } = require('../src/state.cjs');
const { createGraphSync, conceptDigest, pendingConcepts } = require('../src/graph-sync.cjs');

function setup(importImpl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ln-gs-'));
  const store = openStore(dir);
  const timers = []; const imports = []; const events = [];
  const ctx = {
    events: { emit: (topic, data) => events.push({ topic, data }) },
    graph: { importNotes: async (input) => { imports.push(input); return importImpl ? importImpl(input, imports.length) : { nodes: 3, chains: 1 }; } },
  };
  const sync = createGraphSync({ ctx, store, debounceMs: 100, retryMs: 500,
    setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; }, clearTimer: (t) => { if (t) t.live = false; } });
  const live = () => timers.filter(t => t.live);
  const deck = { id: 'd1', title: 'Stochastic Sim', examDate: null, concepts: [
    { ...newConcept({ id: 'a', title: 'Inverse transform', summary: 'Sample X from U by X = F^-1(U).', slides: [3], topic: 'Sampling' }), steps: [{ math: 'X=F^{-1}(U)', note: 'invert the CDF' }] },
    newConcept({ id: 'b', title: 'Unstudied', summary: 'Never asked.', slides: [4], topic: 'Sampling' }),
  ] };
  store.save(deck);
  return { store, sync, imports, events, live, ctx, deck };
}
const learn = (store, id, patch = {}) => {
  const d = store.get('d1'); const i = d.concepts.findIndex(c => c.id === id);
  d.concepts[i] = applyAnswer(d.concepts[i], { grade: 'wrong', session: 's1', text: 'it is the density', note: 'It is the CDF, not the density (slide 3).', now: Date.UTC(2026, 0, 1) });
  Object.assign(d.concepts[i], patch); store.save(d);
};
const flush = () => new Promise(r => setImmediate(r));

test('only studied concepts are sent, and never ratings, status or dates', async () => {
  const { store, sync, imports } = setup();
  learn(store, 'a');
  await sync.run('d1');
  assert.equal(imports.length, 1);
  const text = imports[0].text;
  assert.match(text, /Inverse transform/);
  assert.match(text, /X=F\^\{-1\}\(U\)/);
  assert.match(text, /It is the CDF, not the density/);
  assert.doesNotMatch(text, /Unstudied/);
  assert.doesNotMatch(text, /shaky|solid|revisit|status|timesAsked|2026-/i);
  assert.equal(imports[0].name, 'Stochastic Sim.md');
});

test('nothing studied means nothing sent', async () => {
  const { sync, imports, store } = setup();
  assert.equal(pendingConcepts(store.get('d1')).length, 0);
  await sync.run('d1');
  assert.equal(imports.length, 0);
});

test('bursts are debounced into one extraction, then unchanged content is not re-sent', async () => {
  const { store, sync, imports, live } = setup();
  learn(store, 'a'); sync.touch('d1'); sync.touch('d1'); sync.touch('d1');
  assert.equal(live().length, 1, 'one pending timer, not three');
  { const t = live()[0]; t.live = false; t.fn(); } await flush(); await flush();
  assert.equal(imports.length, 1);
  assert.equal(sync.status('d1').state, 'idle');
  assert.equal(sync.status('d1').pending, 0);
  sync.touch('d1'); assert.equal(live().length, 0);
  await sync.run('d1'); assert.equal(imports.length, 1);
});

test('after a sync only the concept that changed is sent', async () => {
  const { store, sync, imports } = setup();
  learn(store, 'a'); await sync.run('d1');
  learn(store, 'b'); await sync.run('d1');
  assert.equal(imports.length, 2);
  assert.match(imports[1].text, /Unstudied/);
  assert.doesNotMatch(imports[1].text, /Inverse transform/);
});

test('a discussion clarification alone makes a concept learned and pending', async () => {
  const { store, sync, imports } = setup();
  const d = store.get('d1'); d.concepts[1].discussion = [{ text: 'Rejection sampling needs an envelope $M g(x) \ge f(x)$.', at: 'x', session: 's', slides: [4] }]; store.save(d);
  await sync.run('d1');
  assert.match(imports[0].text, /envelope/);
});

test('busy retries later, then succeeds', async () => {
  const { store, sync, imports, live } = setup((input, n) => { if (n === 1) { const e = new Error('busy'); e.code = 'busy'; throw e; } return { nodes: 1 }; });
  learn(store, 'a'); await sync.run('d1');
  assert.equal(sync.status('d1').state, 'pending');
  assert.equal(live()[0].ms, 500);
  { const t = live()[0]; t.live = false; t.fn(); } await flush(); await flush();
  assert.equal(imports.length, 2);
  assert.equal(sync.status('d1').state, 'idle');
});

test('a failure is shown plainly and Update graph retries it', async () => {
  const { store, sync, imports, events } = setup((input, n) => { if (n === 1) { const e = new Error('no model'); e.code = 'not-configured'; throw e; } return { nodes: 1 }; });
  learn(store, 'a'); await sync.run('d1');
  const failed = sync.status('d1');
  assert.equal(failed.state, 'failed');
  assert.match(failed.error, /No extraction model is configured/);
  assert.equal(failed.pending, 1);
  assert.ok(events.some(e => e.topic === 'graph-sync' && e.data.state === 'failed'));
  await sync.syncNow('d1');
  assert.equal(sync.status('d1').state, 'idle');
  assert.equal(imports.length, 2);
});

test('changes made while an extraction runs are sent afterwards', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const { store, sync, imports, live } = setup(async (input, n) => { if (n === 1) await gate; return { nodes: 1 }; });
  learn(store, 'a');
  const first = sync.run('d1'); await flush();
  learn(store, 'b'); sync.touch('d1');
  assert.equal(live().length, 0, 'no second run while one is in flight');
  release(); await first; await flush();
  assert.equal(live().length, 1, 'follow-up scheduled');
  { const t = live()[0]; t.live = false; t.fn(); } await flush(); await flush();
  assert.equal(imports.length, 2);
  assert.match(imports[1].text, /Unstudied/);
});

test('digest is deterministic and has no learner-state fields', () => {
  const c = { ...newConcept({ id: 'x', title: 'T', slides: [1] }), status: 'shaky', timesAsked: 3, nextRevisit: '2026-01-02T00:00:00.000Z' };
  assert.equal(conceptDigest(c), conceptDigest(structuredClone(c)));
  assert.doesNotMatch(conceptDigest(c), /shaky|2026|3/);
});

test('dispose stops timers and later touches', () => {
  const { store, sync, live } = setup();
  learn(store, 'a'); sync.touch('d1'); assert.equal(live().length, 1);
  sync.dispose(); assert.equal(live().length, 0);
  sync.touch('d1'); assert.equal(live().length, 0);
});
