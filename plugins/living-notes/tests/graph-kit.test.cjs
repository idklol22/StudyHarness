'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { kit, graphKit } = require('../src/graph-kit.cjs');

function deck(topics = 8, perTopic = 3) {
  const nodes = [{ id: 'root', group: 'root', kind: 'root' }], edges = [];
  for (let t = 0; t < topics; t++) {
    nodes.push({ id: `T${t}`, group: `T${t}`, kind: 'topic' }); edges.push({ a: 'root', b: `T${t}`, kind: 'tree' });
    for (let c = 0; c < perTopic; c++) { nodes.push({ id: `T${t}c${c}`, group: `T${t}`, kind: 'leaf' }); edges.push({ a: `T${t}`, b: `T${t}c${c}`, kind: 'tree' }); }
  }
  edges.push({ a: 'T0c0', b: 'T3c1', kind: 'cross' }, { a: 'T2c2', b: 'T5c0', kind: 'cross' });
  const labelW = Object.fromEntries(nodes.map(n => [n.id, 110]));
  return { nodes, edges, labelW };
}

test('layout is deterministic, finite and inside the unit sphere', () => {
  const { nodes, edges } = deck();
  const a = kit.layout(nodes, edges, { seed: 3 }), b = kit.layout(nodes, edges, { seed: 3 });
  assert.deepEqual(a, b);
  for (const id in a) { assert.ok(a[id].every(Number.isFinite)); assert.ok(Math.hypot(...a[id]) <= 1.0001); }
});

test('different seeds give different layouts', () => {
  const { nodes, edges } = deck();
  assert.notDeepEqual(kit.layout(nodes, edges, { seed: 1 }), kit.layout(nodes, edges, { seed: 2 }));
});

test('best view crosses fewer edges than a typical view', () => {
  const { nodes, edges, labelW } = deck();
  const pos = kit.layout(nodes, edges, { seed: 1 });
  const best = kit.bestView(pos, edges, labelW);
  const scores = [0, 1, 2, 3, 4, 5].map(k => kit.score(kit.project(pos, { yaw: k, pitch: 0 }), edges, labelW));
  assert.ok(best.score <= Math.min(...scores));
  assert.ok(best.score < scores.reduce((a, b) => a + b) / scores.length);
});

test('arrange stays small for a 33-node deck and handles tiny graphs', () => {
  const { nodes, edges, labelW } = deck();
  const { pos, view } = kit.arrange(nodes, edges, labelW);
  assert.equal(Object.keys(pos).length, nodes.length);
  assert.ok(Number.isFinite(view.yaw));
  const tiny = kit.arrange([{ id: 'r', group: 'r', kind: 'root' }], [], { r: 40 });
  assert.equal(Object.keys(tiny.pos).length, 1);
});

test('the kit survives being stringified into the notes page', () => {
  const rebuilt = eval('(' + graphKit.toString() + ')()');
  const { nodes, edges } = deck(3, 2);
  assert.deepEqual(rebuilt.layout(nodes, edges, { seed: 1 }), kit.layout(nodes, edges, { seed: 1 }));
});
