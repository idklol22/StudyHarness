# Study redesign — plan (awaiting approval)

Status: **approved (owner, 2026-11-18) — mostly implemented.** Done: knowledge graph (3D hive of topic balls around Knowledge, 2D Obsidian-style fallback), sidebar cleanup, host APIs (`ctx.documents`, `registerSessionPanel`), Study data model + migration, chat tools + slide ingestion with auto screenshots, notebook pane, Subjects library with Due/Progressive/All flashcard study, 2D map in notes and PDF. Not yet: starting a Practice chat directly from the library (the library has its own review screen instead), in-chat image rendering for `study_figure` beyond the model-facing image.

## Decisions already made (owner, 2026-11-18)

1. **One Study area.** Living Notes and Flashcards merge into one place. Slide/topic flashcards live with their notes and are reviewed with the same FSRS-6 scheduler Flashcards uses today. The old Flashcards plugin leaves the sidebar (its saved cards stay on disk; it can be re-enabled in Settings → Core plugins).
2. **Study is chat.** You start a Study chat in *Teach* or *Practice*. In either you can attach notes (slides / PDF), name a topic ("linear regression"), or name a paper the agent looks up online. Everything after that is a normal conversation: follow-ups, side questions, push-back.
3. **Subject notebooks.** Material belongs to a **Subject** (e.g. "Machine Learning"). A subject holds **notebooks** (one per uploaded deck / topic / paper) and the **slides** they came from. Later chats attach to an existing notebook and keep growing it.
4. **Knowledge graph = Obsidian-style 2D**, colored by notebook/source.
5. **Live notebook sits beside the chat** on the right; the subject page lists all notes, slides and flashcards.

## 1. What you will see

### Sidebar
- Removed: the core *Teaching* and *Practice* buttons, the *Teaching / Practice / All* filter (the list shows all chats; practice chats keep their dumbbell icon), and the separate *Flashcards* and *Living Notes* entries.
- Added: **Subjects** (opens the subject library). Starting a chat stays on Home.

### Home
- The composer stays: "What do you want to learn?" with the existing **Teach | Practice** switch (this *is* the "study: teach or practice" choice) and the attach button for slides/PDFs.

### Subject library (plugin view)
- List of subjects → subject page with three tabs:
  - **Notes** — every notebook in the subject (title, source, last studied, status counts). Opening one shows the full notes (read-only view + "Continue studying" which opens a chat attached to it).
  - **Slides** — every uploaded deck (file name, slide count, thumbnails, which notebook used it).
  - **Flashcards** — grouped by **topic** with checkboxes. Buttons: **Study selected**, **Study all**. Mode picker:
    - **Due** — FSRS due cards only (spaced repetition).
    - **Progressive** — topic by topic, weakest first, using your past ratings and tutor grades to order and to decide when a topic is "done for now".
  - Studying flashcards opens a **Practice chat** that quizzes you on exactly those cards (you can answer in your own words, ask why, etc.); ratings update the schedule.

### Live notebook panel (right of the chat)
- Resizable, toggled from the session top bar, remembers open/closed per chat. Tabs:
  - **Notes** — rendered live (math, figures, callouts), with a **2D map of ideas** at the top. New/changed parts briefly highlight.
  - **Cards** — this notebook's flashcards, grouped by topic; shows added/edited ones.
  - **Activity** — a running feed of what the agent is doing: "Rendering slides 1–4 of 32 (12%)", "Read slides 5–8: found *Gradient descent*, *Learning rate*", "Added 3 cards to *Loss functions*", "Marked *Bias–variance* as exam-important", "Added screenshot of slide 14 to *ROC curve*".

## 2. What the agent does

### Ingesting slides (Teach or Practice)
1. You attach a PDF (or paste a path). The agent asks which subject it belongs to (suggesting one) and creates/attaches a notebook.
2. A background job renders each slide to an image, reads them with the vision model in batches, and streams progress + found concepts to the Activity feed and the chat.
3. When done it has: the concept **map**, **initial notes** for every concept, an **initial flashcard set**, and **slide screenshots automatically attached** wherever a figure/diagram/table/plot carries meaning that text or LaTeX can't. No "Add slide screenshot" button.
4. It tells you what it built and asks whether you want to be taught (Teach) or quizzed (Practice).

### Topic or paper instead of slides
- Topic: the agent builds the notebook from its teaching (concepts, notes, cards grow as it teaches).
- Paper: the agent uses the existing web research tool to find and read it, then builds the notebook from that.

### While teaching
- Teaches progressively and asks questions (the existing teacher behavior + the Living Notes pre-question → teach → recall → cross-question loop).
- **Notes are never deleted.** The agent can *add* and *edit* (edits keep the previous wording in history). It adds callouts:
  - *Revisit this* · *Crucial* · *Likely exam material* · *Common mistake* · *From our chat*.
- **Flashcards** are added, edited and removed as it learns what you know.
- **Screenshots**: if a slide figure helps, it adds it to the notes and can also show it to you in the chat.
- Everything learned feeds the **knowledge graph** (existing notes→graph sync), tagged with the notebook name.

### Practice
- Quizzes from the selected flashcards / notebook / topics; grades your answer; records an FSRS rating; adds notes and cards where you struggled.

## 3. Knowledge graph (home)
- **2D only.** The 3D renderer and 2D/3D toggle are removed.
- **No blurred cluster regions or cluster labels** (removed from rendering and settings).
- Thin straight lines, **no arrowheads**.
- **Node size by number of links** (hubs bigger, like Obsidian).
- **Hover**: node + neighbours lit, everything else dimmed; labels fade in on zoom (already works).
- **Color by notebook/source** with a small legend; click a legend entry to hide/show that group.

## 4. Technical outline

| Area | Change |
| --- | --- |
| `plugins/living-notes` | Becomes **Study** (display name). Plugin id stays `living-notes` so existing decks/data are kept. New store: subjects → notebooks → concepts/cards/sources/activity, migrated from existing decks (each old deck → a notebook in a "Unsorted" subject). Card scheduling reuses `plugins/flashcards/src/scheduler.cjs` (bundled). Old form UI replaced by the subject library + panel. |
| Agent tools (plugin `registerTools` for `teacher`, `prober`, `practice`) | `study_attach_notebook`, `study_import_slides` (background job with progress), `study_note` (add/edit + callouts), `study_cards` (add/edit/remove), `study_figure` (attach slide crop; optional show in chat), `study_next_cards` / `study_rate_card` (practice). Instructions via `registerInstructions`. |
| Core host API (new) | `ctx.documents.renderPages(path, pages)` on the **backend** (reuses the existing native pdfjs + @napi-rs/canvas renderer). **Session side panel** slot: `ctx.registerSessionPanel({id, name, mount})` + top-bar toggle + resizable right pane in the chat layout. Plugin docs/contracts updated. |
| Notes rendering | In-app DOM renderer (host Markdown for math) + 2D map (canvas). PDF export keeps the handwritten style; its 3D map becomes the same 2D layout. |
| Sidebar / home | Remove doors + filter as listed in §1. |
| Graph | `graph-view.tsx` / `graph-canvas.ts`: drop 3D + regions + cluster labels + arrowheads; degree-sized nodes; neighbour highlight/dim; group colors + legend. Delete `graph-3d.ts`, `graph-3d-layout.ts` and their tests. |
| Flashcards plugin | Removed from the sidebar (disabled by default); code and data kept. |

## 5. Limits / honest notes
- PowerPoint: still PDF only (export PPTX → PDF). No OCR beyond what the vision model reads.
- Vision ingestion costs model calls per batch of slides (same as Living Notes today).
- Showing a slide image *inside the chat* depends on tool results being able to carry images to the transcript; if the host can't, the figure goes to the notes panel and the chat links to it.
- This is a large change (core layout + plugin API + plugin rewrite + graph). I'd build it in this order, each step tested before the next: **graph → sidebar/home → host APIs (renderPages, side panel) → Study data model + migration → agent tools + ingestion → panel UI → subject library → practice/flashcards → PDF export map → docs**.
