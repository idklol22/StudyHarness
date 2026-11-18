# Living Notes

A Core LearnHarness plugin. Upload a slide PDF and be taught by being questioned. Notes are rebuilt from what you showed you do and don't know, and export as a handwritten-style PDF.

- **Slides → concepts.** The browser renders each slide to an image; the Vision model reads equations, figures and text into concepts, each linked to slide numbers. Grading source text comes from the PDF itself, never from the model.
- **Tutor.** A managed agent runs pre-question → teach → recall → cross-question → grade. Maths asks you to write the next step; science asks for a prediction first.
- **Learner state.** Per concept: status (new / shaky / ok / solid), what you got right, missed and wrong (in your words), technique, revisit date, slide refs. Statuses are decided by code (`src/state.cjs`), not the model: a hint-free right answer gives `ok`; `solid` needs a correct answer in a *later* session; a wrong answer is `shaky`. A grade with `confidence: "unsure"` records nothing.
- **Revisit dates.** 1 / 3 / 7 / 14 day gaps, compressed to land before your exam date.
- **Notes.** Solid concepts compress to a line; shaky ones expand with a worked example, diagram and a highlighted revisit box; mistakes log, technique boxes, cold Q&A.
- **PDF.** Markdown → HTML (Caveat handwriting font, dotted paper, KaTeX maths, rough.js diagrams, seeded per-letter jitter) → printed with system Chrome, Edge or Chromium (override with `LIVING_NOTES_BROWSER`).

Limits: PDF only (export PPTX to PDF first); no OCR beyond what the vision model reads; the "maths needs steps" rule is tutor-prompt doctrine, not a code gate; handwriting is a font with jitter, not a forgery.

```sh
npm run build   # also regenerates .generated/assets.cjs (fonts, KaTeX CSS, rough.js inlined)
npm test
```

## Maps and screenshots

- **Map of ideas** is a 3D force-directed graph (like Obsidian's graph view). In the PDF it is drawn from the camera angle with the fewest crossing edges and overlapping labels, with depth shading, and labels spread apart with short leader lines. In the app, **3D map** opens a live version: drag to rotate, scroll to zoom, hover to highlight a concept's neighbours, click a concept to jump to it, double-click to reset.
- **Slide screenshots.** Slide images are stored when you upload a PDF. The model proposes figures (whole slide or a crop) only where a diagram or plot cannot be written as text or LaTeX; you can add or remove any with **Add slide screenshot** on a concept, or ask the tutor. Decks uploaded before this feature need re-uploading to store slide images. PowerPoint files: export to PDF first.

## Knowledge graph sync

What you study here is added to the app's Knowledge graph automatically, through `ctx.graph.importNotes` (the same extraction pipeline as an imported notes file).

- **When:** after each graded answer or note update, batched over about 15 seconds so a burst of answers is one extraction. The deck shows the state (waiting, syncing, up to date, failed) and has an **Update graph now** button, which also retries a failure.
- **What:** only concepts you have been asked about or discussed, and only when their content changed. The text is objective: the concept summary, formulas, corrected misconceptions, clarifications from the chat, Q&A.
- **What is never sent:** status (new/shaky/ok/solid), scores, dates or "I got this wrong". The graph stores ideas and connections, not ratings of you.
- **Cost:** each sync is an extraction run with your configured extraction models. If none is configured the deck says so instead of failing silently.
- Older versions of LearnHarness without `ctx.graph` simply skip the sync.
