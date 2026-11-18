// The in-app 2D map of ideas (owner, 2026-11-18: 2D in the notes, matching the PDF). Draws the shared
// radial layout (map-layout.cjs) on a canvas: scroll to zoom, drag to pan, hover lights a concept's
// connections, click jumps to the concept in the notes. Colours follow the page theme and concept
// status (not started / shaky / ok / solid).
import { radialMap } from './map-layout.cjs';

const STATUS = { new: '#9ca3af', shaky: '#ef4444', ok: '#f59e0b', solid: '#22c55e' };

export function mountMap2D(container, { title, concepts, onSelect, height = 320 }, signal) {
  const { nodes, edges } = radialMap(title, concepts);
  const canvas = document.createElement('canvas');
  canvas.className = 'ln-map2d';
  canvas.style.height = `${height}px`;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Map of ideas for ${title}: ${concepts.length} concepts. Click a concept to jump to it.`);
  container.append(canvas);
  const ctx = canvas.getContext('2d');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const neighbours = new Map(nodes.map((n) => [n.id, new Set([n.id])]));
  for (const e of edges) { neighbours.get(e.a)?.add(e.b); neighbours.get(e.b)?.add(e.a); }
  const view = { scale: 1, x: 0, y: 0 }, size = { w: 300, h: height, dpr: 1 };
  let hover = null, drag = null, moved = false, raf = 0;

  const fit = () => {
    const ext = Math.max(...nodes.map((n) => Math.max(Math.abs(n.x), Math.abs(n.y)))) || 1;
    view.scale = Math.min(size.w, size.h) / (2 * ext + 1.6);
    view.x = size.w / 2; view.y = size.h / 2;
  };
  const toScreen = (n) => ({ x: view.x + n.x * view.scale, y: view.y + n.y * view.scale });
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    size.w = Math.max(200, r.width); size.h = r.height || height; size.dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * size.dpr); canvas.height = Math.round(size.h * size.dpr);
    fit(); draw();
  };
  const draw = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const style = getComputedStyle(container);
      const fg = style.color || '#ddd';
      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      const focus = hover ? neighbours.get(hover) : null;
      ctx.lineCap = 'round';
      for (const e of edges) {
        const a = toScreen(byId.get(e.a)), b = toScreen(byId.get(e.b));
        const lit = focus && focus.has(e.a) && focus.has(e.b);
        ctx.globalAlpha = focus ? (lit ? 0.9 : 0.08) : e.kind === 'cross' ? 0.35 : 0.45;
        ctx.strokeStyle = e.kind === 'cross' ? '#c2762c' : fg;
        ctx.lineWidth = e.kind === 'cross' ? 1 : 1.3;
        ctx.setLineDash(e.kind === 'cross' ? [4, 4] : []);
        ctx.beginPath();
        if (e.kind === 'cross') { const mx = (a.x + b.x) / 2 + (view.x - (a.x + b.x) / 2) * 0.35, my = (a.y + b.y) / 2 + (view.y - (a.y + b.y) / 2) * 0.35; ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, b.x, b.y); }
        else { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const n of nodes) {
        const p = toScreen(n), dim = focus && !focus.has(n.id);
        const r = n.kind === 'root' ? 9 : n.kind === 'topic' ? 6.5 : 4.5;
        ctx.globalAlpha = dim ? 0.2 : 1;
        ctx.fillStyle = n.kind === 'concept' ? STATUS[n.status] ?? STATUS.new : fg;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * (n.id === hover ? 1.4 : 1), 0, Math.PI * 2); ctx.fill();
        const showLabel = n.kind !== 'concept' || view.scale > 70 || (focus && focus.has(n.id));
        if (!showLabel) continue;
        ctx.font = `${n.kind === 'concept' ? 500 : 650} ${n.kind === 'root' ? 13 : 11.5}px ${style.fontFamily || 'system-ui'}`;
        ctx.fillStyle = fg;
        ctx.textAlign = p.x < view.x - 4 ? 'right' : p.x > view.x + 4 ? 'left' : 'center';
        ctx.textBaseline = 'middle';
        const dx = ctx.textAlign === 'right' ? -r - 5 : ctx.textAlign === 'left' ? r + 5 : 0;
        const dy = ctx.textAlign === 'center' ? (p.y < view.y ? -r - 9 : r + 9) : 0;
        const label = n.label.length > 32 ? `${n.label.slice(0, 31)}…` : n.label;
        ctx.fillText(label, p.x + dx, p.y + dy);
      }
      ctx.globalAlpha = 1;
    });
  };
  const nearest = (x, y) => {
    let best = null, bd = 14;
    for (const n of nodes) { const p = toScreen(n), d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = n.id; } }
    return best;
  };
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY }; moved = false; });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      view.x += dx; view.y += dy; drag = { x: e.clientX, y: e.clientY }; draw(); return;
    }
    const h = nearest(...local(e));
    if (h !== hover) { hover = h; canvas.style.cursor = h && byId.get(h).kind === 'concept' ? 'pointer' : 'grab'; draw(); }
  });
  canvas.addEventListener('pointerup', (e) => {
    drag = null;
    if (moved) return;
    const n = nearest(...local(e));
    if (n && byId.get(n).kind === 'concept') onSelect?.(n);
  });
  canvas.addEventListener('pointerleave', () => { hover = null; draw(); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [mx, my] = local(e), k = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    view.x = mx - (mx - view.x) * k; view.y = my - (my - view.y) * k; view.scale *= k; draw();
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { fit(); draw(); });
  const ro = new ResizeObserver(resize); ro.observe(canvas);
  resize();
  const stop = () => { cancelAnimationFrame(raf); ro.disconnect(); canvas.remove(); };
  signal?.addEventListener('abort', stop, { once: true });
  return { dispose: stop };
}
