'use strict';
// Print HTML to PDF with a system Chromium-family browser (Chrome, Edge, Chromium).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

function candidates(env = process.env) {
  const win = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).flatMap(base => [
    path.join(base, 'Google/Chrome/Application/chrome.exe'), path.join(base, 'Microsoft/Edge/Application/msedge.exe'), path.join(base, 'Chromium/Application/chrome.exe')]);
  return [env.LIVING_NOTES_BROWSER, ...win,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'].filter(Boolean);
}
function findBrowser(exists = fs.existsSync, env = process.env) {
  const found = candidates(env).find(p => exists(p));
  if (!found) throw new Error('No Chrome, Edge or Chromium found. Install one, or set LIVING_NOTES_BROWSER to its executable.');
  return found;
}

async function htmlToPdf(html, outFile, { browser = findBrowser(), signal, timeoutMs = 60000 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'living-notes-'));
  const page = path.join(dir, 'notes.html');
  fs.writeFileSync(page, html);
  const args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer', `--user-data-dir=${path.join(dir, 'profile')}`,
    '--virtual-time-budget=8000', `--print-to-pdf=${outFile}`, pathToFileURL(page).href];
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(browser, args, { stdio: 'ignore', windowsHide: true, signal });
      const timer = setTimeout(() => { child.kill(); reject(new Error('PDF rendering timed out.')); }, timeoutMs);
      child.on('error', e => { clearTimeout(timer); reject(e); });
      child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Browser exited with code ${code}.`)); });
    });
    if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 500) throw new Error('The browser produced no PDF.');
    return outFile;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = { findBrowser, htmlToPdf, candidates };
