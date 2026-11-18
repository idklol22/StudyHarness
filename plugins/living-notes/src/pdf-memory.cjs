'use strict';
// PDF page memory (owner, 2026-11-18): "if it reads 5 pages in one go, it should remember those pages
// and not reread them; to find something it should look in its memory to see which chunk of pages it
// is, and use the index to jump straight to e.g. the exercises, a page above or below".
//
// Kept on each notebook source (one per PDF):
//   read:   page numbers already read (never read again unless asked);
//   pages:  {n: text} the page's own text (capped), for lookups without reopening the PDF;
//   chunks: [{from, to, summary, concepts}] one per batch the vision model read;
//   toc:    [{title, page}] entries of a table of contents / index page (printed page numbers).
// Lookups return compact excerpts so the chat's context is not flooded.
const PAGE_TEXT_CAP = 2500;
const STOP = new Set('the a an and or of to in on for with is are be by as at from this that these those it its what which how where when page pages slide slides about'.split(' '));

const words = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));

function ensureMemory(source) {
  source.read = Array.isArray(source.read) ? source.read : [];
  source.pages = source.pages && typeof source.pages === 'object' ? source.pages : {};
  source.chunks = Array.isArray(source.chunks) ? source.chunks : [];
  source.toc = Array.isArray(source.toc) ? source.toc : [];
  return source;
}

/** "1-12, 20, 30-34" → sorted unique page numbers within 1..max. */
function parseRange(spec, max) {
  if (spec == null || String(spec).trim() === '' || String(spec).trim().toLowerCase() === 'all') return Array.from({ length: max }, (_, i) => i + 1);
  const out = new Set();
  for (const part of String(spec).split(',')) {
    const m = part.trim().match(/^(\d+)\s*(?:-|–|to)\s*(\d+)$/) ?? part.trim().match(/^(\d+)$/);
    if (!m) throw new Error(`Could not read the page range "${part.trim()}". Use e.g. "1-12, 20, 30-34".`);
    const a = Number(m[1]), b = Number(m[2] ?? m[1]);
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) if (n >= 1 && n <= max) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

/** Remember one batch: page texts, a summary, the concepts found, any table-of-contents entries. */
function recordBatch(source, { pages, summary = '', concepts = [], toc = [] }) {
  ensureMemory(source);
  const nums = pages.map((p) => p.n).sort((a, b) => a - b);
  for (const p of pages) source.pages[p.n] = String(p.text ?? '').slice(0, PAGE_TEXT_CAP);
  source.read = [...new Set([...source.read, ...nums])].sort((a, b) => a - b);
  source.chunks = source.chunks.filter((c) => !(c.from === nums[0] && c.to === nums.at(-1)));
  source.chunks.push({ from: nums[0], to: nums.at(-1), summary: String(summary).slice(0, 600), concepts: concepts.slice(0, 20) });
  source.chunks.sort((a, b) => a.from - b.from);
  for (const e of toc) if (!source.toc.some((x) => x.title.toLowerCase() === e.title.toLowerCase())) source.toc.push(e);
  return source;
}

const unread = (source, wanted) => { const done = new Set(ensureMemory(source).read); return wanted.filter((n) => !done.has(n)); };

/** Printed page number → PDF page: where the entry's heading actually appears near the printed page. */
function resolvePrinted(source, entry) {
  const title = entry.title.toLowerCase().slice(0, 60);
  // The contents/index pages themselves list every title: never take them for the chapter's page.
  const listsMany = (n) => source.toc.filter((e) => String(source.pages[n]).toLowerCase().includes(e.title.toLowerCase().slice(0, 60))).length >= 2;
  const read = Object.keys(source.pages).map(Number).filter((n) => !listsMany(n)).sort((a, b) => a - b);
  // Nearest page (at or after the printed number, allowing front-matter offsets) whose text has the heading.
  let best = null;
  for (const n of read) {
    if (!String(source.pages[n]).toLowerCase().includes(title)) continue;
    const d = n - entry.page;
    if (d < -2 || d > 40) continue;
    if (best === null || Math.abs(d) < Math.abs(best - entry.page)) best = n;
  }
  if (best !== null) return { page: best, offset: best - entry.page, confirmed: true };
  // Otherwise reuse an offset learned from another entry, if any.
  for (const other of source.toc) {
    if (other === entry) continue;
    const o = String(other.title).toLowerCase().slice(0, 60);
    const hit = read.find((n) => n - other.page >= -2 && n - other.page <= 40 && String(source.pages[n]).toLowerCase().includes(o));
    if (hit) return { page: entry.page + (hit - other.page), offset: hit - other.page, confirmed: false };
  }
  return { page: entry.page, offset: 0, confirmed: false };
}

function snippet(text, terms, len = 280) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const lower = t.toLowerCase();
  const at = Math.max(0, Math.min(...terms.map((w) => { const i = lower.indexOf(w); return i < 0 ? Infinity : i; }).concat([Infinity])) - 80);
  const start = Number.isFinite(at) ? at : 0;
  return (start > 0 ? '…' : '') + t.slice(start, start + len) + (start + len < t.length ? '…' : '');
}

/**
 * Answer from memory. With `pages`: their stored text (missing pages are listed, to be read on demand).
 * With `query`: table-of-contents hits (resolved to PDF pages, with the page before/after), the best page
 * ranges by their summaries, and the best single pages with short excerpts.
 */
function lookup(source, { query, pages } = {}) {
  ensureMemory(source);
  if (Array.isArray(pages) && pages.length) {
    const have = pages.filter((n) => source.pages[n] !== undefined);
    return { kind: 'pages', pages: have.map((n) => ({ n, text: source.pages[n] })), missing: pages.filter((n) => source.pages[n] === undefined) };
  }
  const terms = words(query);
  if (!terms.length) return { kind: 'overview', chunks: source.chunks, toc: source.toc, read: source.read };
  const score = (text) => { const w = words(text); return terms.reduce((s, t) => s + w.filter((x) => x === t || x.startsWith(t)).length, 0); };
  const toc = source.toc
    .map((e) => ({ e, s: score(e.title) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3)
    .map(({ e }) => { const r = resolvePrinted(source, e); return { title: e.title, printed: e.page, page: r.page, confirmed: r.confirmed, around: [r.page - 1, r.page, r.page + 1].filter((n) => n >= 1) }; });
  const chunks = source.chunks
    .map((c) => ({ c, s: score(c.summary) + 2 * score(c.concepts.join(' ')) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3).map(({ c }) => c);
  // Contents/index pages already answer through `toc`; rank them below real content pages.
  const isContents = (text) => source.toc.filter((e) => String(text).toLowerCase().includes(e.title.toLowerCase().slice(0, 60))).length >= 2;
  const pageHits = Object.entries(source.pages)
    .map(([n, text]) => ({ n: Number(n), s: score(text) * (isContents(text) ? 0.3 : 1), text }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.n - b.n).slice(0, 5)
    .map((x) => ({ n: x.n, excerpt: snippet(x.text, terms) }));
  return { kind: 'search', toc, chunks, pages: pageHits };
}

/** Compact text for the model (bounded so lookups never flood the context). */
function formatLookup(fileName, r) {
  const out = [];
  if (r.kind === 'pages') {
    for (const p of r.pages) out.push(`--- ${fileName} page ${p.n} ---\n${p.text || '(no text on this page; it may be a figure — use study_figure to show it)'}`);
    if (r.missing.length) out.push(`Not read yet: pages ${r.missing.join(', ')}.`);
  } else if (r.kind === 'overview') {
    out.push(`${fileName}: read pages ${r.read.length ? `${r.read[0]}–${r.read.at(-1)} (${r.read.length})` : 'none yet'}.`);
    if (r.toc.length) out.push('Contents: ' + r.toc.slice(0, 40).map((e) => `${e.title} (p.${e.page})`).join('; '));
    for (const c of r.chunks) out.push(`pages ${c.from}–${c.to}: ${c.summary}${c.concepts.length ? ` [${c.concepts.join(', ')}]` : ''}`);
  } else {
    if (r.toc.length) out.push('From the contents: ' + r.toc.map((t) => `"${t.title}" printed p.${t.printed} → PDF page ${t.page}${t.confirmed ? '' : ' (estimated)'}; look at pages ${t.around.join(', ')}`).join('; '));
    for (const c of r.chunks) out.push(`pages ${c.from}–${c.to}: ${c.summary}`);
    for (const p of r.pages) out.push(`page ${p.n}: ${p.excerpt}`);
    if (!out.length) out.push('Nothing in the pages read so far matches. Read more pages (study_import_slides with a page range) or try other words.');
  }
  return out.join('\n');
}

module.exports = { PAGE_TEXT_CAP, ensureMemory, parseRange, recordBatch, unread, resolvePrinted, lookup, formatLookup, words };
