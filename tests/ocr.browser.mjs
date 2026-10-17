import { browserExecutable } from './browser-runtime.mjs';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || browserExecutable,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Optional local copy avoids depending on CDN availability during verification; never mocks recognition.
  if (process.env.OCR_TEST_MODEL)
    await page.route('https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/**', (r) =>
      r.fulfill({
        path: process.env.OCR_TEST_MODEL,
        headers: { 'access-control-allow-origin': '*' },
        contentType: 'application/gzip',
      }),
    );
  await page.goto(process.env.OCR_TEST_URL || 'http://127.0.0.1:5184/?demo=1', {
    waitUntil: 'networkidle',
  });
  const result = await page.evaluate(async () => {
    const { recognizePage } = await import('/src/ocr.ts');
    const pdf = {
      getPage: async () => ({
        getViewport: ({ scale }) => ({ width: 800 * scale, height: 240 * scale }),
        render: ({ canvas }) => {
          const c = canvas.getContext('2d');
          c.fillStyle = 'white';
          c.fillRect(0, 0, canvas.width, canvas.height);
          c.fillStyle = 'black';
          c.font = 'bold 100px Arial';
          c.fillText('STUDYHUB', 80, 180);
          return { promise: Promise.resolve(), cancel() {} };
        },
      }),
    };
    const text = await recognizePage(pdf, 1, 'eng', new AbortController().signal, () => {});
    const controller = new AbortController();
    controller.abort();
    let cancelled = false;
    try {
      await recognizePage(pdf, 1, 'eng', controller.signal, () => {});
    } catch (e) {
      cancelled = e.name === 'AbortError';
    }
    return { text, cancelled };
  });
  assert.match(result.text, /STUDYHUB/i);
  assert.equal(result.cancelled, true);
  assert.deepEqual(errors, []);
  console.log(
    'PASS real browser OCR engine recognizes rasterized text; cancellation; no page errors',
  );
} finally {
  await browser.close();
}
