'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { openStore, validateDeck, ID } = require('./store.cjs');
const { extractBatch, mergeDrafts } = require('./ingest.cjs');
const { INSTRUCTIONS, queueMessage, makeTools, performFigure } = require('./tutor.cjs');
const { createPages } = require('./pages.cjs');
const { createGraphSync } = require('./graph-sync.cjs');
const { buildNotesMarkdown } = require('./notes.cjs');
const { sessionQueue, revisitList } = require('./state.cjs');

const fail = (m) => { throw new Error(m); };
const object = (v) => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail('Expected an input object.'); return v; };
const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

async function modelFrom(ctx, value) {
  if (!value || typeof value.provider !== 'string' || typeof value.id !== 'string') fail('Choose a model first.');
  if (value.thinkingLevel !== undefined && !LEVELS.includes(value.thinkingLevel)) fail('Invalid thinking level.');
  const catalog = await ctx.inference.catalog();
  if (!catalog.models.some(m => m.provider === value.provider && m.id === value.id)) fail('That model is not available in your connections.');
  return { provider: value.provider, id: value.id, ...(value.thinkingLevel !== undefined ? { thinkingLevel: value.thinkingLevel } : {}) };
}

exports.activate = (ctx, deps = {}) => {
  const store = openStore(path.join(ctx.dataDirectory, 'decks'));
  const htmlToPdf = deps.htmlToPdf ?? require('./pdf.cjs').htmlToPdf;
  const buildHtml = deps.buildHtml ?? (() => require('./html.cjs').buildHtml)();
  const currentFile = path.join(ctx.dataDirectory, 'current-session.json');
  const defsFile = path.join(ctx.dataDirectory, 'agents.json');
  const writeAtomic = (file, text) => { const tmp = `${file}.${randomUUID()}.tmp`; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); };
  const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } };

  // The active study session (one at a time). Persisted so a restart can resume.
  let current = readJson(currentFile, null);
  if (current) current.hinted = new Set(current.hinted ?? []);
  const persistCurrent = () => writeAtomic(currentFile, JSON.stringify(current && { ...current, hinted: [...current.hinted] }));
  const pages = createPages(path.join(ctx.dataDirectory, 'pages'));
  // Older hosts have no ctx.graph: the feature is then simply off (status 'unsupported').
  const graphSync = ctx.graph ? createGraphSync({ ctx, store }) : null;
  if (graphSync) ctx.cleanup(() => graphSync.dispose());
  const tools = makeTools({ store, session: () => current, hasPage: (deckId, n) => pages.has(deckId, n), onLearned: (deckId) => graphSync?.touch(deckId) });

  const registerAgent = (entry) => ctx.cleanup(ctx.agents.register({ id: entry.id, model: entry.model, instructions: INSTRUCTIONS, tools }));
  let defs = readJson(defsFile, []);
  for (const e of defs) registerAgent(e);

  const deckOrFail = (id) => store.get(String(id ?? '')) ?? fail('Deck not found.');

  ctx.handle('get-catalog', () => ctx.inference.catalog());
  ctx.handle('list-decks', () => store.list());
  ctx.handle('get-deck', (i) => deckOrFail(object(i).id));
  ctx.handle('delete-deck', (i) => { store.remove(String(object(i).id)); pages.remove(String(i.id)); if (current?.deckId === i.id) { current = null; fs.rmSync(currentFile, { force: true }); } return null; });

  ctx.handle('create-deck', (i) => {
    const { title, examDate, pageCount } = object(i);
    if (typeof title !== 'string' || !title.trim()) fail('Give the deck a title.');
    if (examDate && Number.isNaN(Date.parse(examDate))) fail('Exam date is not valid.');
    const deck = { id: randomUUID(), title: title.trim(), examDate: examDate || null, pageCount: pageCount ?? 0, createdAt: new Date().toISOString(), concepts: [], draft: [], pageText: {} };
    return store.save(deck);
  });

  ctx.handle('set-exam-date', (i) => { const d = deckOrFail(object(i).id); if (i.examDate && Number.isNaN(Date.parse(i.examDate))) fail('Exam date is not valid.'); d.examDate = i.examDate || null; return store.save(d); });

  // Frontend renders pages (image + text) and sends them in small batches.
  ctx.handle('ingest-batch', async (i) => {
    const { id, pages: pages_, model, extra } = object(i);
    const deck = deckOrFail(id);
    if (!Array.isArray(pages_) || !pages_.length || pages_.length > 8) fail('Send 1–8 slides per batch.');
    for (const p of pages_) { if (!Number.isInteger(p.n) || p.n < 1) fail('Slide numbers must be positive integers.'); if (p.image && String(p.image).length > 3_000_000) fail(`Slide ${p.n} image is too large.`); }
    for (const p of pages_) if (p.image) pages.save(deck.id, p.n, p); // keep the slide images so notes can embed screenshots
    const spec = await modelFrom(ctx, model);
    const drafts = await extractBatch(ctx.inference, { model: spec, pages: pages_, extra, signal: ctx.signal });
    const latest = deckOrFail(id);
    latest.draft = [...(latest.draft ?? []), ...drafts];
    latest.pageText = { ...(latest.pageText ?? {}), ...Object.fromEntries(pages_.map(p => [p.n, String(p.text ?? '').slice(0, 6000)])) };
    store.save(latest);
    return { found: drafts.length, titles: drafts.map(d => d.title) };
  });

  ctx.handle('ingest-finish', (i) => {
    const deck = deckOrFail(object(i).id);
    if (!deck.draft?.length) fail('No concepts were read from the slides.');
    const fresh = mergeDrafts(deck.draft, deck.pageText ?? {});
    // Keep learner state for concepts that already exist (re-import of the same slides).
    const old = new Map(deck.concepts.map(c => [c.id, c]));
    deck.concepts = fresh.map(c => old.get(c.id) ? { ...c, ...Object.fromEntries(['status', 'right', 'missed', 'wrong', 'timesAsked', 'lastAsked', 'nextRevisit', 'cleanStreak', 'okSession', 'history', 'discussion'].map(k => [k, old.get(c.id)[k]])) } : c);
    deck.draft = []; delete deck.pageText;
    return store.save(deck);
  });

  // The learner can also pick screenshots themselves (same rules as the tutor's add_figure tool).
  ctx.handle('add-figure', (i) => { const v = object(i), d = deckOrFail(v.id); const r = performFigure(d, { concept_id: v.concept_id, slide: v.slide, crop: v.crop ?? undefined, caption: v.caption }, n => pages.has(d.id, n)); return store.save(r.deck); });
  ctx.handle('remove-figure', (i) => { const v = object(i), d = deckOrFail(v.id); return store.save(performFigure(d, { concept_id: v.concept_id, slide: v.slide, remove: true }).deck); });

  // Returning learners upload their state file.
  ctx.handle('import-deck', (i) => {
    const deck = validateDeck(structuredClone(object(i).deck));
    if (!ID.test(deck.id)) fail('Invalid deck id.');
    return store.save(deck);
  });

  ctx.handle('start-session', async (i) => {
    const { deckId, model } = object(i);
    const deck = deckOrFail(deckId);
    if (!deck.concepts.length) fail('This deck has no concepts yet.');
    const spec = await modelFrom(ctx, model);
    const agentId = 'tutor_' + createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0, 24);
    if (!defs.some(e => e.id === agentId)) { const entry = { id: agentId, model: spec }; defs = [...defs, entry]; writeAtomic(defsFile, JSON.stringify(defs)); registerAgent(entry); }
    const agent = await ctx.agents.create(agentId);
    current = { id: randomUUID(), deckId, agentId: agent.id, hinted: new Set() };
    persistCurrent();
    return ctx.agents.send(agent.id, queueMessage(deck), { requestId: randomUUID(), purpose: 'user' });
  });
  ctx.handle('session-get', () => (current ? { session: { id: current.id, deckId: current.deckId, agentId: current.agentId }, agent: ctx.agents.get(current.agentId) } : null));
  ctx.handle('answer', (i) => {
    const v = object(i);
    if (!current) fail('No active session.');
    const call = ctx.agents.get(current.agentId).pending.find(p => p.toolCallId === v.toolCallId);
    if (call?.input?.mode === 'hint' && call.input.concept_id) { current.hinted.add(call.input.concept_id); persistCurrent(); }
    return ctx.agents.answer(current.agentId, v.toolCallId, v.answer, { requestId: v.requestId, purpose: 'user' });
  });
  ctx.handle('send', (i) => { const v = object(i); if (!current) fail('No active session.'); return ctx.agents.send(current.agentId, v.text, { requestId: v.requestId, purpose: 'user' }); });
  ctx.handle('abort', () => { if (current) ctx.agents.abort(current.agentId); return null; });

  ctx.handle('graph-sync-status', (i) => { const id = String(object(i).id); return graphSync ? graphSync.status(id) : { state: 'unsupported', pending: 0, lastAt: null, error: null }; });
  ctx.handle('graph-sync-now', async (i) => {
    if (!graphSync) fail('This version of LearnHarness cannot add notes to the graph.');
    return graphSync.syncNow(deckOrFail(object(i).id).id);
  });

  ctx.handle('notes-markdown', (i) => { const d = deckOrFail(object(i).id); return buildNotesMarkdown({ title: d.title, concepts: d.concepts }); });
  ctx.handle('summary', (i) => { const d = deckOrFail(object(i).id); return { queue: sessionQueue(d.concepts).map(c => c.id), revisit: revisitList(d.concepts).map(c => ({ id: c.id, title: c.title, status: c.status, nextRevisit: c.nextRevisit })) }; });

  ctx.handle('export-pdf', async (i) => {
    const d = deckOrFail(object(i).id);
    const out = path.join(os.tmpdir(), `living-notes-${randomUUID()}.pdf`);
    try {
      const images = pages.images(d.id, d.concepts.flatMap(c => (c.figures ?? []).map(f => f.slide)));
      await htmlToPdf(buildHtml(buildNotesMarkdown({ title: d.title, concepts: d.concepts }), { title: d.title, images }), out, { signal: ctx.signal });
      return { name: `${d.title.replace(/[^\w -]+/g, '').trim() || 'notes'}.pdf`, base64: fs.readFileSync(out).toString('base64') };
    } finally { fs.rmSync(out, { force: true }); }
  });
};
