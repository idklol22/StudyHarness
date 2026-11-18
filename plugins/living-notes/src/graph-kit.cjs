'use strict';
// 3D force-directed graph kit, shared by the PDF page (embedded as source) and the app's
// interactive map. graphKit() is fully self-contained so it can be stringified into the notes page.
function graphKit() {
  const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  // nodes: [{id, group, kind: 'root'|'topic'|'leaf'}]; edges: [{a, b, kind: 'tree'|'cross'}]
  // Returns {id: [x,y,z]} roughly inside the unit sphere. Deterministic for a seed.
  function layout(nodes, edges, { seed = 1, iterations = 520 } = {}) {
    const rnd = mulberry(seed), n = nodes.length, idx = new Map(nodes.map((d, i) => [d.id, i]));
    const groups = [...new Set(nodes.map(d => d.group))];
    const P = nodes.map((d, i) => {
      if (d.kind === 'root') return [0, 0, 0];
      const g = groups.indexOf(d.group), t = (g + .5) / groups.length;
      const phi = Math.acos(1 - 2 * t), theta = Math.PI * (1 + Math.sqrt(5)) * g;
      const r = d.kind === 'topic' ? 1.1 : 1.1 + .5 * rnd();
      return [r * Math.sin(phi) * Math.cos(theta) + (rnd() - .5) * .5, r * Math.cos(phi) + (rnd() - .5) * .5, r * Math.sin(phi) * Math.sin(theta) + (rnd() - .5) * .5];
    });
    const V = P.map(() => [0, 0, 0]);
    const links = edges.filter(e => idx.has(e.a) && idx.has(e.b)).map(e => ({ i: idx.get(e.a), j: idx.get(e.b), L: e.kind === 'cross' ? 1.5 : (nodes[idx.get(e.a)].kind === 'root' ? 1.3 : .8), k: e.kind === 'cross' ? .015 : .09 }));
    for (let it = 0; it < iterations; it++) {
      const cool = 1 - it / iterations, F = P.map(() => [0, 0, 0]);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1], dz = P[i][2] - P[j][2];
        const d2 = dx * dx + dy * dy + dz * dz + .01, f = .16 / d2, d = Math.sqrt(d2);
        for (const [a, s] of [[i, 1], [j, -1]]) { F[a][0] += s * f * dx / d; F[a][1] += s * f * dy / d; F[a][2] += s * f * dz / d; }
      }
      for (const l of links) {
        const dx = P[l.j][0] - P[l.i][0], dy = P[l.j][1] - P[l.i][1], dz = P[l.j][2] - P[l.i][2], d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6, f = l.k * (d - l.L);
        F[l.i][0] += f * dx / d; F[l.i][1] += f * dy / d; F[l.i][2] += f * dz / d; F[l.j][0] -= f * dx / d; F[l.j][1] -= f * dy / d; F[l.j][2] -= f * dz / d;
      }
      // Radial shells keep the centre clear: topics sit near 1.3, concepts near 2.0 (raw units).
      for (let i = 0; i < n; i++) {
        const kind = nodes[i].kind; if (kind === 'root') continue;
        const r = Math.hypot(P[i][0], P[i][1], P[i][2]) + 1e-6, want = kind === 'topic' ? 1.3 : 2.0, f = .06 * (want - r) / r;
        for (let c = 0; c < 3; c++) F[i][c] += f * P[i][c];
      }
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
        F[i][c] -= .004 * P[i][c];
        V[i][c] = (V[i][c] + F[i][c]) * .78; P[i][c] += V[i][c] * (.4 + .6 * cool);
      }
    }
    // Scale by the 85th-percentile radius (so one outlier cannot squash everyone), then cap at the unit sphere.
    const radii = P.map(p => Math.hypot(p[0], p[1], p[2])).sort((a, b) => a - b);
    const R = Math.max(radii[Math.floor(radii.length * .85)] || 1, 1e-6) / .8;
    const out = {}; nodes.forEach((d, i) => { const l = Math.hypot(...P[i]) / R; const s = l > 1 ? 1 / l : 1; out[d.id] = P[i].map(v => v / R * s); }); return out;
  }

  // Rotate (yaw around Y, pitch around X) then perspective-project into a W x H box.
  function project(pos, { yaw = 0, pitch = 0, zoom = 1, W = 600, H = 600 } = {}) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch), out = {};
    const base = Math.min(W, H) * .42 * zoom;
    for (const id in pos) {
      const [x, y, z] = pos[id];
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      const y2 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
      const s = 3 / (3 - z2 * .9); // nearer = larger
      out[id] = { x: W / 2 + x1 * base * s, y: H / 2 + y2 * base * s, z: z2, s };
    }
    return out;
  }

  const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  const cross = (p1, p2, p3, p4) => ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
  // Count edge crossings, node collisions and label collisions for one projected view.
  function score(proj, edges, labelW, { nodeR = 9, labelH = 16 } = {}) {
    let s = 0; const ids = Object.keys(proj);
    const es = edges.filter(e => proj[e.a] && proj[e.b]);
    for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
      const a = es[i], b = es[j]; if (a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b) continue;
      if (cross(proj[a.a], proj[a.b], proj[b.a], proj[b.b])) s += (a.kind === 'cross' || b.kind === 'cross') ? 1 : 4;
    }
    const cxm = ids.reduce((t, id) => t + proj[id].x, 0) / ids.length;
    const box = (id) => { const p = proj[id], w = labelW[id] || 60, right = p.x >= cxm; return { x0: right ? p.x + nodeR : p.x - nodeR - w, x1: right ? p.x + nodeR + w : p.x - nodeR, y0: p.y - labelH / 2, y1: p.y + labelH / 2 }; };
    const boxes = ids.map(box);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = proj[ids[i]], b = proj[ids[j]];
      if (Math.hypot(a.x - b.x, a.y - b.y) < nodeR * 2.2) s += 6;
      const p = boxes[i], q = boxes[j];
      if (p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1) s += 5;
    }
    // Labels sitting on top of other nodes' edges read as overlap too.
    for (let i = 0; i < ids.length; i++) for (const e of es) {
      if (e.a === ids[i] || e.b === ids[i]) continue;
      const b = boxes[i], p = proj[e.a], q = proj[e.b];
      for (const t of [.25, .5, .75]) { const x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t; if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) s += 1.5; }
    }
    return s;
  }

  // Try many camera angles and keep the cleanest one.
  function bestView(pos, edges, labelW, { W = 600, H = 600 } = {}) {
    let best = null;
    for (let k = 0; k < 72; k++) for (const pitch of [-.45, -.25, 0, .25, .45]) {
      const yaw = (k / 72) * Math.PI * 2, sc = score(project(pos, { yaw, pitch, W, H }), edges, labelW);
      if (!best || sc < best.score) best = { yaw, pitch, score: sc };
    }
    return best;
  }

  // Convenience: try several layouts, keep the one whose best view scores lowest.
  function arrange(nodes, edges, labelW, { W = 600, H = 600, tries = 6 } = {}) {
    let best = null;
    for (let seed = 1; seed <= tries; seed++) {
      const pos = layout(nodes, edges, { seed }), view = bestView(pos, edges, labelW, { W, H });
      if (!best || view.score < best.view.score) best = { pos, view };
    }
    return best;
  }
  return { layout, project, score, bestView, arrange };
}

module.exports = { graphKit, kit: graphKit() };
