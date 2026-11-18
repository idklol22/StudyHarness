'use strict';
// Learner state and promotion rules. Deterministic code only: the model reports
// a grade, but status, counters and revisit dates are decided here so mastery
// can never be overstated by a generous tutor.

const STATUSES = ['new', 'shaky', 'ok', 'solid'];
const GRADES = ['right', 'missing', 'wrong'];
const DAY = 86400000;
// Gap in days after the n-th consecutive clean correct answer (1, 3, 7, 14).
const GAPS = [1, 3, 7, 14];
const SHAKY_GAP = 1;

const fail = (message) => { throw new Error(message); };

function newConcept({ id, title, summary = '', slides = [], topic = 'General', order = 0 }) {
  if (!id || typeof id !== 'string') fail('Concept needs an id.');
  if (!title || typeof title !== 'string') fail('Concept needs a title.');
  if (!Array.isArray(slides) || !slides.length || slides.some(n => !Number.isInteger(n) || n < 1)) fail(`Concept "${title}" must cite at least one slide number (1-based).`);
  return {
    id, title, summary, topic, order, slides: [...new Set(slides)].sort((a, b) => a - b),
    status: 'new',
    right: [], missed: [], wrong: [],     // {text, session, at, slides}
    technique: '',
    steps: [],                            // worked example: {math, note}, one step per line
    qa: [],                               // {q, a, slides} the learner should answer cold
    source: '', visual: '',               // slide text (from the PDF) and figure description
    figures: [],                          // {slide, crop?, caption}: slide screenshots to embed in the notes
    discussion: [],                       // {text, at, session} clarifications from the tutoring chat
    links: [],                            // ids of related concepts (mind map)
    timesAsked: 0, lastAsked: null, nextRevisit: null,
    cleanStreak: 0,                       // consecutive hint-free right answers
    okSession: null,                      // session in which it first became ok
    history: [],                          // {session, at, grade, hinted}
  };
}

const iso = (date) => new Date(date).toISOString();
const startOfDay = (date) => { const d = new Date(date); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };

// Next revisit date, compressed so every revisit lands before the exam.
function nextRevisitAfter(gapDays, now, examDate) {
  let gap = gapDays;
  if (examDate) {
    const left = Math.floor((startOfDay(examDate) - startOfDay(now)) / DAY);
    if (left <= 0) gap = 0;
    else gap = Math.min(gap, Math.max(1, Math.floor(left / 2)));
  }
  return iso(startOfDay(now) + gap * DAY);
}

// Apply one graded answer. Pure: returns a new concept.
//   grade  : right | missing | wrong
//   hinted : true if the learner needed a hint (a hinted answer never promotes)
//   text   : the learner's actual answer, in their words (recorded for missing/wrong)
//   note   : what was right/missing/why wrong, citing the slide
function applyAnswer(concept, { grade, hinted = false, session, now = Date.now(), text = '', note = '', slides, examDate = null }) {
  if (!GRADES.includes(grade)) fail(`Grade must be one of ${GRADES.join(', ')}.`);
  if (!session) fail('A session id is required.');
  const cited = (slides && slides.length ? slides : concept.slides);
  if (!cited.every(n => Number.isInteger(n) && n >= 1)) fail('Slide references must be positive integers.');
  const c = structuredClone(concept);
  const at = iso(now);
  const entry = { text, note, session, at, slides: cited };
  c.timesAsked += 1; c.lastAsked = at;
  c.history.push({ session, at, grade, hinted: !!hinted });

  if (grade === 'right') {
    c.right.push(entry);
    if (hinted) {
      // Right with help is not evidence of recall: no promotion, streak resets.
      c.cleanStreak = 0;
      if (c.status === 'new') c.status = 'shaky';
      else if (c.status === 'solid') c.status = 'ok';
    } else {
      c.cleanStreak += 1;
      if (c.status === 'new' || c.status === 'shaky') { c.status = 'ok'; c.okSession = session; }
      else if (c.status === 'ok' && c.okSession !== session) c.status = 'solid';
      // ok in the same session stays ok; solid stays solid.
    }
  } else {
    if (grade === 'wrong') { c.wrong.push(entry); c.status = 'shaky'; }
    else { // missing: partly right, something left out
      c.missed.push(entry);
      c.status = c.status === 'solid' ? 'ok' : 'shaky';
    }
    c.cleanStreak = 0;
    if (c.status === 'shaky') c.okSession = null;
  }

  const gap = c.status === 'shaky' || c.status === 'new' ? SHAKY_GAP : GAPS[Math.min(Math.max(c.cleanStreak, 1), GAPS.length) - 1];
  c.nextRevisit = nextRevisitAfter(gap, now, examDate);
  return c;
}

const isDue = (c, now = Date.now()) => c.status === 'new' || c.status === 'shaky' || (c.nextRevisit !== null && new Date(c.nextRevisit).getTime() <= now);

// Concepts to open a session with: shaky first, then due, then new, in slide order.
function sessionQueue(concepts, now = Date.now()) {
  const rank = { shaky: 0, ok: 1, solid: 1, new: 2 };
  return concepts.filter(c => isDue(c, now)).sort((a, b) =>
    (rank[a.status] - rank[b.status]) || ((a.nextRevisit ?? '') < (b.nextRevisit ?? '') ? -1 : 1) || a.order - b.order);
}

function revisitList(concepts, now = Date.now()) {
  return sessionQueue(concepts, now).filter(c => c.status !== 'new');
}

module.exports = { STATUSES, GRADES, GAPS, newConcept, applyAnswer, nextRevisitAfter, isDue, sessionQueue, revisitList };
