'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render, buildHtml } = require('../src/html.cjs');

test('maths is typeset by KaTeX, not escaped', () => {
  const html = render('1. $$\\frac{a}{b}$$\n   > divide a by b');
  assert.match(html, /class="katex-display"/);
  assert.match(html, /margin-note/);
  assert.doesNotMatch(html, /\\frac/);
});

test('revisit box, badge and slide pointer render', () => {
  const html = render(':::revisit\n**Come back** [[slide 4]]\n:::\n\n### Gradient  {shaky}');
  assert.match(html, /box revisit/);
  assert.match(html, /data-slide="4"/);
  assert.match(html, /<h3 class="s-shaky">/);
});

test('user text is HTML-escaped', () => {
  assert.match(render('I said <script>alert(1)</script>'), /&lt;script&gt;/);
});

test('bad LaTeX degrades to a visible marker instead of throwing', () => {
  assert.match(render('$$\\frac{$$'), /math-error/);
});

test('mindmap edges are carried to the page', () => {
  const html = buildHtml('~~~mindmap\nA -> B\n~~~');
  assert.match(html, /svg class="mindmap"/);
  assert.match(html, /data-map=.*tree.*B/);
});


test('maths wrapped in the model own delimiters still typesets', () => {
  assert.match(render('1. $$\(x^2\)$$'), /class="katex/);
  assert.match(render('1. $$\[x^2\]$$'), /class="katex/);
});

test('mind map root and children share exact names (no stray whitespace)', () => {
  const html = render(['~~~mindmap', 'root: Deck', 'Deck > Topic', 'Topic > Idea', '@Idea ok', '~~~'].join('\n'));
  const map = JSON.parse(html.match(/data-map="([^"]*)"/)[1].replace(/&quot;/g, '"'));
  assert.equal(map.root, 'Deck');
  assert.deepEqual(map.tree, [['Deck', 'Topic'], ['Topic', 'Idea']]);
  assert.equal(map.status.Idea, 'ok');
});
