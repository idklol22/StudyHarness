'use strict';
// Notes Markdown -> self-contained "handwritten" HTML. Maths stays typeset (KaTeX);
// diagrams are drawn with rough.js in the page; letters get a small seeded jitter.

const katex = require('katex');
const assets = require('../.generated/assets.cjs');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Models sometimes wrap LaTeX in their own delimiters: \( x \), \[ x \] or $x$. Strip only those pairs.
function cleanTex(t) {
  let s = String(t).trim();
  for (const [open, close] of [['\\[', '\\]'], ['\\(', '\\)'], ['$$', '$$'], ['$', '$']]) {
    if (s.length > open.length + close.length && s.startsWith(open) && s.endsWith(close)) { s = s.slice(open.length, s.length - close.length).trim(); break; }
  }
  return s;
}
function math(tex, display) {
  tex = cleanTex(tex);
  try { return katex.renderToString(tex, { displayMode: display, throwOnError: true, output: 'html', strict: 'ignore' }); }
  catch (e) { return `<span class="math-error" title="${esc(e.message)}">${esc(tex)}</span>`; }
}

// Inline: **bold**, $math$, [[slide N]]. Math is lifted out before escaping.
function inline(text) {
  const stash = [];
  let t = text.replace(/\$\$(.+?)\$\$/g, (_, m) => { stash.push(math(m, true)); return `\u0000${stash.length - 1}\u0000`; })
    .replace(/\$(.+?)\$/g, (_, m) => { stash.push(math(m, false)); return `\u0000${stash.length - 1}\u0000`; });
  t = esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<strong class="key">$1</strong>')
    .replace(/\[\[slide (\d+)\]\]/g, '<span class="ptr" data-slide="$1">slide $1</span>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[+i]);
}

let IMAGES = {};
// A slide screenshot, optionally cropped to [x, y, w, h] (0-1 fractions), drawn from the stored page image.
function figure(f) {
  const n = +f.slide, img = IMAGES[n];
  if (!img) return '<p class="margin-note">(screenshot of slide ' + esc(f.slide) + ' is not available: upload the PDF again to store slide images)</p>';
  let [x, y, w, h] = [0, 0, 1, 1];
  if (f.crop) { const c = f.crop.split(',').map(Number); if (c.length === 4 && c.every(Number.isFinite)) [x, y, w, h] = c; }
  w = Math.min(Math.max(w, .02), 1 - Math.max(x, 0)); h = Math.min(Math.max(h, .02), 1 - Math.max(y, 0)); x = Math.max(x, 0); y = Math.max(y, 0);
  const ratio = (w * img.w) / (h * img.h), width = f.crop ? Math.min(100, Math.max(40, w * 100)) : 78;
  const cap = f.caption ? '<figcaption>' + inline(f.caption) + ' <span class="ptr" data-slide="' + n + '">slide ' + n + '</span></figcaption>' : '<figcaption><span class="ptr" data-slide="' + n + '">slide ' + n + '</span></figcaption>';
  return '<figure class="shot" style="width:' + width + '%"><div class="frame" style="aspect-ratio:' + ratio.toFixed(4) + '"><img alt="slide ' + n + '" src="' + img.src + '" style="width:' + (100 / w).toFixed(3) + '%;left:' + (-x / w * 100).toFixed(3) + '%;top:' + (-y / h * 100).toFixed(3) + '%"></div>' + cap + '</figure>';
}

const BADGE = /\s*\{(new|shaky|ok|solid)\}/;

function render(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out = []; let i = 0, listKind = null;
  const closeList = () => { if (listKind) { out.push(`</${listKind}>`); listKind = null; } };
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if ((m = line.match(/^:::(revisit|mistake|technique|qa|discussion|crucial|exam|pitfall|tip)\s*$/))) {
      closeList();
      const body = []; i++;
      while (i < lines.length && lines[i].trim() !== ':::') body.push(lines[i++]);
      i++;
      const label = { revisit: 'revisit ↩', mistake: 'my mistake', technique: 'technique', qa: 'cold Q&A', discussion: 'from our chat', crucial: 'crucial ★', exam: 'likely exam ✎', pitfall: 'common mistake !', tip: 'tip' }[m[1]];
      out.push(`<aside class="box ${m[1]}"><span class="tag">${label}</span>${render(body.join('\n'))}</aside>`);
      continue;
    }
    if ((m = line.match(/^~~~figure\s*$/))) {
      closeList();
      const f = {}; i++;
      while (i < lines.length && lines[i].trim() !== '~~~') { const x = lines[i++].match(/^(slide|crop|caption):\s*(.+)$/); if (x) f[x[1]] = x[2].trim(); }
      i++;
      out.push(figure(f));
      continue;
    }
    if ((m = line.match(/^~~~(mindmap|graph)\s*$/))) {
      const kind = m[1];
      closeList();
      const map = { root: '', tree: [], cross: [], status: {} }; i++;
      while (i < lines.length && lines[i].trim() !== '~~~') {
        const l = lines[i++].trim(); let x;
        if ((x = l.match(/^root:\s*(.+)$/))) map.root = x[1].trim();
        else if ((x = l.match(/^@(.+)\s+(new|shaky|ok|solid)$/))) map.status[x[1].trim()] = x[2];
        else if (l.includes(' ~> ')) { const [a, b] = l.split(' ~> '); map.cross.push([a.trim(), b.trim()]); }
        else if (l.includes(' > ')) { const [a, b] = l.split(' > '); map.tree.push([a.trim(), b.trim()]); }
      }
      i++;
      out.push(`<svg class="${kind === 'graph' ? 'graph2d' : 'mindmap'}" data-map="${esc(JSON.stringify(map))}" xmlns="http://www.w3.org/2000/svg"></svg>`);
      continue;
    }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      closeList();
      const level = m[1].length; let title = m[2]; let status = null;
      const b = title.match(BADGE); if (b) { status = b[1]; title = title.replace(BADGE, ''); }
      out.push(`<h${level}${status ? ` class="s-${status}"` : ''}>${inline(title)}${status ? `<span class="badge ${status}">${status}</span>` : ''}</h${level}>`);
      i++; continue;
    }
    if ((m = line.match(/^(\s*)(-|\d+\.)\s+(.*)$/))) {
      const kind = m[2] === '-' ? 'ul' : 'ol';
      if (listKind !== kind) { closeList(); out.push(`<${kind}>`); listKind = kind; }
      let item = inline(m[3]); i++;
      while (i < lines.length && /^\s+>\s/.test(lines[i])) { item += `<span class="margin-note">${inline(lines[i].replace(/^\s+>\s*/, ''))}</span>`; i++; }
      out.push(`<li>${item}</li>`);
      continue;
    }
    if ((m = line.match(/^>\s?(.*)$/))) { closeList(); out.push(`<p class="margin-note">${inline(m[1])}</p>`); i++; continue; }
    if (!line.trim()) { closeList(); i++; continue; }
    closeList(); out.push(`<p>${inline(line)}</p>`); i++;
  }
  closeList();
  return out.join('\n');
}

const css = `
@font-face{font-family:"Hand";src:url(${assets.fontRegular}) format("truetype");font-weight:400}
@font-face{font-family:"Hand";src:url(${assets.fontBold}) format("truetype");font-weight:700}
${assets.katexCss}
@page{size:A4;margin:0}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html{background:#fdfbf4}
body{margin:0;padding:18mm 16mm 18mm 26mm;font-family:"Hand",cursive;font-size:16px;line-height:1.7;color:#1f2a44;
 background-color:#fdfbf4;background-image:radial-gradient(#c9c3b0 1px,transparent 1.4px);background-size:8mm 8mm;position:relative}
body::before{content:"";position:fixed;left:19mm;top:0;bottom:0;width:1.5px;background:#e58f8f;opacity:.7}
h1,h2,h3{font-weight:700;margin:.9em 0 .3em;line-height:1.15;position:relative}
h1{font-size:2.3em;color:#7a2e8e;border-bottom:3px solid #7a2e8e;display:inline-block;transform:rotate(-1deg)}
h2{font-size:1.6em;color:#1c6b8a;border-bottom:3px dotted #1c6b8a88;display:inline-block;break-after:avoid}
h3{font-size:1.25em;color:#9a4a12;break-after:avoid}
h3.s-shaky,h3.s-shaky~*{}
p,li{margin:.25em 0}
ul,ol{padding-left:1.4em;margin:.3em 0}
li{padding:.15em 0}
li .katex-display{margin:.2em 0;text-align:left}
.katex{font-size:1.05em}
.katex-display>.katex{text-align:left}
.key{background:linear-gradient(transparent 55%,#ffe56655 55%);box-shadow:0 0 0 1.5px #b88f00 inset;border-radius:4px 7px 5px 6px;padding:0 .25em}
.ptr{color:#c0392b;font-size:.8em;border-bottom:2px dashed #c0392b;white-space:nowrap}
.ptr::before{content:"→ "}
.margin-note{display:block;color:#5f6b86;font-size:.85em;margin-left:1em}
li .margin-note::before,p.margin-note::before{content:"↳ "}
.badge{font-size:.5em;margin-left:.7em;padding:.05em .6em;border-radius:1em;vertical-align:middle;border:2px solid;transform:rotate(-3deg);display:inline-block}
.badge.new{color:#6b7280}.badge.shaky{color:#c0392b;background:#fff0ee}.badge.ok{color:#a16207;background:#fff8dc}.badge.solid{color:#15803d;background:#ecfdf3}
.box{position:relative;margin:.8em 0;padding:.6em .9em .5em;border:2.5px solid;border-radius:14px 6px 16px 8px/8px 14px 6px 16px;break-inside:avoid}
.box .tag{position:absolute;top:-.8em;left:.8em;background:#fdfbf4;padding:0 .5em;font-size:.8em;font-weight:700}
.box.revisit{background:#fff3a8;border-color:#e0a800;box-shadow:5px 5px 0 #e0a80044}
.box.revisit .tag{color:#b45309;background:#fff3a8}
.box.mistake{background:#ffeceb;border-color:#d9534f}.box.mistake .tag{color:#b02a26;background:#ffeceb}
.box.technique{background:#e9f6ee;border-color:#2e9d5b}.box.technique .tag{color:#1e7a43;background:#e9f6ee}
.box.discussion{background:#f3ecff;border-color:#8b5cf6}.box.discussion .tag{color:#6d3fd1;background:#f3ecff}
.box.qa{background:#eaf1fb;border-color:#3b73c0;border-style:dashed}.box.qa .tag{color:#2b5a9a;background:#eaf1fb}
h3.s-shaky{background:linear-gradient(transparent 60%,#ffe14d88 60%);display:inline-block;padding-right:.4em}
.shot{margin:.8em auto;break-inside:avoid;transform:rotate(-.4deg)}
.shot .frame{position:relative;overflow:hidden;border:2.5px solid #1f2a44;border-radius:6px 10px 7px 9px;box-shadow:4px 4px 0 #1f2a4422;background:#fff}
.shot img{position:absolute;display:block;max-width:none}
.shot figcaption{font-size:.8em;color:#5f6b86;margin-top:.2em}
.box.crucial{background:#f3e8ff;border-color:#9333ea}.box.crucial .tag{color:#7e22ce;background:#f3e8ff}
.box.exam{background:#fee2e2;border-color:#dc2626;box-shadow:5px 5px 0 #dc262633}.box.exam .tag{color:#b91c1c;background:#fee2e2}
.box.pitfall{background:#ffedd5;border-color:#ea580c}.box.pitfall .tag{color:#c2410c;background:#ffedd5}
.box.tip{background:#dcfce7;border-color:#16a34a}.box.tip .tag{color:#15803d;background:#dcfce7}
.graph2d{display:block;margin:.6em auto;width:100%;height:auto;break-inside:avoid}
.graph2d text{font-family:"Hand",cursive;fill:#1f2a44;paint-order:stroke;stroke:#fdfbf4;stroke-width:3.5px;stroke-linejoin:round}
.mindmap{display:block;margin:.6em auto;max-width:100%;height:auto;break-inside:avoid}
.mindmap text{font-family:"Hand",cursive;font-size:15px;fill:#1f2a44}
.map-big{break-before:page;break-after:page}
.math-error{color:#b00;border-bottom:1px dotted #b00}
.w{display:inline-block;white-space:nowrap}
.j{display:inline-block}
`;

function script() { return assets.roughSource + '\n' + require('./page-script.cjs'); }

function buildHtml(markdown, { title = 'Living notes', images = {} } = {}) {
  IMAGES = images;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${render(markdown)}<script>${script()}</script></body></html>`;
}

module.exports = { render, buildHtml, inline };
