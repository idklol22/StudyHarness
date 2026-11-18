'use strict';
// Stored slide images (one JPEG or PNG per page) so notes can embed screenshots of the original slides.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ID } = require('./store.cjs');

function createPages(root) {
  const dir = (deckId) => { if (!ID.test(deckId)) throw new Error('Invalid deck id.'); return path.join(root, deckId); };
  const indexFile = (deckId) => path.join(dir(deckId), 'index.json');
  const readIndex = (deckId) => { try { return JSON.parse(fs.readFileSync(indexFile(deckId), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; } };
  const atomic = (file, data) => { const tmp = `${file}.${randomUUID()}.tmp`; fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); };
  return {
    save(deckId, n, { image, w, h }) {
      if (!Number.isInteger(n) || n < 1) throw new Error('Bad slide number.');
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 10000 || h > 10000) throw new Error(`Slide ${n} needs integer image dimensions.`);
      const bytes = Buffer.from(String(image), 'base64');
      const jpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8, png = bytes.length >= 4 && bytes.readUInt32BE(0) === 0x89504e47;
      if (bytes.length < 100 || (!jpeg && !png)) throw new Error(`Slide ${n} image is not a JPEG or PNG.`);
      const ext = png ? 'png' : 'jpg';
      fs.mkdirSync(dir(deckId), { recursive: true });
      atomic(path.join(dir(deckId), `${n}.${ext}`), bytes);
      const index = readIndex(deckId); index[n] = { w, h, ext }; atomic(indexFile(deckId), JSON.stringify(index));
    },
    has: (deckId, n) => { const e = readIndex(deckId)[n]; return !!e && fs.existsSync(path.join(dir(deckId), `${n}.${e.ext ?? 'jpg'}`)); },
    // {n: {src: dataUrl, w, h}} for the requested slides that exist
    images(deckId, slides) {
      const index = readIndex(deckId), out = {};
      for (const n of new Set(slides)) {
        const ext = index[n]?.ext ?? 'jpg', file = path.join(dir(deckId), `${n}.${ext}`);
        if (index[n] && fs.existsSync(file)) out[n] = { src: `data:image/${ext === 'png' ? 'png' : 'jpeg'};base64,${fs.readFileSync(file).toString('base64')}`, w: index[n].w, h: index[n].h };
      }
      return out;
    },
    remove(deckId) { fs.rmSync(dir(deckId), { recursive: true, force: true }); },
  };
}

module.exports = { createPages };
