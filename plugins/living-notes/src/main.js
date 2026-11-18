import { openPdf, renderPage } from './pdf-pages.js';
import { mountGraph } from './graph-view.js';

const STATUS_LABEL = { new: 'not started', shaky: 'shaky', ok: 'ok', solid: 'solid' };
const BATCH = 4;

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export function activate(ctx) {
  ctx.registerView({ id: 'notes', name: 'Living Notes', mount(container, signal) {
    let alive = !signal.aborted, deckId = null, catalog = null, pendingKey = '', graph = null;
    signal.addEventListener('abort', () => { alive = false; }, { once: true });
    container.classList.add('ln-root');
    const el = (tag, text, parent = container, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; parent.append(n); return n; };
    const error = el('p', '', container, 'ln-error'); error.setAttribute('role', 'alert');
    const guarded = (fn) => async (...a) => { error.textContent = ''; try { await fn(...a); } catch (e) { if (alive) error.textContent = e instanceof Error ? e.message : String(e); } };
    const btn = (label, onClick, parent, cls = '') => { const b = el('button', label, parent, 'ln-btn ' + cls); b.type = 'button'; b.onclick = () => void guarded(onClick)(); return b; };
    const md = (parent, text) => ctx.ui.mountMarkdown(parent, { text }, { signal });

    el('h1', 'Living Notes', container);
    el('p', 'Upload a slide PDF. You are taught by being questioned, your answers update the notes, and the notes export as a handwritten-style PDF. Model calls use your configured models and may incur cost.', container, 'ln-muted');
    const body = el('div', undefined, container);

    const models = () => { const s = catalog?.slots ?? {}; return { vision: s.vision?.model ?? s.strong?.model, strong: s.strong?.model }; };

    async function home() {
      deckId = null; body.replaceChildren();
      const decks = await ctx.call('list-decks');
      if (!alive) return;
      const bar = el('div', undefined, body, 'ln-row');
      const file = el('input', undefined, bar); file.type = 'file'; file.accept = '.pdf,application/pdf'; file.hidden = true;
      btn('Upload slides (PDF)', () => file.click(), bar, 'primary');
      const state = el('input', undefined, bar); state.type = 'file'; state.accept = '.json,application/json'; state.hidden = true;
      btn('Open state file', () => state.click(), bar);
      file.onchange = () => { const f = file.files[0]; file.value = ''; if (f) void guarded(() => ingest(f))(); };
      state.onchange = () => { const f = state.files[0]; state.value = ''; if (f) void guarded(async () => { const parsed = JSON.parse(await f.text()); await ctx.call('import-deck', { deck: parsed }); await home(); })(); };
      if (!decks.length) el('p', 'No decks yet.', body, 'ln-muted');
      for (const d of decks) {
        const row = el('div', undefined, body, 'ln-deck');
        el('strong', d.title, row);
        el('span', `${d.counts.solid} solid · ${d.counts.ok} ok · ${d.counts.shaky} shaky · ${d.counts.new} new`, row, 'ln-muted');
        btn('Open', () => openDeck(d.id), row);
      }
    }

    async function ingest(file) {
      if (!catalog) catalog = await ctx.call('get-catalog');
      const model = models().vision;
      if (!model) throw new Error('Configure a vision-capable model in Settings first.');
      body.replaceChildren();
      const status = el('p', 'Opening PDF…', body);
      const doc = await openPdf(file);
      const deck = await ctx.call('create-deck', { title: file.name.replace(/\.pdf$/i, ''), pageCount: doc.numPages });
      for (let start = 1; start <= doc.numPages && alive; start += BATCH) {
        const pages = [];
        for (let n = start; n < start + BATCH && n <= doc.numPages; n++) { status.textContent = `Rendering slide ${n} of ${doc.numPages}…`; pages.push(await renderPage(doc, n)); }
        status.textContent = `Reading slides ${pages[0].n}–${pages.at(-1).n} with the vision model…`;
        await ctx.call('ingest-batch', { id: deck.id, pages, model });
      }
      status.textContent = 'Building the concept list…';
      await ctx.call('ingest-finish', { id: deck.id });
      await openDeck(deck.id);
    }

    async function openDeck(id) {
      graph?.dispose(); graph = null; deckId = id; pendingKey = ''; body.replaceChildren();
      const deck = await ctx.call('get-deck', { id });
      if (!alive) return;
      el('h2', deck.title, body);
      const bar = el('div', undefined, body, 'ln-row');
      btn('← All decks', home, bar);
      btn('Start session', startSession, bar, 'primary');
      btn('Export notes PDF', exportPdf, bar);
      btn('Download state file', async () => download(`${deck.title}.state.json`, new Blob([JSON.stringify(await ctx.call('get-deck', { id }), null, 2)], { type: 'application/json' })), bar);
      const exam = el('input', undefined, bar); exam.type = 'date'; exam.value = deck.examDate?.slice(0, 10) ?? ''; exam.title = 'Exam date';
      exam.onchange = () => void guarded(() => ctx.call('set-exam-date', { id, examDate: exam.value || null }))();
      const mapBtn = btn('3D map', () => {
        if (graph) { graph.dispose(); graph = null; mapHost.hidden = true; return; }
        mapHost.hidden = false;
        graph = mountGraph(mapHost, { title: deck.title, concepts: deck.concepts, onSelect: (name) => { const row = [...body.querySelectorAll('.ln-concept')].find(r => r.dataset.title === name); row?.scrollIntoView({ behavior: 'smooth', block: 'center' }); row?.classList.add('ln-flash'); setTimeout(() => row?.classList.remove('ln-flash'), 1600); } }, signal);
      }, bar);
      mapBtn.title = 'Drag to rotate, scroll to zoom, hover to highlight, click a concept to jump to it, double-click to reset';
      const mapHost = el('div', undefined, body, 'ln-map'); mapHost.hidden = true;
      const syncRow = el('div', undefined, body, 'ln-sync'); syncRow.dataset.deck = id; syncRow.setAttribute('role', 'status'); syncRow.setAttribute('aria-live', 'polite');
      syncRow.hidden = true;
      void refreshSync();
      el('div', undefined, body, 'ln-session');
      const list = el('div', undefined, body, 'ln-concepts');
      for (const c of deck.concepts) {
        const row = el('div', undefined, list, `ln-concept s-${c.status}`); row.dataset.title = c.title;
        el('span', STATUS_LABEL[c.status], row, 'ln-badge');
        el('strong', c.title, row);
        el('span', 'slides ' + c.slides.join(', '), row, 'ln-muted');
        if (c.nextRevisit && c.status !== 'new') el('span', 'revisit ' + c.nextRevisit.slice(0, 10), row, 'ln-muted');
        // Slide screenshots that go into the notes PDF.
        const shots = el('span', undefined, row, 'ln-shots');
        for (const f of c.figures ?? []) {
          const chip = el('span', 'slide ' + f.slide + (f.crop ? ' (crop)' : ''), shots, 'ln-chip');
          const x = el('button', '×', chip, 'ln-chip-x'); x.type = 'button'; x.title = 'Remove this screenshot from the notes'; x.setAttribute('aria-label', 'Remove screenshot of slide ' + f.slide);
          x.onclick = () => void guarded(async () => { await ctx.call('remove-figure', { id, concept_id: c.id, slide: f.slide }); await openDeck(id); })();
        }
        const form = el('span', undefined, row, 'ln-shot-form'); form.hidden = true;
        const sel = el('select', undefined, form); sel.setAttribute('aria-label', 'Slide to screenshot');
        for (const n of c.slides) { const o = el('option', 'slide ' + n, sel); o.value = String(n); }
        const cap = el('input', undefined, form); cap.placeholder = 'caption (optional)'; cap.setAttribute('aria-label', 'Caption');
        btn('Add', async () => { await ctx.call('add-figure', { id, concept_id: c.id, slide: Number(sel.value), caption: cap.value }); await openDeck(id); }, form);
        btn('📷 Add slide screenshot', () => { form.hidden = !form.hidden; }, row);
      }
      await refreshSession();
    }

    async function startSession() {
      if (!catalog) catalog = await ctx.call('get-catalog');
      const model = models().strong;
      if (!model) throw new Error('Configure a model in Settings first.');
      await ctx.call('start-session', { deckId, model });
      await openDeck(deckId);
    }

    async function exportPdf() {
      const out = await ctx.call('export-pdf', { id: deckId });
      download(out.name, new Blob([Uint8Array.from(atob(out.base64), c => c.charCodeAt(0))], { type: 'application/pdf' }));
    }

    async function refreshSession() {
      const host = body.querySelector('.ln-session');
      if (!host || !alive) return;
      const s = await ctx.call('session-get');
      if (!alive || !s || s.session.deckId !== deckId) { host.replaceChildren(); return; }
      const a = s.agent, key = a.status + JSON.stringify(a.pending.map(p => p.toolCallId));
      if (key === pendingKey) return;
      pendingKey = key; host.replaceChildren();
      el('p', a.status === 'running' ? 'Tutor is thinking…' : a.pending.length ? 'Your turn' : 'Session ' + a.status, host, 'ln-muted');
      const answer = (call, text) => async () => { await ctx.call('answer', { toolCallId: call.toolCallId, answer: text(), requestId: crypto.randomUUID() }); await refreshSession(); };
      for (const call of a.pending) {
        const card = el('div', undefined, host, 'ln-question');
        if (call.input?.teach) md(el('div', undefined, card, 'ln-teach'), call.input.teach);
        md(el('div', undefined, card, 'ln-q'), call.input?.question ?? '');
        el('p', `${call.input?.mode ?? ''} · slides ${(call.input?.slides ?? []).join(', ')}`, card, 'ln-muted');
        const box = el('textarea', undefined, card); box.rows = 4; box.setAttribute('aria-label', 'Your answer');
        box.placeholder = call.input?.mode === 'step' ? 'Write the next step yourself…' : call.input?.mode === 'predict' ? 'Predict first, then say why…' : 'Answer in your own words…';
        const row = el('div', undefined, card, 'ln-row');
        btn('Submit', async () => { if (box.value.trim()) await answer(call, () => box.value)(); }, row, 'primary');
        btn('I need a hint', answer(call, () => 'I need a hint.'), row);
      }
      if (a.status !== 'running') {
        const chat = el('div', undefined, host, 'ln-chat');
        const say = el('textarea', undefined, chat); say.rows = 2; say.setAttribute('aria-label', 'Talk to the tutor');
        say.placeholder = 'Ask a question, push back, or say it your way. Useful points go into your notes.';
        const row = el('div', undefined, chat, 'ln-row');
        btn('Send', async () => { const text = say.value.trim(); if (!text) return; say.value = ''; await ctx.call('send', { text, requestId: crypto.randomUUID() }); await refreshSession(); }, row);
      }
      const last = [...a.messages].reverse().find(m => m.role === 'assistant');
      const text = last && (typeof last.content === 'string' ? last.content : last.content.filter(p => p.type === 'text').map(p => p.text).join('\n'));
      if (text?.trim()) md(el('div', undefined, host, 'ln-feedback'), text);
    }

    // Knowledge-graph sync: what you learn here is added to the Knowledge graph automatically.
    function renderSync(s) {
      const row = body.querySelector('.ln-sync'); if (!row || !s) return;
      row.hidden = s.state === 'unsupported'; if (row.hidden) return;
      row.replaceChildren(); row.dataset.state = s.state;
      const when = s.lastAt ? new Date(s.lastAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
      const msg = s.state === 'running' ? 'Adding what you learned to the Knowledge graph…'
        : s.state === 'failed' ? 'Could not update the Knowledge graph: ' + (s.error || 'unknown error')
        : s.state === 'pending' || s.pending ? (s.pending === 1 ? '1 concept' : s.pending + ' concepts') + ' will be added to the Knowledge graph shortly.'
        : when ? 'Knowledge graph is up to date (last update ' + when + ').' : 'Concepts you study here are added to the Knowledge graph automatically.';
      el('span', msg, row, 'ln-sync-msg');
      const b = el('button', s.state === 'failed' ? 'Try again' : 'Update graph now', row, 'ln-btn'); b.type = 'button';
      b.disabled = s.state === 'running' || (!s.pending && s.state !== 'failed');
      b.onclick = () => void guarded(async () => { b.disabled = true; renderSync(await ctx.call('graph-sync-now', { id: deckId })); })();
    }
    async function refreshSync() { if (deckId) renderSync(await ctx.call('graph-sync-status', { id: deckId })); }
    function updateStatuses(deck) {
      const rows = body.querySelectorAll('.ln-concept');
      if (rows.length !== deck.concepts.length) return;
      deck.concepts.forEach((c, i) => { rows[i].className = `ln-concept s-${c.status}`; rows[i].querySelector('.ln-badge').textContent = STATUS_LABEL[c.status]; });
    }
    const offN = ctx.onNotification((e) => {
      if (e.topic === 'agents-changed' && deckId) void guarded(async () => { await refreshSession(); updateStatuses(await ctx.call('get-deck', { id: deckId })); })();
      if (e.topic === 'graph-sync' && deckId && e.data?.deckId === deckId) renderSync(e.data);
    });
    const offR = ctx.onResync(() => void guarded(() => (deckId ? openDeck(deckId) : home()))());
    void guarded(home)();
    return () => { alive = false; offN(); offR(); container.replaceChildren(); container.classList.remove('ln-root'); };
  } });
  ctx.registerAction({ id: 'open', name: 'Living Notes', run: () => ctx.app.openView('notes') });
  ctx.placeAction({ id: 'sidebar-open', actionId: 'open', location: 'sidebar' });
}
