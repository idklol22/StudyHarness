'use strict';
// Study tools for the app's own chat agents (teacher, prober, practice) — owner, 2026-11-18:
// "Study is chat: teach or practice from uploaded slides/PDFs, a topic, or a paper; it builds a
// notebook (map, notes, flashcards), keeps updating it while teaching, and adds slide screenshots
// on its own when they help". Every change lands in the notebook's activity feed and notifies the
// live notebook pane beside the chat.
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const study = require('./study.cjs');
const { extractBatch, mergeDrafts } = require('./ingest.cjs');
const { performFigure } = require('./tutor.cjs');
const { applyAnswer } = require('./state.cjs');

const fail = (m) => { throw new Error(m); };
const BATCH = 4;
const result = (text, details) => ({ content: [{ type: 'text', text }], details });

const INSTRUCTIONS = `## Study notebooks (Study plugin)
The learner studies in this chat. Their material lives in a Study NOTEBOOK (inside a SUBJECT) that you build and keep up to date; it is shown live beside the chat (map of ideas, notes, flashcards, an activity feed).

Starting:
- If the learner attaches or names slides / a PDF (a local path ending in .pdf), ask which subject it belongs to if that is not obvious (suggest one), then call study_import_slides with the path. It reads every slide, builds the concepts, initial notes, an initial flashcard set and slide screenshots of meaningful figures. It reports progress; then tell the learner briefly what was built and ask whether they want to be taught or quizzed.
- If they name a topic ("teach me linear regression") or a paper, call study_notebook with action "open" (origin "topic" or "paper", a short title, the subject). For a paper, research it first with your research/web tools. As you teach, add each concept with study_concept.
- If a notebook is already attached (study_notebook action "status" tells you), continue it.

While teaching:
- Teach progressively and ask questions; grade answers with study_grade (right / missing / wrong). Status and revisit dates are computed from grades, never set by you.
- Keep the notes alive with study_note: add clarifications from the discussion, and callouts — "revisit" (shaky, come back), "crucial" (central idea), "exam" (likely exam material), "mistake" (a common error), "tip". Notes are never deleted: you can add, and edit_summary keeps the previous wording.
- Keep flashcards in step with study_cards: add cards for what was taught or got wrong, edit unclear ones, remove ones that are wrong or redundant.
- When a slide figure, diagram, table or chart helps, call study_figure: it goes into the notes, and with show=true it also appears in this chat. Do it on your own; do not ask the learner to add screenshots.
- Practice chats: fetch cards with study_practice_next (mode "due", "progressive" — weakest topic first from past results — or "all"; optional topics), ask them one at a time in your own words, judge the answer, then record it with study_practice_rate (1 again, 2 hard, 3 good, 4 easy). Add notes/cards where the learner struggles.`;

/** The vision-capable model for reading slides: the vision slot, else the strong slot. */
async function slideModel(ctx) {
  const catalog = await ctx.inference.catalog();
  const slot = catalog?.slots?.vision?.model ?? catalog?.slots?.strong?.model;
  if (!slot) fail('No model is configured for reading slides. Set a vision-capable model in Settings → Models.');
  return { provider: slot.provider, id: slot.id, ...(slot.thinkingLevel ? { thinkingLevel: slot.thinkingLevel } : {}) };
}

function createStudyTools({ ctx, store, subjects, pages, graphSync, notify }) {
  const notebookFor = (chatId) => {
    const id = subjects.notebookForChat(chatId);
    const deck = id ? store.get(id) : null;
    return deck ? study.ensureNotebook(deck) : null;
  };
  const requireNotebook = (chatId) => notebookFor(chatId) ?? fail('No notebook is attached to this chat yet. Call study_notebook (action "open") or study_import_slides first.');
  const save = (deck, learned = false) => {
    store.save(deck);
    if (learned) graphSync?.touch(deck.id);
    notify({ notebookId: deck.id });
    return deck;
  };
  const describe = (deck) => {
    const byTopic = new Map();
    for (const c of deck.concepts) byTopic.set(c.topic, [...(byTopic.get(c.topic) ?? []), `${c.title} (${c.status})`]);
    const subjectId = subjects.subjectOf(deck.id);
    const subject = subjects.list().find((s) => s.id === subjectId)?.name ?? study.UNSORTED;
    const lines = [`Notebook "${deck.title}" in subject "${subject}" (${deck.origin}): ${deck.concepts.length} concepts, ${deck.cards.length} flashcards.`];
    for (const [t, list] of byTopic) lines.push(`- ${t}: ${list.join(', ')}`);
    return lines.join('\n');
  };

  /** Create (or reuse by title inside the subject) a notebook and attach it to the chat. */
  function openNotebook(chatId, { subject, title, origin }) {
    const name = String(title ?? '').trim() || 'Untitled notebook';
    const sub = subjects.ensure(subject);
    const index = subjects.read();
    const existing = store.list().find((d) => d.title.toLowerCase() === name.toLowerCase() && index.notebooks[d.id] === sub.id);
    let deck = existing ? study.ensureNotebook(store.get(existing.id)) : null;
    if (!deck) {
      deck = study.ensureNotebook({ id: randomUUID(), title: name, examDate: null, pageCount: 0, createdAt: new Date().toISOString(), concepts: [], draft: [], origin: study.ORIGINS.includes(origin) ? origin : 'topic' });
      study.log(deck, `Created the notebook "${name}" in ${sub.name}.`, 'notebook');
      store.save(deck);
      subjects.assign(deck.id, sub.id);
    }
    subjects.attachChat(chatId, deck.id);
    notify({ notebookId: deck.id, chatId });
    return deck;
  }

  async function importSlides(chatId, { path: file, subject, title }, signal, onUpdate) {
    const info = await ctx.documents.pdfInfo(file);
    const fileName = path.basename(info.path);
    const deck = openNotebook(chatId, { subject, title: title || fileName.replace(/\.pdf$/i, ''), origin: 'slides' });
    const source = { id: randomUUID(), fileName, path: info.path, pageCount: info.pageCount, addedAt: new Date().toISOString() };
    deck.sources.push(source);
    deck.pageCount = Math.max(deck.pageCount ?? 0, info.pageCount);
    study.log(deck, `Reading ${fileName} (${info.pageCount} slides)…`, 'progress');
    save(deck);
    const model = await slideModel(ctx);
    const drafts = [], pageText = {};
    for (let start = 1; start <= info.pageCount; start += BATCH) {
      if (signal?.aborted) fail('Import stopped.');
      const nums = [];
      for (let n = start; n < start + BATCH && n <= info.pageCount; n++) nums.push(n);
      const rendered = await ctx.documents.renderPdfPages({ path: info.path, pages: nums, dpi: 110 });
      for (const p of rendered) {
        pages.save(deck.id, p.page, { image: p.png, w: p.width, h: p.height });
        pageText[p.page] = p.text;
      }
      const found = await extractBatch(ctx.inference, {
        model, signal,
        pages: rendered.map((p) => ({ n: p.page, text: p.text, image: p.png, mime: 'image/png' })),
      });
      drafts.push(...found);
      const latest = study.ensureNotebook(store.get(deck.id));
      const pct = Math.round((nums.at(-1) / info.pageCount) * 100);
      const message = `Read slides ${nums[0]}–${nums.at(-1)} of ${info.pageCount} (${pct}%)${found.length ? `: found ${found.map((d) => d.title).join(', ')}` : ''}.`;
      study.log(latest, message, 'progress');
      save(latest);
      onUpdate?.(result(message, { done: nums.at(-1), total: info.pageCount }));
    }
    if (!drafts.length) fail('No concepts could be read from these slides.');
    const latest = study.ensureNotebook(store.get(deck.id));
    // Slide numbers are per source; a second deck in one notebook is offset after the first.
    const fresh = mergeDrafts(drafts, pageText);
    let addedConcepts = 0, addedCards = 0, figures = 0;
    for (const c of fresh) {
      if (latest.concepts.some((x) => x.title.toLowerCase() === c.title.toLowerCase())) continue;
      const id = latest.concepts.some((x) => x.id === c.id) ? `${c.id}-${randomUUID().slice(0, 6)}` : c.id;
      latest.concepts.push({ ...c, id, order: latest.concepts.length, callouts: [], revisions: [] });
      addedConcepts++;
      figures += (c.figures ?? []).length;
      addedCards += study.addCards(latest, (c.qa ?? []).map((p) => ({ concept: id, q: p.q, a: p.a })), 'slides').length;
    }
    // Links were resolved inside this batch; keep only ones that point at real concepts.
    const ids = new Set(latest.concepts.map((c) => c.id));
    for (const c of latest.concepts) c.links = (c.links ?? []).filter((l) => ids.has(l));
    study.log(latest, `Built the notebook from ${fileName}: ${addedConcepts} concepts, ${addedCards} flashcards, ${figures} slide screenshots.`, 'notebook');
    save(latest, true);
    return result(`${describe(latest)}\n\nImported ${fileName}: ${addedConcepts} new concepts, ${addedCards} flashcards, ${figures} slide screenshots added to the notes. Tell the learner what was built and ask whether they want to be taught or quizzed.`, { notebookId: latest.id });
  }

  const conceptRef = { type: 'string', description: 'Concept id or exact title.' };
  return function create(context) {
    const { chatId } = context;
    return [
      {
        name: 'study_notebook', label: 'Study notebook',
        description: 'Open (create or reuse) a Study notebook for this chat, or show the attached notebook\'s status (concepts by topic, flashcards).',
        parameters: { type: 'object', additionalProperties: false, required: ['action'], properties: {
          action: { enum: ['open', 'status'] },
          subject: { type: 'string', description: 'Subject name, e.g. "Machine Learning". Created if new.' },
          title: { type: 'string', description: 'Notebook title, e.g. "Linear regression" or "Lecture 3".' },
          origin: { enum: ['topic', 'paper'] },
        } },
        execute: async (_id, a) => {
          if (a.action === 'status') { const d = notebookFor(chatId); return result(d ? describe(d) : 'No notebook is attached to this chat yet.'); }
          if (!a.title) fail('Give the notebook a title.');
          return result(describe(openNotebook(chatId, a)));
        },
      },
      {
        name: 'study_import_slides', label: 'Import slides',
        description: 'Read a slide deck or PDF (local path) into the chat\'s notebook: every slide is rendered and read, building concepts, initial notes, flashcards and slide screenshots of meaningful figures. Reports progress. Uses the vision model; costs model calls.',
        parameters: { type: 'object', additionalProperties: false, required: ['path'], properties: {
          path: { type: 'string', description: 'Absolute path to a .pdf file (export PowerPoint/Keynote to PDF first).' },
          subject: { type: 'string' }, title: { type: 'string', description: 'Notebook title (defaults to the file name).' },
        } },
        execute: async (_id, a, signal, onUpdate) => importSlides(chatId, a, signal, onUpdate),
      },
      {
        name: 'study_concept', label: 'Add concept',
        description: 'Add a concept you are teaching to the notebook (topic and paper notebooks grow this way).',
        parameters: { type: 'object', additionalProperties: false, required: ['title', 'topic', 'summary'], properties: {
          title: { type: 'string' }, topic: { type: 'string', description: 'The broader topic heading.' },
          summary: { type: 'string', description: '1–3 plain sentences; $...$ for maths.' },
        } },
        execute: async (_id, a) => {
          const d = requireNotebook(chatId);
          const { concept, created } = study.addConcept(d, a);
          save(d, true);
          return result(created ? `Added "${concept.title}" (id ${concept.id}).` : `"${concept.title}" already exists (id ${concept.id}).`);
        },
      },
      {
        name: 'study_note', label: 'Update notes',
        description: 'Grow the notes for a concept: add a clarification, add a callout (revisit / crucial / exam / mistake / tip), rewrite the summary (the previous wording is kept), or set the exam technique. Never deletes notes.',
        parameters: { type: 'object', additionalProperties: false, required: ['concept'], properties: {
          concept: conceptRef,
          add: { type: 'string', description: 'A clarification, analogy or worked point from the discussion.' },
          callout: { type: 'object', additionalProperties: false, required: ['kind', 'text'], properties: { kind: { enum: study.CALLOUTS }, text: { type: 'string' } } },
          edit_summary: { type: 'string' }, technique: { type: 'string' },
        } },
        execute: async (_id, a) => { const d = requireNotebook(chatId); const r = study.noteUpdate(d, a); save(d, true); return result(r.message); },
      },
      {
        name: 'study_cards', label: 'Flashcards',
        description: 'Add, edit or remove flashcards in the notebook. Add cards for what was taught or got wrong; edit unclear ones; remove wrong or redundant ones.',
        parameters: { type: 'object', additionalProperties: false, required: ['action'], properties: {
          action: { enum: ['add', 'edit', 'remove', 'list'] },
          cards: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['q', 'a'], properties: { concept: { type: 'string' }, topic: { type: 'string' }, q: { type: 'string' }, a: { type: 'string' } } } },
          id: { type: 'string' }, q: { type: 'string' }, a: { type: 'string' },
        } },
        execute: async (_id, a) => {
          const d = requireNotebook(chatId);
          if (a.action === 'list') return result(d.cards.map((c) => `${c.id} [${c.topic}] Q: ${c.q} A: ${c.a}`).join('\n') || 'No flashcards yet.');
          if (a.action === 'add') { const added = study.addCards(d, a.cards ?? [], 'tutor'); save(d); return result(`Added ${added.length} card(s).`); }
          if (!a.id) fail('Give the card id (study_cards action "list" shows ids).');
          if (a.action === 'edit') { study.editCard(d, a); save(d); return result('Card updated.'); }
          study.removeCard(d, a.id); save(d); return result('Card removed.');
        },
      },
      {
        name: 'study_figure', label: 'Slide screenshot',
        description: 'Put a screenshot of one of a concept\'s slides (whole slide or a crop) into the notes; with show=true the image is also shown in this chat. Use whenever a figure, diagram, table or chart helps — on your own.',
        parameters: { type: 'object', additionalProperties: false, required: ['concept', 'slide'], properties: {
          concept: conceptRef, slide: { type: 'integer', minimum: 1 }, caption: { type: 'string' }, show: { type: 'boolean' },
          crop: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'number', minimum: 0, maximum: 1 }, description: '[x, y, w, h] as fractions of the slide.' },
        } },
        execute: async (_id, a) => {
          const d = requireNotebook(chatId);
          const c = study.conceptOf(d, a.concept);
          const r = performFigure(d, { concept_id: c.id, slide: a.slide, crop: a.crop, caption: a.caption }, (n) => pages.has(d.id, n));
          const next = study.ensureNotebook(r.deck);
          study.log(next, `Added a screenshot of slide ${a.slide} to "${c.title}".`, 'figure');
          save(next);
          const content = [{ type: 'text', text: r.message }];
          if (a.show) {
            const img = pages.images(d.id, [a.slide])[a.slide];
            if (img) { const [, mime, data] = /^data:(image\/[a-z]+);base64,(.*)$/.exec(img.src) ?? []; if (data) content.push({ type: 'image', data, mimeType: mime }); }
          }
          return { content, details: { notebookId: d.id, slide: a.slide, crop: a.crop ?? null, caption: a.caption ?? '' } };
        },
      },
      {
        name: 'study_grade', label: 'Grade answer',
        description: 'Record how the learner answered a question on a concept. Code decides status and revisit dates; you only report the grade.',
        parameters: { type: 'object', additionalProperties: false, required: ['concept', 'grade', 'learner_answer', 'feedback'], properties: {
          concept: conceptRef, grade: { enum: ['right', 'missing', 'wrong'] }, hinted: { type: 'boolean' },
          learner_answer: { type: 'string' }, feedback: { type: 'string', description: 'What was right / missing / wrong.' },
        } },
        execute: async (_id, a) => {
          const d = requireNotebook(chatId);
          const c = study.conceptOf(d, a.concept);
          const next = applyAnswer(c, { grade: a.grade, hinted: !!a.hinted, session: chatId, text: a.learner_answer, note: a.feedback, examDate: d.examDate });
          d.concepts = d.concepts.map((x) => (x.id === c.id ? { ...next, callouts: c.callouts, revisions: c.revisions } : x));
          study.log(d, `Graded an answer on "${c.title}": ${a.grade}${a.hinted ? ' (hinted)' : ''}. Now ${next.status}.`, 'grade');
          save(d, true);
          return result(`Recorded ${a.grade}. "${c.title}" is now ${next.status}; revisit ${String(next.nextRevisit).slice(0, 10)}.`);
        },
      },
      {
        name: 'study_practice_next', label: 'Next flashcards',
        description: 'Get the next flashcards to quiz the learner on. mode "due" (spaced repetition), "progressive" (weakest topic first, from past results) or "all"; optional topics.',
        parameters: { type: 'object', additionalProperties: false, required: ['mode'], properties: {
          mode: { enum: ['due', 'progressive', 'all'] }, topics: { type: 'array', items: { type: 'string' } }, limit: { type: 'integer', minimum: 1, maximum: 20 },
        } },
        execute: async (_id, a) => {
          const d = requireNotebook(chatId);
          const q = study.studyQueue(d.cards, { mode: a.mode, topics: a.topics });
          const list = q.cards.slice(0, a.limit ?? 5);
          if (!list.length) return result('Nothing to practise right now for that selection.');
          const head = q.topic ? `Current topic: ${q.topic} (then: ${q.topicOrder.slice(1).join(', ') || 'none'}).\n` : '';
          return result(head + list.map((c) => `${c.id} [${c.topic}] Q: ${c.q} | expected: ${c.a}`).join('\n'));
        },
      },
      {
        name: 'study_practice_rate', label: 'Rate flashcard',
        description: 'Record how well the learner recalled a flashcard: 1 again, 2 hard, 3 good, 4 easy (updates its spaced-repetition schedule).',
        parameters: { type: 'object', additionalProperties: false, required: ['id', 'rating'], properties: { id: { type: 'string' }, rating: { type: 'integer', minimum: 1, maximum: 4 } } },
        execute: async (_id, a) => {
          const d = requireNotebook(chatId);
          const card = study.rateCard(d, a.id, a.rating);
          study.log(d, `Practised "${card.q.slice(0, 50)}": ${['', 'again', 'hard', 'good', 'easy'][a.rating]}.`, 'practice');
          save(d);
          return result(`Rated ${a.rating}. Next due ${new Date(card.schedule.due).toISOString().slice(0, 16).replace('T', ' ')}.`);
        },
      },
    ];
  };
}

module.exports = { INSTRUCTIONS, createStudyTools, slideModel };
