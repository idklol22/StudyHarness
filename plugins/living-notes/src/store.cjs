'use strict';
// One JSON file per deck under the plugin data directory, written atomically.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { STATUSES } = require('./state.cjs');

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const fail = (m) => { throw new Error(m); };

function validateDeck(deck) {
  if (!deck || typeof deck !== 'object' || Array.isArray(deck)) fail('Deck must be an object.');
  if (!ID.test(deck.id ?? '')) fail('Deck has an invalid id.');
  if (typeof deck.title !== 'string' || !deck.title.trim()) fail('Deck needs a title.');
  if (!Array.isArray(deck.concepts)) fail('Deck needs a concepts array.');
  if (deck.examDate != null && Number.isNaN(Date.parse(deck.examDate))) fail('Exam date is not a valid date.');
  const seen = new Set();
  for (const c of deck.concepts) {
    if (!c || typeof c.id !== 'string' || !c.id || seen.has(c.id)) fail('Concept ids must be unique non-empty strings.');
    seen.add(c.id);
    if (!STATUSES.includes(c.status)) fail(`Concept "${c.title}" has an invalid status.`);
    if (!Array.isArray(c.slides) || !c.slides.length) fail(`Concept "${c.title}" must cite slides.`);
    for (const k of ['right', 'missed', 'wrong', 'steps', 'qa', 'links', 'history']) if (!Array.isArray(c[k])) fail(`Concept "${c.title}" is missing ${k}.`);
  }
  return deck;
}

function openStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (id) => { if (!ID.test(id)) fail('Invalid deck id.'); return path.join(dir, `deck-${id}.json`); };
  const write = (name, text) => { const tmp = `${name}.${randomUUID()}.tmp`; fs.writeFileSync(tmp, text); fs.renameSync(tmp, name); };
  return {
    list() {
      return fs.readdirSync(dir).filter(n => /^deck-.*\.json$/.test(n)).flatMap(n => {
        try { const d = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); return [{ id: d.id, title: d.title, examDate: d.examDate ?? null, updatedAt: d.updatedAt, concepts: d.concepts.length, counts: Object.fromEntries(STATUSES.map(s => [s, d.concepts.filter(c => c.status === s).length])) }]; }
        catch { return []; }
      }).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    },
    get(id) { try { return validateDeck(JSON.parse(fs.readFileSync(file(id), 'utf8'))); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    save(deck, now = Date.now()) { validateDeck(deck); deck.updatedAt = new Date(now).toISOString(); write(file(deck.id), JSON.stringify(deck, null, 2)); return deck; },
    remove(id) { fs.rmSync(file(id), { force: true }); },
  };
}

module.exports = { openStore, validateDeck, ID };
