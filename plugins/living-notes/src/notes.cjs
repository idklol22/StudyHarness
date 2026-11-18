'use strict';
// Build the living notes (Markdown) from learner state. Rebuilt from scratch
// every time: the same slides give different notes for different learners, and
// anything clarified in the tutoring discussion shows up here.
//
// Block syntax understood by html.cjs:
//   :::revisit / :::mistake / :::technique / :::qa / :::discussion  ... :::
//   $$ latex $$ on its own line, $latex$ inline
//   > margin note     [[slide 12]] pointer arrow
//   ~~~mindmap ... ~~~   lines:  root: Name | A > B (tree edge) | A ~> B (cross link) | @Name status

const { revisitList, sessionQueue } = require('./state.cjs');

const slideRef = (c, slides) => (slides && slides.length ? slides : c.slides).map(n => `[[slide ${n}]]`).join(' ');
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const MAX_CROSS = 2; // cross-links drawn per concept, to keep maps readable
const CALLOUT_BLOCK = { revisit: 'revisit', crucial: 'crucial', exam: 'exam', mistake: 'pitfall', tip: 'tip' };

const stepLines = (list) => list.map((s, i) => `${i + 1}. $$${s.math}$$\n   > ${oneLine(s.note)}`).join('\n');

function mistakes(c) {
  return [...c.wrong, ...c.missed].sort((a, b) => a.at < b.at ? -1 : 1).map(m => {
    const kind = c.wrong.includes(m) ? 'I said' : 'I left out';
    return `:::mistake\n**${kind}:** ${oneLine(m.text) || '(no answer)'}\n**Actually:** ${oneLine(m.note) || 'see slides'} ${slideRef(c, m.slides)}\n:::`;
  }).join('\n\n');
}

function qa(c) {
  if (!c.qa.length) return '';
  return `:::qa\n${c.qa.map(p => `**Q:** ${oneLine(p.q)}\n**A:** ${oneLine(p.a)} ${slideRef(c, p.slides)}`).join('\n\n')}\n:::`;
}

// A slide screenshot (optionally cropped). crop = [x, y, w, h] as 0-1 fractions of the slide.
function figures(c) {
  return (c.figures ?? []).map(f => {
    const lines = ['~~~figure', `slide: ${f.slide}`];
    if (f.crop) lines.push(`crop: ${f.crop.map(v => +v.toFixed(4)).join(',')}`);
    if (f.caption) lines.push(`caption: ${oneLine(f.caption)}`);
    return lines.concat('~~~').join('\n');
  }).join('\n\n');
}

function discussion(c) {
  const d = c.discussion ?? [];
  if (!d.length) return '';
  return `:::discussion\n${d.map(x => `- ${oneLine(x.text)}`).join('\n')}\n:::`;
}

function conceptBlock(c) {
  const head = `### ${c.title}  {${c.status}} ${slideRef(c)}`;
  const parts = [head];
  if (c.status === 'shaky' && !(c.callouts ?? []).some(k => k.kind === 'revisit')) parts.push(':::revisit\n**Come back to this** — still shaky. Cover the page and explain it again.\n:::');
  // Study callouts (owner, 2026-11-18): revisit / crucial / likely exam / common mistake / tip.
  for (const k of c.callouts ?? []) parts.push(`:::${CALLOUT_BLOCK[k.kind] ?? 'tip'}\n${oneLine(k.text)}\n:::`);
  if (c.summary) parts.push(c.summary.trim());
  if (c.steps.length) {
    // Solid concepts keep only the key result; everything else shows the full steps.
    const shown = c.status === 'solid' ? c.steps.slice(-1) : c.steps;
    parts.push(`**${c.status === 'solid' ? 'Key formula' : 'Worked example'}**\n${stepLines(shown)}`);
  }
  if (c.status !== 'solid') { const f = figures(c); if (f) parts.push(f); }
  if (c.status === 'new') parts.push('> Not studied yet.');
  const d = discussion(c); if (d) parts.push(d);
  if (c.status !== 'solid') { const m = mistakes(c); if (m) parts.push(m); const q = qa(c); if (q) parts.push(q); }
  return parts.join('\n\n') + '\n';
}

function techniqueBoxes(concepts) {
  const byTopic = new Map();
  for (const c of concepts) {
    if (!c.technique.trim()) continue;
    if (!byTopic.has(c.topic)) byTopic.set(c.topic, []);
    byTopic.get(c.topic).push(c.technique.trim());
  }
  return byTopic;
}

function crossLinks(concepts, byId) {
  const out = [];
  for (const c of concepts) for (const l of c.links.filter(x => byId.has(x) && x !== c.id).slice(0, MAX_CROSS)) out.push(`${c.title} ~> ${byId.get(l).title}`);
  return out;
}

// Whole-deck map data: title > topic > concept, status per concept, a few cross-links.
// Node names are the keys, so a topic that shares a concept's title gets a "(topic)" suffix.
function mapData(title, concepts) {
  const byId = new Map(concepts.map(c => [c.id, c]));
  const names = new Set(concepts.map(c => c.title));
  const tl = (t) => (names.has(t) || t === title ? `${t} (topic)` : t);
  const tree = [], status = {};
  for (const t of [...new Set(concepts.map(c => c.topic))]) tree.push([title, tl(t)]);
  for (const c of concepts) { tree.push([tl(c.topic), c.title]); status[c.title] = c.status; }
  const cross = [];
  for (const c of concepts) for (const l of c.links.filter(x => byId.has(x) && x !== c.id).slice(0, 1)) cross.push([c.title, byId.get(l).title]);
  return { root: title, tree, cross, status };
}

function deckMap(title, concepts) {
  const m = mapData(title, concepts);
  const lines = [`root: ${m.root}`, ...m.tree.map(([p, c]) => `${p} > ${c}`), ...Object.entries(m.status).map(([n, st]) => `@${n} ${st}`), ...m.cross.map(([p, c]) => `${p} ~> ${c}`)];
  return `~~~graph\n${lines.join('\n')}\n~~~`;
}

function topicMap(topic, concepts, byId) {
  if (concepts.length < 2) return '';
  const names = new Set(concepts.map(c => c.title));
  const root = names.has(topic) ? `${topic} (topic)` : topic;
  const lines = [`root: ${root}`];
  const ids = new Set(concepts.map(c => c.id));
  for (const c of concepts) { lines.push(`${root} > ${c.title}`); lines.push(`@${c.title} ${c.status}`); }
  for (const c of concepts) for (const l of c.links.filter(x => ids.has(x) && x !== c.id).slice(0, MAX_CROSS)) lines.push(`${c.title} ~> ${byId.get(l).title}`);
  return `~~~mindmap\n${lines.join('\n')}\n~~~`;
}

function buildNotesMarkdown(state, now = Date.now()) {
  const { title, concepts } = state;
  const sorted = [...concepts].sort((a, b) => a.order - b.order);
  const byId = new Map(sorted.map(c => [c.id, c]));
  const out = [`# ${title}`];

  const counts = Object.fromEntries(['new', 'shaky', 'ok', 'solid'].map(s => [s, sorted.filter(c => c.status === s).length]));
  out.push(`> ${counts.solid} solid · ${counts.ok} ok · ${counts.shaky} shaky · ${counts.new} not started`);

  const weak = revisitList(sorted, now);
  if (weak.length) out.push(`:::revisit\n**Revisit first**\n${weak.map(c => `- ${c.title} (${c.status}) ${slideRef(c)}`).join('\n')}\n:::`);

  if (sorted.length) out.push('## Map of ideas\n' + deckMap(title, sorted));

  const boxes = techniqueBoxes(sorted);
  for (const topic of [...new Set(sorted.map(c => c.topic))]) {
    const group = sorted.filter(x => x.topic === topic);
    out.push(`## ${topic}`);
    const map = topicMap(topic, group, byId); if (map) out.push(map);
    if (boxes.has(topic)) out.push(`:::technique\n**How to answer these**\n${boxes.get(topic).map(t => `- ${oneLine(t)}`).join('\n')}\n:::`);
    for (const c of group) out.push(conceptBlock(c));
  }

  const cold = sorted.filter(c => c.qa.length && c.status !== 'new');
  if (cold.length) out.push('## Answer these cold\n' + cold.map(c => c.qa.map(p => `- **Q:** ${oneLine(p.q)} ${slideRef(c, p.slides)}`).join('\n')).join('\n'));
  return out.join('\n\n') + '\n';
}

module.exports = { buildNotesMarkdown, sessionQueue, mapData };
