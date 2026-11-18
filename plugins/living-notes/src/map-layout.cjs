'use strict';
// The 2D "map of ideas" for a notebook (owner, 2026-11-18: "I love the map of ideas, but in the notes
// it must be 2D, so it maps directly onto the PDF"). One deterministic radial layout, shared by the
// in-app notes (canvas) and the exported PDF (rough.js SVG):
//   notebook title at the centre → topics on an inner ring, each owning an arc sized by its concepts →
//   concepts on an outer ring inside their topic's arc (alternating two radii so labels breathe), plus
//   at most one cross-link per concept.
// radialMap is self-contained (no requires, no closures) so the PDF page can embed it as source.
function radialMap(title, concepts) {
  const sorted = concepts.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const topics = [];
  for (const c of sorted) if (!topics.includes(c.topic)) topics.push(c.topic);
  const nodes = [{ id: '__root__', label: title, kind: 'root', x: 0, y: 0 }];
  const edges = [];
  const total = Math.max(1, sorted.length);
  const R1 = 1, R2 = 2.05, R2b = 2.55;
  let angle = -Math.PI / 2;
  for (const t of topics) {
    const members = sorted.filter((c) => c.topic === t);
    const arc = (2 * Math.PI * members.length) / total;
    const mid = angle + arc / 2;
    const tid = '__topic__' + t;
    nodes.push({ id: tid, label: t, kind: 'topic', x: Math.cos(mid) * R1, y: Math.sin(mid) * R1 });
    edges.push({ a: '__root__', b: tid, kind: 'tree' });
    members.forEach((c, i) => {
      const a = members.length === 1 ? mid : angle + (arc * (i + 0.5)) / members.length;
      const r = members.length > 3 && i % 2 ? R2b : R2;
      nodes.push({ id: c.id, label: c.title, kind: 'concept', status: c.status, x: Math.cos(a) * r, y: Math.sin(a) * r, topic: t });
      edges.push({ a: tid, b: c.id, kind: 'tree' });
    });
    angle += arc;
  }
  const ids = new Set(sorted.map((c) => c.id));
  for (const c of sorted) {
    const l = (c.links || []).find((x) => ids.has(x) && x !== c.id);
    if (l) edges.push({ a: c.id, b: l, kind: 'cross' });
  }
  return { nodes, edges };
}

module.exports = { radialMap, radialMapSource: radialMap.toString() };
