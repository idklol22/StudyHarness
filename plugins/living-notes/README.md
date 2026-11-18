# Study

A Core LearnHarness plugin (id `living-notes`, kept so existing decks and data carry over). Study happens **in chat**: start a Teach or Practice chat on Home and attach slides or a PDF, name a topic ("teach me linear regression"), or name a paper. The chat agents get Study tools and build a **notebook** for it, filed under a **subject**, and keep it up to date while they teach or quiz you.

## What you see

- **Notebook pane beside the chat** (toggle in the session top bar, drag its left edge to resize). Tabs:
  - **Notes** — a 2D **map of ideas** (notebook → topics → concepts, coloured by how well you know each), then every concept with its summary, **callouts** (Revisit this · Crucial · Likely exam material · Common mistake · Tip), **slide screenshots** of the figures that matter, worked steps, your mistakes and the points clarified in the chat. Recently changed items highlight.
  - **Cards** — the notebook's flashcards by topic.
  - **Activity** — what the agent is doing, live: "Read slides 5–8 of 32 (25%): found …", "Added 3 flashcards", "Marked … as likely exam material".
  - **PDF** — export the notes as handwritten-style PDF (same 2D map).
- **Subjects** (sidebar). Every subject lists its **notes** (notebooks), the **slides** they came from, and its **flashcards** by topic: tick topics (or all) and study them in **Due** (spaced repetition, FSRS-6), **Progressive** (weakest topic first, ordered from your past ratings) or **All** mode. Reveal with Space, rate 1–4.

## What the agent does

- **Slides / PDF**: `study_import_slides` renders every slide natively (no browser), reads it with your vision model in batches of four, and builds concepts, initial notes, an initial flashcard set and **slide screenshots automatically** wherever a figure, diagram, chart or table helps. Progress streams to the chat and the Activity tab.
- **Topic / paper**: `study_notebook` opens a notebook; concepts are added as they are taught (`study_concept`). Papers are researched with the app's own research/web tools first.
- **While teaching**: grades answers (`study_grade`; status and revisit dates are computed by code, never set by the model), grows the notes (`study_note`), keeps flashcards in step (`study_cards` add / edit / remove), and adds or shows slide screenshots (`study_figure`).
- **Practice**: `study_practice_next` (due / progressive / all, by topic) and `study_practice_rate` (1 again … 4 easy).

Rules: **notes are never deleted** — the agent adds clarifications and callouts, and an edited summary keeps its previous wording in the concept's history. Flashcards may be removed. Everything learned is added to the app's Knowledge graph (only objective content: never status, scores or dates).

## Data

`<learning data>/core-plugin-data/living-notes/`: `decks/deck-<id>.json` (one notebook each: concepts, notes, callouts, flashcards with their FSRS schedules, activity), `pages/<id>/` (stored slide images for screenshots), `subjects.json` (subjects, which subject each notebook belongs to, which notebook each chat uses). Decks from older versions load unchanged and are filed under **Unsorted**.

Host requirements: backend `ctx.documents` (PDF page rendering under the agent's file-access rules), `registerTools` / `registerInstructions`, and frontend `registerSessionPanel`. PDF only (export PowerPoint/Keynote to PDF first); no OCR beyond what the vision model reads.

```sh
npm run build   # also regenerates .generated/assets.cjs (fonts, KaTeX CSS, rough.js inlined)
npm test
```
