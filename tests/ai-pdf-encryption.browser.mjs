import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { browserExecutable } from './browser-runtime.mjs';
const browser = await chromium.launch({
  executablePath: browserExecutable,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.STUDY_TEST_URL || 'http://127.0.0.1:5184/?demo=1');
  const readable = await readFile(new URL('./fixtures/pdf-permissions.pdf', import.meta.url));
  const converted = await page.evaluate(async (data) => {
    const { prepareAnalysis } = await import('/src/material-analysis-input.ts');
    const { loadPdf } = await import('/src/pdf-reader.ts');
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const result = await prepareAnalysis(
      new File([bytes], 'permissions.pdf', { type: 'application/pdf' }),
      new AbortController().signal,
    );
    const task = loadPdf(Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0)));
    const pdf = await task.promise;
    const pages = pdf.numPages;
    const text = await (await pdf.getPage(1)).getOperatorList();
    await task.destroy();
    return { pages, painted: text.fnArray.length > 0, hash: result.source_hash, mime: result.mime };
  }, readable.toString('base64'));
  assert.equal(converted.pages, 1);
  assert.equal(converted.painted, true);
  assert.equal(converted.mime, 'application/pdf');
  assert.equal(converted.hash, createHash('sha256').update(readable).digest('hex'));
  const locked = await readFile(new URL('./fixtures/pdf-password.pdf', import.meta.url));
  const message = await page.evaluate(async (data) => {
    const { prepareAnalysis } = await import('/src/material-analysis-input.ts');
    try {
      await prepareAnalysis(
        new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], 'locked.pdf', {
          type: 'application/pdf',
        }),
        new AbortController().signal,
      );
      return '';
    } catch (error) {
      return error.message;
    }
  }, locked.toString('base64'));
  assert.match(message, /Для открытия PDF нужен пароль/);
  assert.doesNotMatch(message, /ignoreEncryption|PDFDocument.load/);
  assert.deepEqual(errors, []);
  console.log(
    'PASS permission-protected PDF produces a readable unencrypted analysis excerpt; password PDF gets a clear message; original hash preserved.',
  );
} finally {
  await browser.close();
}
