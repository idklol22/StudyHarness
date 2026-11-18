// Interactive 3D map of the deck: drag to rotate, wheel to zoom, hover to highlight, click to jump to a concept.
import { kit } from './graph-kit.cjs';
import { mapData } from './notes.cjs';

const COLORS = { new: ['#e5e7eb', '#6b7280'], shaky: ['#fecaca', '#b91c1c'], ok: ['#fde68a', '#a16207'], solid: ['#bbf7d0', '#15803d'] };

export function mountGraph(container, { title, concepts, onSelect }, signal) {
  const m = mapData(title, concepts);
  const topics = new Set(m.tree.filter(e => e[0] === m.root).map(e => e[1]));
  const groupOf = new Map(); for (const [p, c] of m.tree) if (topics.has(p)) groupOf.set(c, p);
  const names = [...new Set([m.root, ...m.tree.flat()])];
  const kindOf = (n) => (n === m.root ? 'root' : topics.has(n) ? 'topic' : 'leaf');
  const nodes = names.map(n => ({ id: n, kind: kindOf(n), group: kindOf(n) === 'leaf' ? (groupOf.get(n) || n) : n }));
  const edges = [...m.tree.map(([a, b]) => ({ a, b, kind: 'tree' })), ...m.cross.map(([a, b]) => ({ a, b, kind: 'cross' }))];
  const neighbours = new Map(names.map(n => [n, new Set([n])]));
  for (const e of edges) { neighbours.get(e.a)?.add(e.b); neighbours.get(e.b)?.add(e.a); }

  const canvas = document.createElement('canvas');
  canvas.className = 'ln-graph'; canvas.style.width = '100%'; canvas.style.height = '520px'; canvas.style.touchAction = 'none'; canvas.style.cursor = 'grab';
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Interactive 3D map of the concepts. Drag to rotate.');
  container.append(canvas);
  const ctx2 = canvas.getContext('2d');

  const labelW = Object.fromEntries(names.map(n => [n, n.length * 7]));
  const { pos, view } = kit.arrange(nodes, edges, labelW, { W: 700, H: 520, tries: 4 });
  const state = { yaw: view.yaw, pitch: view.pitch, zoom: 1, hover: null, auto: true, W: 700, H: 520, dpr: 1 };
  let proj = {}, raf = 0, alive = true, drag = null, moved = false;

  const size = () => {
    const r = canvas.getBoundingClientRect(); state.dpr = window.devicePixelRatio || 1;
    state.W = Math.max(300, r.width); state.H = r.height || 520;
    canvas.width = Math.round(state.W * state.dpr); canvas.height = Math.round(state.H * state.dpr);
  };

  function draw() {
    if (!alive) return;
    if (state.auto) state.yaw += .0035;
    const { W, H } = state;
    ctx2.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx2.clearRect(0, 0, W, H);
    proj = kit.project(pos, { yaw: state.yaw, pitch: state.pitch, zoom: state.zoom * 1.25, W, H });
    const text = getComputedStyle(container).color || '#222';
    const zs = names.map(n => proj[n].z), zmin = Math.min(...zs), zmax = Math.max(...zs) || 1;
    const depth = (z) => (zmax === zmin ? 1 : .25 + .75 * (z - zmin) / (zmax - zmin));
    const focus = state.hover ? neighbours.get(state.hover) : null;
    const dim = (n) => (focus && !focus.has(n) ? .18 : 1);
    ctx2.lineCap = 'round';
    for (const e of [...edges].sort((a, b) => (proj[a.a].z + proj[a.b].z) - (proj[b.a].z + proj[b.b].z))) {
      const p = proj[e.a], q = proj[e.b];
      const lit = !focus || (focus.has(e.a) && focus.has(e.b) && (e.a === state.hover || e.b === state.hover));
      ctx2.globalAlpha = (lit ? 1 : .12) * depth((p.z + q.z) / 2) * (e.kind === 'cross' ? .7 : .9);
      ctx2.strokeStyle = e.kind === 'cross' ? '#c2762c' : '#4f93b3'; ctx2.lineWidth = e.kind === 'cross' ? 1 : 1.6 * ((p.s + q.s) / 2);
      ctx2.setLineDash(e.kind === 'cross' ? [5, 4] : []);
      ctx2.beginPath(); ctx2.moveTo(p.x, p.y); ctx2.lineTo(q.x, q.y); ctx2.stroke();
    }
    ctx2.setLineDash([]);
    const order = [...names].sort((a, b) => proj[a].z - proj[b].z);
    ctx2.font = '13px system-ui, sans-serif'; ctx2.textBaseline = 'middle';
    for (const n of order) {
      const p = proj[n], k = kindOf(n), st = m.status[n];
      const [fill, stroke] = st ? COLORS[st] : (k === 'root' ? ['#e9d5ff', '#7a2e8e'] : ['#dbeafe', '#1c6b8a']);
      const r = (k === 'root' ? 13 : k === 'topic' ? 9 : 6) * p.s * (n === state.hover ? 1.3 : 1);
      ctx2.globalAlpha = depth(p.z) * dim(n);
      ctx2.fillStyle = fill; ctx2.strokeStyle = stroke; ctx2.lineWidth = 2;
      ctx2.beginPath(); ctx2.arc(p.x, p.y, r, 0, Math.PI * 2); ctx2.fill(); ctx2.stroke();
      const showLabel = k !== 'leaf' || state.zoom > 1.5 || depth(p.z) > .62 || (focus && focus.has(n));
      if (showLabel) {
        ctx2.globalAlpha = Math.min(1, .35 + depth(p.z)) * dim(n);
        ctx2.font = `${k === 'leaf' ? '' : '600 '}${(k === 'leaf' ? 12 : 13.5) * (.9 + .1 * p.s)}px system-ui, sans-serif`;
        ctx2.fillStyle = text; ctx2.fillText(n.length > 34 ? n.slice(0, 33) + '…' : n, p.x + r + 5, p.y);
      }
    }
    ctx2.globalAlpha = 1;
    raf = requestAnimationFrame(draw);
  }

  const nearest = (x, y) => {
    let best = null, bd = 16;
    for (const n of names) { const p = proj[n], d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = n; } }
    return best;
  };
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY }; moved = false; state.auto = false; canvas.style.cursor = 'grabbing'; });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      state.yaw += dx * .008; state.pitch = Math.max(-1.3, Math.min(1.3, state.pitch + dy * .008)); drag = { x: e.clientX, y: e.clientY };
    } else state.hover = nearest(...local(e));
  });
  canvas.addEventListener('pointerup', (e) => {
    canvas.releasePointerCapture(e.pointerId); canvas.style.cursor = 'grab'; drag = null;
    if (!moved) { const n = nearest(...local(e)); if (n && kindOf(n) === 'leaf') onSelect?.(n); }
  });
  canvas.addEventListener('pointerleave', () => { state.hover = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); state.auto = false; state.zoom = Math.max(.5, Math.min(3, state.zoom * (e.deltaY < 0 ? 1.1 : .91))); }, { passive: false });
  canvas.addEventListener('dblclick', () => { state.auto = true; state.zoom = 1; state.yaw = view.yaw; state.pitch = view.pitch; });
  const ro = new ResizeObserver(size); ro.observe(canvas);
  size(); raf = requestAnimationFrame(draw);
  const stop = () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); canvas.remove(); };
  signal?.addEventListener('abort', stop, { once: true });
  return { dispose: stop };
}
