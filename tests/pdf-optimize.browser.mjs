import { browserExecutable } from './browser-runtime.mjs';
import { chromium } from 'playwright-core';
import { PDFDocument, StandardFonts, PDFName } from 'pdf-lib';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
async function fixture(options = {}) {
  const d = await PDFDocument.create();
  d.setTitle('StudyHub original title');
  const font = await d.embedFont(StandardFonts.Helvetica);
  const image = await d.embedPng(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  for (let i = 0; i < (options.pages || 3); i++) {
    const p = d.addPage([300, 400]);
    p.drawText('Original text ' + i, { font, size: 16, x: 20, y: 300 });
    p.drawRectangle({ x: 20, y: 30, width: 50, height: 70 });
    p.drawImage(image, { x: 100, y: 100, width: 50, height: 50 });
  }
  if (options.form) d.getForm().createTextField('student');
  if (options.signature)
    d.context.register(d.context.obj({ Type: PDFName.of('Sig'), ByteRange: [0, 1, 2, 3] }));
  return Buffer.from(await d.save({ useObjectStreams: !options.unpacked }));
}
const original = await fixture({ unpacked: true }),
  packed = await fixture(),
  interactive = await fixture({ form: true, unpacked: true }),
  signed = await fixture({ signature: true, unpacked: true });
const browser = await chromium.launch({
  executablePath: browserExecutable,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.PDF_OPTIMIZE_TEST_URL || 'http://127.0.0.1:5220/?demo=1');
  await page.locator('.demo-roles').getByRole('button', { name: 'Владелец', exact: true }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'Админ', exact: true }).click();
  await page
    .locator('.owner-admin')
    .getByRole('button', { name: 'Публикации в библиотеке', exact: true })
    .click();
  const input = page.locator('.upload-panel input[type=file]'),
    widget = page.locator('.pdf-optimization');
  async function choose(buffer, name = 'lecture.pdf') {
    await input.setInputFiles({ name, mimeType: 'application/pdf', buffer });
  }
  await choose(original);
  await widget.getByRole('button', { name: 'Оптимизировать без потери качества' }).click();
  await widget.getByText(/Текст и отображение страниц проверены/).waitFor();
  assert.match(await widget.textContent(), /Было .* → стало .*Экономия/);
  await widget.getByRole('button', { name: 'Вернуть оригинал' }).click();
  await widget.getByRole('button', { name: 'Оптимизировать без потери качества' }).waitFor();
  assert.ok(!(await widget.textContent()).includes('Было'));
  await widget.getByRole('button', { name: 'Оптимизировать без потери качества' }).click();
  await widget.getByText(/Текст и отображение страниц проверены/).waitFor();
  await page.getByLabel('Название материала').fill('Оптимизированная лекция');
  await page.getByRole('button', { name: 'Загрузить материал', exact: true }).click();
  await page.getByText('Материал опубликован в общей библиотеке.', { exact: true }).waitFor();
  assert.equal(await widget.count(), 0);
  const card = page
    .locator('.library-card')
    .filter({ has: page.getByRole('heading', { name: 'Оптимизированная лекция', exact: true }) });
  await card.locator('summary').click();
  const downloading = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Скачать', exact: true }).click();
  const download = await downloading;
  assert.equal(download.suggestedFilename(), 'lecture.pdf');
  const uploaded = await readFile(await download.path());
  assert.ok(uploaded.length < original.length);
  assert.equal((await PDFDocument.load(uploaded)).getPageCount(), 3);
  await choose(packed);
  await widget.getByRole('button', { name: 'Оптимизировать без потери качества' }).click();
  await widget.getByText(/Файл уже хорошо сжат/).waitFor();
  assert.equal(await widget.getByRole('button', { name: 'Вернуть оригинал' }).count(), 0);
  for (const buffer of [interactive, signed]) {
    await choose(buffer);
    await widget.getByRole('button', { name: 'Оптимизировать без потери качества' }).click();
    await widget.getByText(/Защищённые и интерактивные PDF/).waitFor();
    assert.equal(await widget.getByRole('button', { name: 'Вернуть оригинал' }).count(), 0);
  }
  await choose(Buffer.from('invalid pdf'));
  await widget.getByRole('button', { name: 'Оптимизировать без потери качества' }).click();
  await widget.getByText(/Безопасную оптимизацию подтвердить не удалось/).waitFor();
  await choose(await fixture({ unpacked: true, pages: 35 }));
  await widget.getByRole('button', { name: 'Оптимизировать без потери качества' }).click();
  await widget.getByRole('button', { name: 'Отменить оптимизацию' }).click();
  await widget.getByText(/Оптимизация отменена/).waitFor();
  await widget.getByRole('button', { name: 'Оптимизировать без потери качества' }).click();
  await choose(interactive, 'replacement.pdf');
  await page.waitForTimeout(500);
  assert.equal(await widget.getByRole('button', { name: 'Вернуть оригинал' }).count(), 0);
  assert.equal(await widget.getByRole('button', { name: 'Отменить оптимизацию' }).count(), 0);
  await page.setViewportSize({ width: 320, height: 850 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: '/tmp/studyhub-pdf-optimization.png', fullPage: true });
  await input.setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Notes'),
  });
  assert.equal(await widget.count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS PDF text/image verification, smaller uploaded result, restore original, already-compressed fallback, forms/signatures/invalid fallback, cancellation, replacement safety, other formats and mobile',
  );
} catch (e) {
  for (const c of browser.contexts())
    for (const p of c.pages())
      try {
        console.log((await p.locator('.pdf-optimization').allTextContents()).join('\n'));
      } catch {}
  throw e;
} finally {
  await browser.close();
}
