'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const memory = require('../src/pdf-memory.cjs');

test('page ranges: lists, ranges, clamping, "all"', () => {
  assert.deepEqual(memory.parseRange('1-3, 7, 5-4', 10), [1, 2, 3, 4, 5, 7]);
  assert.deepEqual(memory.parseRange('8-20', 10), [8, 9, 10]);
  assert.deepEqual(memory.parseRange(undefined, 3), [1, 2, 3]);
  assert.deepEqual(memory.parseRange('all', 2), [1, 2]);
  assert.throws(() => memory.parseRange('one to five', 10), /page range/);
});

// An 80-page book: front matter shifts printed page numbers by 6.
function book() {
  const src = memory.ensureMemory({ fileName: 'dp-book.pdf' });
  memory.recordBatch(src, {
    pages: [{ n: 3, text: 'Contents  1 Introduction 1  2 Memoization 9  3 Exercises 41' }, { n: 4, text: 'Preface' }],
    summary: 'Title page, preface and the table of contents.', concepts: [], toc: [{ title: 'Introduction', page: 1 }, { title: 'Memoization', page: 9 }, { title: 'Exercises', page: 41 }],
  });
  memory.recordBatch(src, { pages: [{ n: 7, text: '1 Introduction Dynamic programming solves problems by combining subproblems.' }, { n: 15, text: '2 Memoization caches each subproblem result.' }], summary: 'Introduces dynamic programming and memoization.', concepts: ['Dynamic programming', 'Memoization'] });
  return src;
}

test('each batch is remembered once: page text, summary, concepts, contents; read pages are not read again', () => {
  const src = book();
  assert.deepEqual(src.read, [3, 4, 7, 15]);
  assert.equal(src.chunks.length, 2);
  assert.equal(src.toc.length, 3);
  assert.deepEqual(memory.unread(src, [3, 4, 5, 7]), [5]);
  memory.recordBatch(src, { pages: [{ n: 3, text: 'Contents again' }, { n: 4, text: 'Preface' }], summary: 'again', toc: [{ title: 'exercises', page: 41 }] });
  assert.equal(src.chunks.length, 2, 'the same range replaces its memory, it does not duplicate');
  assert.equal(src.toc.length, 3, 'contents entries are not duplicated');
});

test('the contents jump straight to the right PDF page, learning the printed-page offset', () => {
  const src = book();
  const r = memory.lookup(src, { query: 'go to the exercises' });
  const hit = r.toc[0];
  assert.equal(hit.title, 'Exercises');
  assert.equal(hit.printed, 41);
  assert.equal(hit.page, 47, 'offset 6 learned from "Introduction" printed p.1 found on PDF page 7');
  assert.deepEqual(hit.around, [46, 47, 48], 'the page before and after, to start a page early or late');
  assert.match(memory.formatLookup('dp-book.pdf', r), /"Exercises" printed p\.41 → PDF page 47 \(estimated\); look at pages 46, 47, 48/);
});

test('topic lookups use page summaries and page text, with short excerpts only', () => {
  const src = book();
  const r = memory.lookup(src, { query: 'memoization' });
  assert.ok(r.chunks.some((c) => c.from === 7));
  assert.equal(r.pages[0].n, 15);
  assert.ok(r.pages.every((p) => p.excerpt.length <= 300));
  const exact = memory.lookup(src, { pages: [15, 30] });
  assert.equal(exact.pages[0].n, 15);
  assert.deepEqual(exact.missing, [30]);
  assert.match(memory.formatLookup('dp-book.pdf', memory.lookup(src, { query: 'quantum chromodynamics' })), /Nothing in the pages read so far matches/);
});
