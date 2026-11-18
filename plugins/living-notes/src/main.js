// Study (formerly Living Notes) — owner, 2026-11-18. Study happens in chat: the app's own teacher and
// practice agents get Study tools (backend). This frontend adds:
//   - the NOTEBOOK pane beside every chat: the live notes (2D map of ideas, callouts, slide
//     screenshots), the flashcards and an activity feed showing what the agent is doing;
//   - the SUBJECTS library: subjects → their notes, slides and flashcards (by topic), with study
//     sessions in "due", "progressive" (weakest topic first) or "all" mode.
import { el, figureSlides, renderActivity, renderCards, renderNotes } from './notebook-view.js';

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const RATINGS = [[1, 'Again'], [2, 'Hard'], [3, 'Good'], [4, 'Easy']];

/** Tabs: returns {select(id)}; bodies render lazily into one shared host. */
function tabs(parent, items, onSelect, initial) {
  const bar = el('div', parent, { cls: 'ln-tabs', attrs: { role: 'tablist' } });
  const buttons = new Map();
  const select = (id) => {
    for (const [k, b] of buttons) { b.setAttribute('aria-selected', String(k === id)); b.classList.toggle('on', k === id); }
    onSelect(id);
  };
  for (const [id, label] of items) {
    const b = el('button', bar, { text: label, cls: 'ln-tab', attrs: { type: 'button', role: 'tab' } });
    b.onclick = () => select(id);
    buttons.set(id, b);
  }
  select(initial ?? items[0][0]);
  return { select };
}

export function activate(ctx) {
  const exportPdf = async (id) => {
    const out = await ctx.call('export-pdf', { id });
    download(out.name, new Blob([Uint8Array.from(atob(out.base64), (c) => c.charCodeAt(0))], { type: 'application/pdf' }));
  };

  // ── The notebook pane beside a chat ──────────────────────────────────────────
  ctx.registerSessionPanel({ id: 'notebook', name: 'Notebook', mount(container, session, signal) {
    let alive = true, tab = 'notes', timer = 0, current = null, bodySignal = null;
    signal.addEventListener('abort', () => { alive = false; clearTimeout(timer); }, { once: true });
    container.classList.add('ln-root', 'ln-pane');
    const head = el('div', container, { cls: 'ln-pane-head' });
    const host = el('div', container, { cls: 'ln-pane-body' });
    const error = el('p', container, { cls: 'ln-error', attrs: { role: 'alert' } });
    const renderBody = async () => {
      if (!alive || !current) return;
      bodySignal?.abort(); const ac = new AbortController(); bodySignal = ac;
      signal.addEventListener('abort', () => ac.abort(), { once: true });
      const deck = current.notebook;
      if (tab === 'notes') {
        const images = await ctx.call('slide-images', { id: deck.id, slides: figureSlides(deck) }).catch(() => ({}));
        if (alive && bodySignal === ac) renderNotes(host, deck, { ctx, signal: ac.signal, images });
      } else if (tab === 'cards') renderCards(host, deck, { ctx, signal: ac.signal });
      else renderActivity(host, deck);
    };
    const load = async () => {
      try {
        error.textContent = '';
        current = await ctx.call('notebook-for-chat', { chatId: session.sessionId });
        if (!alive) return;
        head.replaceChildren();
        if (!current) {
          host.replaceChildren();
          el('p', host, { cls: 'ln-empty', text: 'No notebook yet. Attach slides or a PDF in the chat, or ask to learn a topic — the notebook (map of ideas, notes, flashcards) builds here as you study.' });
          return;
        }
        const title = el('div', head, { cls: 'ln-pane-title' });
        el('span', title, { cls: 'ln-muted', text: current.subject?.name ?? 'Unsorted' });
        el('strong', title, { text: current.notebook.title });
        const pdf = el('button', head, { text: 'PDF', cls: 'ln-btn small', attrs: { type: 'button', title: 'Export these notes as a handwritten-style PDF' } });
        pdf.onclick = () => void exportPdf(current.notebook.id).catch((e) => { error.textContent = e.message; });
        const strip = el('div', head);
        tabs(strip, [['notes', 'Notes'], ['cards', `Cards · ${current.notebook.cards.length}`], ['activity', 'Activity']], (id) => { tab = id; void renderBody(); }, tab);
      } catch (e) { if (alive) error.textContent = e instanceof Error ? e.message : String(e); }
    };
    const offN = ctx.onNotification((e) => {
      if (e.topic !== 'study-changed') return;
      clearTimeout(timer); timer = setTimeout(() => void load(), 350); // a burst of tool calls → one refresh
    });
    const offR = ctx.onResync(() => void load());
    void load();
    return () => { alive = false; offN(); offR(); bodySignal?.abort(); container.replaceChildren(); };
  } });

  // ── The Subjects library ─────────────────────────────────────────────────────
  ctx.registerView({ id: 'subjects', name: 'Subjects', mount(container, signal) {
    let alive = !signal.aborted, data = null, route = { page: 'home' }, child = null;
    signal.addEventListener('abort', () => { alive = false; }, { once: true });
    container.classList.add('ln-root', 'ln-library');
    const error = el('p', container, { cls: 'ln-error', attrs: { role: 'alert' } });
    const body = el('div', container);
    const guarded = (fn) => async (...a) => { error.textContent = ''; try { await fn(...a); } catch (e) { if (alive) error.textContent = e instanceof Error ? e.message : String(e); } };
    const btn = (label, onClick, parent, cls = '') => { const b = el('button', parent, { text: label, cls: `ln-btn ${cls}`, attrs: { type: 'button' } }); b.onclick = () => void guarded(onClick)(); return b; };
    const scope = () => { child?.abort(); child = new AbortController(); signal.addEventListener('abort', () => child.abort(), { once: true }); return child.signal; };

    const refresh = async () => { data = await ctx.call('list-subjects'); if (alive) render(); };
    const go = (next) => { route = next; render(); };
    const notebooksOf = (subjectId) => data.notebooks.filter((n) => n.subjectId === subjectId);

    function render() {
      if (!alive || !data) return;
      const s = scope();
      body.replaceChildren();
      if (route.page === 'home') return renderHome();
      if (route.page === 'subject') return renderSubject(s);
      if (route.page === 'notebook') return void renderNotebook(s);
      if (route.page === 'review') return void renderReview(s);
    }

    function renderHome() {
      el('h1', body, { text: 'Subjects' });
      el('p', body, { cls: 'ln-muted', text: 'Everything you study lives here: notes, the slides they came from, and flashcards. Start a Teach or Practice chat on Home — attach slides or a PDF, or name a topic — and it is filed under a subject.' });
      const used = data.subjects.filter((s) => notebooksOf(s.id).length);
      if (!used.length) { el('p', body, { cls: 'ln-empty', text: 'No subjects yet.' }); return; }
      const grid = el('div', body, { cls: 'ln-grid' });
      for (const s of used) {
        const nbs = notebooksOf(s.id);
        const card = el('button', grid, { cls: 'ln-subject', attrs: { type: 'button' } });
        el('strong', card, { text: s.name });
        el('span', card, { cls: 'ln-muted', text: `${nbs.length} notebook${nbs.length === 1 ? '' : 's'} · ${nbs.reduce((t, n) => t + n.cards, 0)} cards · ${nbs.reduce((t, n) => t + n.due, 0)} due` });
        card.onclick = () => go({ page: 'subject', id: s.id, tab: 'notes' });
      }
    }

    function renderSubject(s) {
      const subject = data.subjects.find((x) => x.id === route.id);
      if (!subject) return go({ page: 'home' });
      const nbs = notebooksOf(subject.id);
      const bar = el('div', body, { cls: 'ln-row' });
      btn('← Subjects', () => go({ page: 'home' }), bar);
      el('h1', body, { text: subject.name });
      const host = el('div', body);
      tabs(body.insertBefore(el('div', null), host), [['notes', 'Notes'], ['slides', 'Slides'], ['cards', 'Flashcards']], (tab) => {
        route.tab = tab; host.replaceChildren();
        if (tab === 'notes') {
          if (!nbs.length) el('p', host, { cls: 'ln-empty', text: 'No notes yet.' });
          for (const n of nbs) {
            const row = el('button', host, { cls: 'ln-deck', attrs: { type: 'button' } });
            el('strong', row, { text: n.title });
            el('span', row, { cls: 'ln-muted', text: `${n.origin} · ${n.concepts} concepts · ${n.counts.solid} solid · ${n.counts.shaky} shaky · ${n.cards} cards` });
            row.onclick = () => go({ page: 'notebook', id: n.id, subjectId: subject.id });
          }
        } else if (tab === 'slides') {
          const sources = nbs.flatMap((n) => n.sources.map((src) => ({ ...src, notebook: n })));
          if (!sources.length) el('p', host, { cls: 'ln-empty', text: 'No slides uploaded for this subject yet.' });
          for (const src of sources) {
            const row = el('div', host, { cls: 'ln-deck' });
            const thumb = el('div', row, { cls: 'ln-thumb' });
            void ctx.call('slide-images', { id: src.notebook.id, slides: [1] }).then((imgs) => { if (imgs[1]) el('img', thumb, { attrs: { src: imgs[1].src, alt: `${src.fileName}, slide 1` } }); }).catch(() => {});
            el('strong', row, { text: src.fileName });
            el('span', row, { cls: 'ln-muted', text: `${src.pageCount} slides · used by "${src.notebook.title}"` });
          }
        } else renderTopicPicker(host, nbs, s);
      }, route.tab);
    }

    function renderTopicPicker(host, nbs, s) {
      const topics = new Map();
      for (const n of nbs) for (const t of n.topics) topics.set(t, true);
      const picked = new Set(route.topics ?? []);
      if (!nbs.some((n) => n.cards)) { el('p', host, { cls: 'ln-empty', text: 'No flashcards yet.' }); return; }
      const controls = el('div', host, { cls: 'ln-row' });
      const mode = el('select', controls, { attrs: { 'aria-label': 'How to study' } });
      for (const [v, label] of [['due', 'Due (spaced repetition)'], ['progressive', 'Progressive (weakest topic first)'], ['all', 'All cards']]) { const o = el('option', mode, { text: label }); o.value = v; }
      mode.value = route.mode ?? 'due';
      const studySel = btn('Study selected', () => go({ page: 'review', subjectId: route.id, notebookIds: nbs.map((n) => n.id), topics: [...picked], mode: mode.value }), controls, 'primary');
      btn('Study all', () => go({ page: 'review', subjectId: route.id, notebookIds: nbs.map((n) => n.id), topics: [], mode: mode.value }), controls);
      const list = el('div', host, { cls: 'ln-topics' });
      const sync = () => { studySel.disabled = !picked.size; studySel.textContent = picked.size ? `Study ${picked.size} topic${picked.size === 1 ? '' : 's'}` : 'Study selected'; };
      void (async () => {
        // Per-topic counts from the full notebooks.
        const decks = await Promise.all(nbs.map((n) => ctx.call('get-notebook', { id: n.id })));
        if (!alive || s.aborted) return;
        const cards = decks.flatMap((d) => d.cards ?? []);
        for (const t of [...new Set(cards.map((c) => c.topic))].sort()) {
          const row = el('label', list, { cls: 'ln-topic-row' });
          const box = el('input', row, { attrs: { type: 'checkbox' } }); box.checked = picked.has(t);
          box.onchange = () => { if (box.checked) picked.add(t); else picked.delete(t); route.topics = [...picked]; sync(); };
          el('span', row, { text: t });
          const mine = cards.filter((c) => c.topic === t);
          const due = mine.filter((c) => (c.schedule?.due ?? 0) <= Date.now()).length;
          el('span', row, { cls: 'ln-muted', text: `${mine.length} cards · ${due} due` });
        }
        sync();
      })();
    }

    async function renderNotebook(s) {
      const deck = await ctx.call('get-notebook', { id: route.id });
      if (!alive || s.aborted) return;
      const bar = el('div', body, { cls: 'ln-row' });
      btn('← Back', () => go({ page: 'subject', id: route.subjectId, tab: 'notes' }), bar);
      btn('Export notes PDF', () => exportPdf(deck.id), bar);
      btn('Delete notebook', async () => {
        if (!confirm(`Delete "${deck.title}" with its notes, flashcards and stored slide images? This cannot be undone.`)) return;
        await ctx.call('delete-notebook', { id: deck.id }); await refresh(); go({ page: 'subject', id: route.subjectId, tab: 'notes' });
      }, bar, 'danger');
      el('h1', body, { text: deck.title });
      const host = el('div', body);
      const images = await ctx.call('slide-images', { id: deck.id, slides: figureSlides(deck) }).catch(() => ({}));
      if (!alive || s.aborted) return;
      tabs(body.insertBefore(el('div', null), host), [['notes', 'Notes'], ['cards', 'Flashcards'], ['activity', 'Activity']], (tab) => {
        if (tab === 'notes') renderNotes(host, deck, { ctx, signal: s, images });
        else if (tab === 'cards') renderCards(host, deck, { ctx, signal: s });
        else renderActivity(host, deck);
      });
    }

    async function renderReview(s) {
      const bar = el('div', body, { cls: 'ln-row' });
      btn('← Done', async () => { await refresh(); go({ page: 'subject', id: route.subjectId, tab: 'cards', topics: route.topics, mode: route.mode }); }, bar);
      const status = el('p', body, { cls: 'ln-muted' });
      const stage = el('div', body, { cls: 'ln-review' });
      let queue = [], seen = 0;
      const next = async () => {
        if (!queue.length) {
          const q = await ctx.call('study-queue', { notebookIds: route.notebookIds, topics: route.topics, mode: route.mode });
          queue = q.cards.slice(0, 30);
          if (!queue.length) { stage.replaceChildren(); el('p', stage, { cls: 'ln-empty', text: seen ? `Done — ${seen} card${seen === 1 ? '' : 's'} reviewed.` : 'Nothing to study for this selection right now.' }); status.textContent = ''; return; }
          if (q.topic) status.textContent = `Topic: ${q.topic}${q.topicOrder.length > 1 ? ` · then ${q.topicOrder.slice(1).join(', ')}` : ''}`;
        }
        const card = queue.shift();
        stage.replaceChildren();
        const face = el('div', stage, { cls: 'ln-flash-card' });
        ctx.ui.mountMarkdown(el('div', face), { text: card.q }, { signal: s });
        const controls = el('div', stage, { cls: 'ln-row' });
        const rate = async (r) => { await ctx.call('rate-card', { notebookId: card.notebookId, id: card.id, rating: r }); seen++; document.removeEventListener('keydown', onKey); await next(); };
        const reveal = () => {
          controls.replaceChildren();
          el('hr', face);
          ctx.ui.mountMarkdown(el('div', face), { text: card.a }, { signal: s });
          for (const [r, label] of RATINGS) btn(`${r} · ${label}`, () => rate(r), controls, `rate-${r}`);
        };
        btn('Reveal (Space)', reveal, controls, 'primary');
        const onKey = (e) => {
          if (s.aborted) { document.removeEventListener('keydown', onKey); return; }
          if (e.target instanceof HTMLElement && /input|textarea|select/i.test(e.target.tagName)) return;
          if (e.key === ' ' && controls.querySelector('.primary')) { e.preventDefault(); reveal(); }
          else if (/^[1-4]$/.test(e.key) && !controls.querySelector('.primary')) void guarded(() => rate(Number(e.key)))();
        };
        document.addEventListener('keydown', onKey);
        s.addEventListener('abort', () => document.removeEventListener('keydown', onKey), { once: true });
      };
      await next();
    }

    const offN = ctx.onNotification((e) => { if (e.topic === 'study-changed' && route.page !== 'review') void guarded(refresh)(); });
    const offR = ctx.onResync(() => void guarded(refresh)());
    void guarded(refresh)();
    return () => { alive = false; child?.abort(); offN(); offR(); container.replaceChildren(); container.classList.remove('ln-root', 'ln-library'); };
  } });

  ctx.registerAction({ id: 'open', name: 'Subjects', run: () => ctx.app.openView('subjects') });
  ctx.placeAction({ id: 'sidebar-open', actionId: 'open', location: 'sidebar' });
}
