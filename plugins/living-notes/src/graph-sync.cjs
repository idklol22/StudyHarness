'use strict';
// Keeps the app's Knowledge graph in step with what was learned in Living Notes.
//
// What is sent: objective content only (what the concept is, formulas, corrected misconceptions,
// clarifications from the tutoring chat, Q&A). The graph stores ideas and connections, never ratings
// of the learner, so status, scores, dates and "I got this wrong" are never included.
// Only concepts that were actually studied or discussed are sent, and only when their content changed.
const { createHash } = require('node:crypto');

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const tex = (s) => `$${oneLine(s)}$`;

// A concept counts as "learned" once it was asked about or discussed.
const isLearned = (c) => c.timesAsked > 0 || (c.discussion ?? []).length > 0;

// Objective text for one concept. Same content => same text => same hash.
function conceptDigest(c) {
  const out = [`## ${oneLine(c.title)} (${oneLine(c.topic)})`];
  if (c.summary) out.push(oneLine(c.summary));
  if (c.steps.length) out.push('Worked example:\n' + c.steps.map((s, i) => `${i + 1}. ${tex(s.math)}${s.note ? ` (${oneLine(s.note)})` : ''}`).join('\n'));
  if (c.technique) out.push(`How to approach questions on this: ${oneLine(c.technique)}`);
  // Mistakes become neutral misconception facts, not statements about the learner.
  const misconceptions = [...c.wrong, ...c.missed].filter(m => oneLine(m.note));
  if (misconceptions.length) out.push('Common misconceptions:\n' + misconceptions.map(m => `- ${oneLine(m.text) ? `Thinking "${oneLine(m.text)}" is a mistake. ` : ''}${oneLine(m.note)}`).join('\n'));
  if ((c.discussion ?? []).length) out.push('Clarified in discussion:\n' + c.discussion.map(d => `- ${oneLine(d.text)}`).join('\n'));
  if (c.qa.length) out.push('Questions:\n' + c.qa.map(p => `- Q: ${oneLine(p.q)} A: ${oneLine(p.a)}`).join('\n'));
  return out.join('\n\n');
}

const digestHash = (text) => createHash('sha256').update(text).digest('hex');

// Concepts whose learned content differs from what was last sent.
function pendingConcepts(deck) {
  const sent = deck.graphSync?.hashes ?? {};
  return deck.concepts.filter(isLearned).map(c => ({ c, text: conceptDigest(c) })).filter(({ c, text }) => sent[c.id] !== digestHash(text));
}

function createGraphSync({ ctx, store, debounceMs = 15000, retryMs = 30000, maxBusyRetries = 5, setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now() }) {
  const timers = new Map(), running = new Set(), dirty = new Set(), retries = new Map();
  let disposed = false;

  const patch = (deckId, fields) => {
    const deck = store.get(deckId); if (!deck) return null;
    deck.graphSync = { hashes: {}, ...(deck.graphSync ?? {}), ...fields };
    store.save(deck, now());
    ctx.events.emit('graph-sync', { deckId, ...status(deck) });
    return deck;
  };
  function status(deck) {
    const g = deck.graphSync ?? {};
    return { state: g.state ?? 'idle', pending: pendingConcepts(deck).length, lastAt: g.lastAt ?? null, error: g.error ?? null };
  }

  function schedule(deckId, delay = debounceMs) {
    if (disposed) return;
    clearTimer(timers.get(deckId));
    timers.set(deckId, setTimer(() => { timers.delete(deckId); void run(deckId); }, delay));
  }

  // Called after anything learned changes. Debounced so a burst of answers is one extraction.
  function touch(deckId) {
    if (disposed) return;
    const deck = store.get(deckId);
    if (!deck || !pendingConcepts(deck).length) return;
    if (deck.graphSync?.state !== 'running') patch(deckId, { state: 'pending', error: null });
    if (running.has(deckId)) { dirty.add(deckId); return; }
    schedule(deckId);
  }

  async function run(deckId) {
    if (disposed || running.has(deckId)) { if (running.has(deckId)) dirty.add(deckId); return status(store.get(deckId) ?? { concepts: [] }); }
    const deck = store.get(deckId); if (!deck) return null;
    const todo = pendingConcepts(deck);
    if (!todo.length) { if (deck.graphSync?.state !== 'idle') patch(deckId, { state: 'idle', error: null }); return status(store.get(deckId)); }
    running.add(deckId); clearTimer(timers.get(deckId)); timers.delete(deckId);
    patch(deckId, { state: 'running', error: null });
    const text = `# ${oneLine(deck.title)}\n\nStudy notes: what was learned so far.\n\n${todo.map(t => t.text).join('\n\n')}\n`;
    try {
      await ctx.graph.importNotes({ name: `${oneLine(deck.title)}.md`, text });
      const latest = store.get(deckId);
      if (latest) { // record exactly what was sent; later edits stay pending
        const hashes = { ...(latest.graphSync?.hashes ?? {}) };
        for (const t of todo) hashes[t.c.id] = digestHash(t.text);
        patch(deckId, { hashes, state: 'idle', lastAt: new Date(now()).toISOString(), error: null });
      }
      retries.delete(deckId);
    } catch (e) {
      const code = e && e.code;
      if (code === 'busy' && (retries.get(deckId) ?? 0) < maxBusyRetries) { retries.set(deckId, (retries.get(deckId) ?? 0) + 1); patch(deckId, { state: 'pending', error: null }); schedule(deckId, retryMs); }
      else patch(deckId, { state: 'failed', error: code === 'not-configured' ? 'No extraction model is configured (Settings → Models).' : (e instanceof Error ? e.message : String(e)) });
    } finally {
      running.delete(deckId);
      if (dirty.delete(deckId) && !disposed && store.get(deckId) && pendingConcepts(store.get(deckId)).length && store.get(deckId).graphSync?.state !== 'failed') schedule(deckId);
    }
    return status(store.get(deckId) ?? { concepts: [] });
  }

  return {
    touch, run, status: (deckId) => { const d = store.get(deckId); return d ? status(d) : null; },
    // Manual "Update graph": immediate, and clears a failed state.
    syncNow: (deckId) => { retries.delete(deckId); return run(deckId); },
    dispose() { disposed = true; for (const t of timers.values()) clearTimer(t); timers.clear(); },
  };
}

module.exports = { createGraphSync, conceptDigest, pendingConcepts, isLearned, digestHash };
