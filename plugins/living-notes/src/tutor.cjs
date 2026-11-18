'use strict';
// The questioning tutor. The model teaches and asks; deterministic code grades
// into state (state.cjs). The model can never set a status directly.
const { applyAnswer, sessionQueue } = require('./state.cjs');

const INSTRUCTIONS = `You are a tutor who teaches by questioning, not lecturing. You work through one concept at a time from the session queue.

For EACH concept, in order:
1. Call get_concept to read its slide text and the learner's history. The slide text is the source of truth. The "summary" is machine-written: verify it against the slide text before using it.
2. PRE-QUESTION: ask (mode "pre") what they think the concept is or does, before explaining anything.
3. TEACH a short chunk in plain language (put it in the ask call's "teach" field), tied to the slides. The learner may not have a strong maths background.
4. RECALL: ask (mode "recall") them to explain it back without looking.
5. CROSS-QUESTION with ask: why does it work? what if X changes? where does it break? how does it differ from a similar-looking concept?
   - Maths: use mode "step": make the learner write the NEXT step themselves. Never show the full solution first and never accept only a final answer.
   - Science: use mode "predict": they predict the outcome first, then explain why.
6. GRADE each answer with the grade tool: "right", "missing" (partly right, something left out) or "wrong". Say exactly what was right, missing or wrong and cite the slide. No vague praise.

Rules:
- Every question and every grade must cite slide numbers from that concept.
- If you give a hint (ask mode "hint"), any later grade on that concept is "hinted" and cannot promote it.
- NEVER say an answer is correct when you are not sure. If the slides don't settle it, pass confidence "unsure": nothing is recorded, then ask a clarifying question or tell the learner plainly that the slides don't settle it.
- Quote the learner's actual wrong answer in learner_answer, in their words.
- If they are shaky, loop back with a different question before moving on.
- Ask one question at a time. Be brief.
- The notes are rebuilt from what we discuss. Whenever the discussion changes what the notes should say, call update_notes: the learner asks a side question you answer, gives their own explanation or analogy worth keeping, corrects you or you correct a slide misreading, or you find a better worked example or exam technique. Put it in "clarification" in plain language, using $...$ for any maths. Do not use it for grades.
- The learner may chat at any time (questions, objections, "explain differently"). Answer from the slides, then record anything notes-worthy with update_notes.
- If the learner asks for a slide, figure or diagram to be in their notes, call add_figure (whole slide unless you know where the figure is). Do not add screenshots otherwise: prefer text and LaTeX.
- When the queue is done or the learner stops, call finish_session.`;

const fail = (m) => { throw new Error(m); };
const find = (deck, id) => deck.concepts.find(c => c.id === id) ?? fail(`Unknown concept_id "${id}". Use ids from the queue.`);

function queueMessage(deck, now = Date.now()) {
  const queue = sessionQueue(deck.concepts, now);
  const rows = queue.map(c => ({ concept_id: c.id, title: c.title, status: c.status, slides: c.slides, last_wrong: c.wrong.at(-1)?.text ?? null, due: c.nextRevisit }));
  return `Deck: ${deck.title}${deck.examDate ? ` (exam ${deck.examDate.slice(0, 10)})` : ''}.\nStart with the shaky and due concepts, then new ones, in this order:\n${JSON.stringify(rows, null, 1)}\n${queue.length ? 'Begin with the first concept.' : 'Nothing is due: tell the learner, then call finish_session.'}`;
}

function conceptView(c) {
  return JSON.stringify({
    concept_id: c.id, title: c.title, status: c.status, slides: c.slides,
    slide_text: c.source || '(no extractable text; rely on the figure description)', figure_description: c.visual,
    machine_summary: c.summary, technique: c.technique, worked_steps: c.steps, notes_from_discussion: (c.discussion ?? []).map(d => d.text),
    learner_history: { times_asked: c.timesAsked, wrong_answers: c.wrong.slice(-3).map(w => w.text), missed: c.missed.slice(-3).map(w => w.text) },
  }, null, 1);
}

// Pure grade step: validates, applies, returns {deck, message}. confidence "unsure" records nothing.
function performGrade(deck, session, args, now = Date.now()) {
  const c = find(deck, args.concept_id);
  if (typeof args.learner_answer !== 'string' || !args.learner_answer.trim()) fail('learner_answer is required: quote what the learner actually said.');
  if (typeof args.feedback !== 'string' || !args.feedback.trim()) fail('feedback is required: say what was right, missing or wrong.');
  if (!Array.isArray(args.slides) || !args.slides.length) fail('Cite the slide numbers this grade comes from.');
  const allowed = new Set(c.slides);
  const stray = args.slides.filter(n => !allowed.has(n));
  if (stray.length) fail(`Slides ${stray.join(', ')} are not part of this concept (${c.slides.join(', ')}).`);
  if (args.confidence === 'unsure') return { deck, message: 'Not recorded because you were unsure. Ask a clarifying question or tell the learner the slides do not settle it.' };
  const hinted = !!args.hinted || session.hinted.has(c.id);
  const next = applyAnswer(c, { grade: args.grade, hinted, session: session.id, now, text: args.learner_answer, note: args.feedback, slides: args.slides, examDate: deck.examDate });
  if (typeof args.technique === 'string' && args.technique.trim()) next.technique = args.technique.trim();
  const out = { ...deck, concepts: deck.concepts.map(x => (x.id === c.id ? next : x)) };
  return { deck: out, message: `Recorded ${args.grade}${hinted ? ' (hinted)' : ''}. "${c.title}" is now ${next.status}; revisit ${next.nextRevisit.slice(0, 10)}.` };
}

// Pure: fold what was discussed into a concept. Never touches status or revisit dates.
function performNoteUpdate(deck, session, args, now = Date.now()) {
  const c = find(deck, args.concept_id);
  if (!Array.isArray(args.slides) || !args.slides.length) fail('Cite the slide numbers this note comes from.');
  const stray = args.slides.filter(n => !c.slides.includes(n));
  if (stray.length) fail(`Slides ${stray.join(', ')} are not part of this concept (${c.slides.join(', ')}).`);
  const next = structuredClone(c);
  next.discussion = next.discussion ?? [];
  const at = new Date(now).toISOString(), changed = [];
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  if (text(args.clarification)) { next.discussion.push({ text: text(args.clarification), at, session: session.id, slides: args.slides }); changed.push('clarification'); }
  for (const p of args.add_qa ?? []) {
    if (!text(p.q) || !text(p.a)) fail('add_qa needs non-empty q and a.');
    if (!next.qa.some(x => x.q.trim() === text(p.q))) { next.qa.push({ q: text(p.q), a: text(p.a), slides: args.slides }); changed.push('Q&A'); }
  }
  if (text(args.technique)) { next.technique = text(args.technique); changed.push('technique'); }
  if (text(args.summary)) { next.summary = text(args.summary); changed.push('summary'); }
  if (Array.isArray(args.steps) && args.steps.length) {
    next.steps = args.steps.map((s, i) => { if (!text(s.math)) fail(`steps[${i}].math is empty.`); return { math: text(s.math), note: text(s.note) }; });
    changed.push('worked example');
  }
  if (!changed.length) fail('Nothing to update: give a clarification, add_qa, technique, summary or steps.');
  return { deck: { ...deck, concepts: deck.concepts.map(x => (x.id === c.id ? next : x)) }, message: `Notes for "${c.title}" updated (${[...new Set(changed)].join(', ')}). The learner's exported notes will show it.` };
}

// Pure: add or remove a slide screenshot on a concept. crop = [x, y, w, h] fractions of the slide.
function performFigure(deck, args, hasPage) {
  const c = find(deck, args.concept_id);
  const next = structuredClone(c); next.figures = next.figures ?? [];
  if (args.remove) {
    const before = next.figures.length;
    next.figures = next.figures.filter(f => f.slide !== args.slide);
    if (next.figures.length === before) fail(`No screenshot of slide ${args.slide} on "${c.title}".`);
  } else {
    if (!c.slides.includes(args.slide)) fail(`Slide ${args.slide} is not part of this concept (${c.slides.join(', ')}).`);
    if (hasPage && !hasPage(args.slide)) fail(`Slide ${args.slide} has no stored image. The learner must upload the PDF again to store slide images.`);
    let crop;
    if (args.crop != null) {
      const k = args.crop;
      if (!Array.isArray(k) || k.length !== 4 || !k.every(Number.isFinite) || k[0] < 0 || k[1] < 0 || k[2] < .05 || k[3] < .05 || k[0] + k[2] > 1.001 || k[1] + k[3] > 1.001) fail('crop must be [x, y, w, h] as 0-1 fractions inside the slide, with w and h at least 0.05.');
      crop = k;
    }
    if (next.figures.length >= 4) fail('At most 4 screenshots per concept.');
    next.figures = [...next.figures.filter(f => !(f.slide === args.slide && JSON.stringify(f.crop) === JSON.stringify(crop))), { slide: args.slide, ...(crop ? { crop } : {}), caption: typeof args.caption === 'string' ? args.caption.trim() : '' }];
  }
  return { deck: { ...deck, concepts: deck.concepts.map(x => (x.id === c.id ? next : x)) }, message: args.remove ? `Removed the screenshot of slide ${args.slide}.` : `Added a screenshot of slide ${args.slide}${args.crop ? ' (cropped)' : ''} to "${c.title}".` };
}

function makeTools({ store, session, hasPage = () => true, onLearned = () => {} }) {
  const text = (t, details) => ({ content: [{ type: 'text', text: t }], details });
  const live = () => { const s = session(); if (!s) fail('No active study session.'); return s; };
  return [
    { name: 'get_concept', description: 'Read a concept: slide text, figure description and the learner history.',
      parameters: { type: 'object', additionalProperties: false, required: ['concept_id'], properties: { concept_id: { type: 'string' } } },
      execute: async (_id, a) => { const s = live(); return text(conceptView(find(store.get(s.deckId), a.concept_id))); } },
    { name: 'ask', kind: 'input', description: 'Ask the learner one question and wait for their typed answer.',
      parameters: { type: 'object', additionalProperties: false, required: ['concept_id', 'mode', 'question', 'slides'], properties: {
        concept_id: { type: 'string' }, mode: { enum: ['pre', 'recall', 'cross', 'step', 'predict', 'hint'] },
        teach: { type: 'string', description: 'Short plain-language teaching chunk shown above the question.' },
        question: { type: 'string', minLength: 1 }, slides: { type: 'array', minItems: 1, items: { type: 'integer', minimum: 1 } } } },
      resultSchema: { type: 'string', minLength: 1 } },
    { name: 'grade', description: 'Record the grade for the learner\'s last answer. Code decides status; you only report the grade.',
      parameters: { type: 'object', additionalProperties: false, required: ['concept_id', 'grade', 'confidence', 'learner_answer', 'feedback', 'slides'], properties: {
        concept_id: { type: 'string' }, grade: { enum: ['right', 'missing', 'wrong'] }, confidence: { enum: ['sure', 'unsure'] }, hinted: { type: 'boolean' },
        learner_answer: { type: 'string' }, feedback: { type: 'string', description: 'What was right / missing / wrong, citing the slide.' },
        slides: { type: 'array', minItems: 1, items: { type: 'integer', minimum: 1 } }, technique: { type: 'string', description: 'Optional: how to approach this kind of question, and common traps.' } } },
      execute: async (_id, a) => { const s = live(); const r = performGrade(store.get(s.deckId), s, a); if (r.deck !== undefined && a.confidence !== 'unsure') { store.save(r.deck); onLearned(s.deckId); } return text(r.message); } },
    { name: 'update_notes', description: 'Change the notes for a concept based on the discussion (not for grading). Status is never changed by this.',
      parameters: { type: 'object', additionalProperties: false, required: ['concept_id', 'slides'], properties: {
        concept_id: { type: 'string' }, slides: { type: 'array', minItems: 1, items: { type: 'integer', minimum: 1 } },
        clarification: { type: 'string', description: 'What was clarified or worked out in the discussion, in plain language. $...$ for maths.' },
        add_qa: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['q', 'a'], properties: { q: { type: 'string' }, a: { type: 'string' } } } },
        technique: { type: 'string' }, summary: { type: 'string', description: 'Replace the concept summary with a corrected or clearer one.' },
        steps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['math', 'note'], properties: { math: { type: 'string', description: 'LaTeX, one step' }, note: { type: 'string' } } } } } },
      execute: async (_id, a) => { const s = live(); const r = performNoteUpdate(store.get(s.deckId), s, a); store.save(r.deck); onLearned(s.deckId); return text(r.message); } },
    { name: 'add_figure', description: 'Put a screenshot of one of an original slide of this concept into the notes. Use when they ask for it, or when a diagram or plot cannot be written as text or LaTeX. Whole slide unless you pass a crop.',
      parameters: { type: 'object', additionalProperties: false, required: ['concept_id', 'slide'], properties: {
        concept_id: { type: 'string' }, slide: { type: 'integer', minimum: 1 }, caption: { type: 'string' },
        crop: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'number', minimum: 0, maximum: 1 }, description: '[x, y, w, h] as fractions of the slide. Only if the learner or slide text tells you where the figure is; otherwise omit.' } } },
      execute: async (_id, a) => { const s = live(); const r = performFigure(store.get(s.deckId), a, n => hasPage(s.deckId, n)); store.save(r.deck); return text(r.message); } },
    { name: 'remove_figure', description: 'Remove a slide screenshot from a concept in the notes.',
      parameters: { type: 'object', additionalProperties: false, required: ['concept_id', 'slide'], properties: { concept_id: { type: 'string' }, slide: { type: 'integer', minimum: 1 } } },
      execute: async (_id, a) => { const s = live(); const r = performFigure(store.get(s.deckId), { ...a, remove: true }); store.save(r.deck); return text(r.message); } },
    { name: 'finish_session', description: 'End the session when the queue is done or the learner stops.', endRun: true,
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      execute: async () => { const s = live(); const d = store.get(s.deckId); const left = sessionQueue(d.concepts).filter(c => c.status !== 'new'); return text(`Session saved. Revisit next: ${left.map(c => c.title).join(', ') || 'nothing due'}.`, { revisit: left.map(c => c.id) }); } },
  ];
}

module.exports = { INSTRUCTIONS, queueMessage, conceptView, performGrade, performNoteUpdate, performFigure, makeTools };
