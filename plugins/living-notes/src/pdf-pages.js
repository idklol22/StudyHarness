// Render PDF slides in the browser: one JPEG + the extractable text per page.
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import * as worker from 'pdfjs-dist/build/pdf.worker.mjs';

globalThis.pdfjsWorker ??= { WorkerMessageHandler: worker.WorkerMessageHandler };

export const MAX_PAGES = 200;

export async function openPdf(file) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  if (doc.numPages > MAX_PAGES) throw new Error(`This PDF has ${doc.numPages} slides; the limit is ${MAX_PAGES}.`);
  return doc;
}

export async function renderPage(doc, n, { width = 1200, quality = 0.78 } = {}) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  const content = await page.getTextContent();
  const text = content.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
  const image = canvas.toDataURL('image/jpeg', quality).split(',')[1];
  page.cleanup();
  return { n, text, image, w: canvas.width, h: canvas.height };
}
