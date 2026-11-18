// Rendering a Study notebook in the app (owner, 2026-11-18): the live notes (2D map of ideas at the
// top, then each topic's concepts with summaries, callouts, slide screenshots, worked steps, notes from
// the chat), the flashcards grouped by topic, and the activity feed. Used by the notebook pane beside a
// chat and by the Subjects library. Recently changed items briefly highlight.
import { mountMap2D } from './map2d.js';

const STATUS_LABEL = { new: 'not started', shaky: 'shaky', ok: 'ok', solid: 'solid' };
const CALLOUT = {
  revisit: { label: 'Revisit this', icon: '↩' }, crucial: { label: 'Crucial', icon: '★' }, exam: { label: 'Likely exam material', icon: '✎' },
  mistake: { label: 'Common mistake', icon: '!' }, tip: { label: 'Tip', icon: '💡' },
};

export function el(tag, parent, { text, cls, attrs } = {}) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  if (attrs) for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.append(n);
  return n;
}

const recent = (at, ms = 20_000) => at && Date.now() - Date.parse(at) < ms;

/** A slide screenshot, optionally cropped [x, y, w, h] (fractions of the slide). */
function figure(parent, f, img) {
  const fig = el('figure', parent, { cls: 'ln-fig' });
  if (!img) { el('figcaption', fig, { text: `Slide ${f.slide} (image not stored — re-import the PDF to keep slide images)` }); return; }
  const [x, y, w, h] = Array.isArray(f.crop) ? f.crop : [0, 0, 1, 1];
  const frame = el('div', fig, { cls: 'ln-fig-frame' });
  frame.style.aspectRatio = String((w * img.w) / (h * img.h));
  const pic = el('img', frame, { attrs: { alt: f.caption || `Slide ${f.slide}`, src: img.src, loading: 'lazy' } });
  pic.style.width = `${100 / w}%`; pic.style.left = `${(-x / w) * 100}%`; pic.style.top = `${(-y / h) * 100}%`;
  el('figcaption', fig, { text: `${f.caption ? f.caption + ' · ' : ''}slide ${f.slide}` });
}

/** The notes. `images` maps slide number → {src, w, h}. */
export function renderNotes(container, deck, { ctx, signal, images = {} }) {
  container.replaceChildren();
  const counts = Object.fromEntries(['new', 'shaky', 'ok', 'solid'].map((s) => [s, deck.concepts.filter((c) => c.status === s).length]));
  el('p', container, { cls: 'ln-muted', text: `${deck.concepts.length} concepts · ${counts.solid} solid · ${counts.ok} ok · ${counts.shaky} shaky · ${counts.new} not started` });
  if (!deck.concepts.length) { el('p', container, { cls: 'ln-empty', text: 'Nothing here yet. Concepts appear as slides are read or as you are taught.' }); return; }
  const jump = (id) => {
    const row = container.querySelector(`[data-concept="${CSS.escape(id)}"]`);
    row?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    row?.classList.add('ln-flash'); setTimeout(() => row?.classList.remove('ln-flash'), 1600);
  };
  const mapHost = el('section', container, { cls: 'ln-map-host', attrs: { 'aria-label': 'Map of ideas' } });
  el('h3', mapHost, { text: 'Map of ideas' });
  mountMap2D(mapHost, { title: deck.title, concepts: deck.concepts, onSelect: jump }, signal);
  const md = (parent, text) => { if (text) ctx.ui.mountMarkdown(el('div', parent, { cls: 'ln-md' }), { text }, { signal }); };
  const topics = [...new Set(deck.concepts.slice().sort((a, b) => a.order - b.order).map((c) => c.topic))];
  for (const t of topics) {
    el('h3', container, { cls: 'ln-topic', text: t });
    for (const c of deck.concepts.filter((x) => x.topic === t).sort((a, b) => a.order - b.order)) {
      const card = el('article', container, { cls: `ln-note s-${c.status}`, attrs: { 'data-concept': c.id } });
      const changed = recent(c.lastAsked) || (c.callouts ?? []).some((x) => recent(x.at)) || (c.discussion ?? []).some((x) => recent(x.at));
      if (changed) card.classList.add('ln-new');
      const head = el('header', card);
      el('strong', head, { text: c.title });
      el('span', head, { cls: 'ln-badge', text: STATUS_LABEL[c.status] ?? c.status });
      if (c.slides?.length) el('span', head, { cls: 'ln-muted', text: `slides ${c.slides.join(', ')}` });
      for (const k of c.callouts ?? []) {
        const box = el('div', card, { cls: `ln-callout c-${k.kind}` });
        el('span', box, { cls: 'ln-callout-tag', text: `${CALLOUT[k.kind]?.icon ?? ''} ${CALLOUT[k.kind]?.label ?? k.kind}` });
        md(box, k.text);
      }
      if (c.status === 'shaky' && !(c.callouts ?? []).some((k) => k.kind === 'revisit')) {
        const box = el('div', card, { cls: 'ln-callout c-revisit' });
        el('span', box, { cls: 'ln-callout-tag', text: '↩ Revisit this' });
        el('p', box, { text: 'Still shaky: cover the page and explain it again.' });
      }
      md(card, c.summary);
      for (const f of c.figures ?? []) figure(card, f, images[f.slide]);
      if (c.steps?.length) md(card, '**Worked example**\n\n' + c.steps.map((s, i) => `${i + 1}. $${s.math}$${s.note ? ` — ${s.note}` : ''}`).join('\n'));
      if (c.technique) { const box = el('div', card, { cls: 'ln-callout c-tip' }); el('span', box, { cls: 'ln-callout-tag', text: 'How to answer these' }); md(box, c.technique); }
      if (c.discussion?.length) { const box = el('div', card, { cls: 'ln-discussion' }); el('span', box, { cls: 'ln-callout-tag', text: 'From our chat' }); md(box, c.discussion.map((d) => `- ${d.text}`).join('\n')); }
      const mistakes = [...(c.wrong ?? []), ...(c.missed ?? [])].filter((m) => m.note);
      if (mistakes.length) { const box = el('div', card, { cls: 'ln-callout c-mistake' }); el('span', box, { cls: 'ln-callout-tag', text: 'My mistakes' }); md(box, mistakes.map((m) => `- ${m.text ? `I said "${m.text}". ` : ''}${m.note}`).join('\n')); }
    }
  }
}

/** Flashcards grouped by topic (read-only list; the library adds study controls). */
export function renderCards(container, deck, { ctx, signal }) {
  container.replaceChildren();
  if (!deck.cards?.length) { el('p', container, { cls: 'ln-empty', text: 'No flashcards yet. They are made from your slides and while you are taught.' }); return; }
  const topics = [...new Set(deck.cards.map((c) => c.topic))];
  for (const t of topics) {
    const list = deck.cards.filter((c) => c.topic === t);
    el('h3', container, { cls: 'ln-topic', text: `${t} · ${list.length}` });
    for (const c of list) {
      const row = el('details', container, { cls: 'ln-card' + (recent(c.updatedAt) ? ' ln-new' : '') });
      ctx.ui.mountMarkdown(el('summary', row), { text: c.q }, { signal });
      ctx.ui.mountMarkdown(el('div', row, { cls: 'ln-card-a' }), { text: c.a }, { signal });
    }
  }
}

/** The activity feed, newest first. */
export function renderActivity(container, deck) {
  container.replaceChildren();
  const items = (deck.activity ?? []).slice().reverse();
  if (!items.length) { el('p', container, { cls: 'ln-empty', text: 'Nothing has happened yet.' }); return; }
  const list = el('ol', container, { cls: 'ln-activity' });
  for (const a of items.slice(0, 200)) {
    const li = el('li', list, { cls: `k-${a.kind}` + (recent(a.at, 8000) ? ' ln-new' : '') });
    el('time', li, { text: new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), attrs: { datetime: a.at } });
    el('span', li, { text: a.text });
  }
}

/** Slides used by figures, for one images request. */
export const figureSlides = (deck) => [...new Set(deck.concepts.flatMap((c) => (c.figures ?? []).map((f) => f.slide)))];
