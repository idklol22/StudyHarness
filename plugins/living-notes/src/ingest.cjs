'use strict';
// Slides -> concepts. The vision model reads page images + extracted text and
// returns concepts; the slide *source text* stored for grading comes from the PDF
// text itself, never from the model.
const { newConcept } = require('./state.cjs');

const SYSTEM = `You split lecture slides into study concepts. You are given slide images and any extractable text for numbered slides.
Read equations, figures and diagrams from the images, not just the text.
Return ONLY a JSON object: {"concepts":[{
  "title": short name,
  "topic": the broader topic heading,
  "summary": 1-3 plain-language sentences (the reader is not from a strong maths background); write maths inline as $...$ LaTeX,
  "slides": [slide numbers it comes from, only numbers you were given],
  "visual": what any figure/diagram on those slides shows, or "",
  "technique": how to approach exam questions on this concept and common traps, or "",
  "steps": [{"math": LaTeX for ONE step, "note": plain-language note on what this step does}] (worked example, one step per entry; [] if none),
  "qa": [{"q": question, "a": answer}] (up to 2 questions answerable cold),
  "figures": [{"slide": n, "crop": [x,y,w,h] as 0-1 fractions of the slide (omit for the whole slide), "caption": short}] (WHENEVER one of the concept's slides shows a figure, diagram, chart, plot, table or worked visual that helps understand it: these screenshots go straight into the learner's notes automatically. Skip logos, decorative pictures and slides that are only text. At most 2 per concept; give a generous crop with a small margin),
  "links": [titles of other concepts this one connects to]
}]}
Order concepts so prerequisites come first. "math" fields are bare LaTeX: no $ signs and no \( \) delimiters.
Never invent content that is not on the slides. If a slide is unreadable, omit it rather than guess.`;

const fail = (m) => { throw new Error(m); };
const str = (v, label, { required = false } = {}) => { if (typeof v !== 'string' || (required && !v.trim())) fail(`${label} must be ${required ? 'a non-empty ' : 'a '}string.`); return v.trim(); };

function parseJson(text) {
  const t = String(text).replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const start = t.indexOf('{'), end = t.lastIndexOf('}');
  if (start < 0 || end < start) fail('Reply contained no JSON object.');
  return JSON.parse(t.slice(start, end + 1));
}

// Figures must point at one of the concept's own slides; a bad crop is dropped to the whole slide, not trusted.
function validFigures(list, slides, title) {
  if (list == null) return [];
  if (!Array.isArray(list)) fail(`"${title}" figures must be an array.`);
  return list.slice(0, 2).map(f => {
    if (!slides.includes(f.slide)) fail(`"${title}" figure cites slide ${f.slide}, which is not one of its slides (${slides.join(', ')}).`);
    const ok = Array.isArray(f.crop) && f.crop.length === 4 && f.crop.every(Number.isFinite) && f.crop[0] >= 0 && f.crop[1] >= 0 && f.crop[2] >= .05 && f.crop[3] >= .05 && f.crop[0] + f.crop[2] <= 1.001 && f.crop[1] + f.crop[3] <= 1.001;
    return { slide: f.slide, ...(ok ? { crop: f.crop } : {}), caption: typeof f.caption === 'string' ? f.caption.trim() : '' };
  });
}

function validateConcepts(value, allowedPages) {
  if (!value || !Array.isArray(value.concepts)) fail('Return {"concepts":[...]}.');
  const allowed = new Set(allowedPages);
  return value.concepts.map((c, i) => {
    const title = str(c.title, `concepts[${i}].title`, { required: true });
    if (!Array.isArray(c.slides) || !c.slides.length) fail(`"${title}" must cite slide numbers.`);
    const bad = c.slides.filter(n => !allowed.has(n));
    if (bad.length) fail(`"${title}" cites slides ${bad.join(', ')} which were not provided. Use only: ${[...allowed].join(', ')}.`);
    return {
      title, topic: str(c.topic ?? 'General', 'topic') || 'General', summary: str(c.summary ?? '', 'summary'), slides: c.slides,
      visual: str(c.visual ?? '', 'visual'), technique: str(c.technique ?? '', 'technique'),
      steps: (c.steps ?? []).map((s, j) => ({ math: str(s.math, `steps[${j}].math`, { required: true }), note: str(s.note ?? '', 'note') })),
      qa: (c.qa ?? []).map((p, j) => ({ q: str(p.q, `qa[${j}].q`, { required: true }), a: str(p.a, `qa[${j}].a`, { required: true }), slides: c.slides })),
      figures: validFigures(c.figures, c.slides, title),
      links: (c.links ?? []).map(l => str(l, 'link')),
    };
  });
}

function userMessage(pages, extra) {
  const content = [{ type: 'text', text: `${extra ? extra + '\n\n' : ''}Slides ${pages.map(p => p.n).join(', ')}. Extracted text per slide follows each image.` }];
  for (const p of pages) {
    content.push({ type: 'text', text: `--- Slide ${p.n} ---\n${(p.text || '(no extractable text)').slice(0, 4000)}` });
    if (p.image) content.push({ type: 'image', data: p.image, mimeType: p.mime ?? 'image/jpeg' });
  }
  return { role: 'user', content, timestamp: Date.now() };
}

async function extractBatch(inference, { model, pages, extra, signal }) {
  const allowed = pages.map(p => p.n);
  let feedback = '', lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await inference.complete({
      model, purpose: 'user', signal,
      context: { systemPrompt: SYSTEM, messages: [userMessage(pages, [extra, feedback].filter(Boolean).join('\n'))] },
    });
    if (reply.stopReason === 'error' || reply.stopReason === 'aborted') fail(reply.errorMessage || `Model call ${reply.stopReason}.`);
    const text = reply.content.filter(c => c.type === 'text').map(c => c.text).join('');
    try { return validateConcepts(parseJson(text), allowed); }
    catch (e) { lastError = e; feedback = `Your previous reply was rejected: ${e.message} Return corrected JSON only.`; }
  }
  throw new Error(`Could not read slides ${allowed[0]}–${allowed.at(-1)}: ${lastError.message}`);
}

const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'concept';

// Merge batch drafts (same title = same concept), attach source text from the PDF.
function mergeDrafts(drafts, pageText) {
  const byTitle = new Map();
  for (const d of drafts) {
    const key = d.title.toLowerCase();
    const prev = byTitle.get(key);
    if (!prev) { byTitle.set(key, { ...d, slides: [...d.slides] }); continue; }
    prev.slides = [...new Set([...prev.slides, ...d.slides])];
    prev.steps = prev.steps.length ? prev.steps : d.steps;
    prev.qa = [...prev.qa, ...d.qa].slice(0, 3);
    prev.links = [...new Set([...prev.links, ...d.links])];
    prev.figures = [...(prev.figures ?? []), ...(d.figures ?? [])].slice(0, 2);
    for (const k of ['summary', 'visual', 'technique']) if (!prev[k]) prev[k] = d[k];
  }
  const used = new Set();
  const list = [...byTitle.values()].sort((a, b) => Math.min(...a.slides) - Math.min(...b.slides));
  const idOf = new Map();
  for (const d of list) { let id = slug(d.title), n = 2; while (used.has(id)) id = `${slug(d.title)}-${n++}`; used.add(id); idOf.set(d.title.toLowerCase(), id); }
  return list.map((d, order) => ({
    ...newConcept({ id: idOf.get(d.title.toLowerCase()), title: d.title, summary: d.summary, slides: d.slides, topic: d.topic, order }),
    technique: d.technique, steps: d.steps, qa: d.qa, visual: d.visual,
    figures: d.figures ?? [],
    links: d.links.map(l => idOf.get(l.toLowerCase())).filter(Boolean),
    source: [...d.slides].sort((a, b) => a - b).map(n => `[slide ${n}] ${(pageText[n] || '').trim()}`).join('\n').slice(0, 6000),
  }));
}

module.exports = { extractBatch, mergeDrafts, validateConcepts, parseJson, SYSTEM };
