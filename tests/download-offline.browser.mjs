import { chromium } from 'playwright-core';
import { browserExecutable } from './browser-runtime.mjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  executablePath: browserExecutable,
  args: ['--no-sandbox'],
});
try {
  const context = await browser.newContext(),
    page = await context.newPage(),
    requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(process.env.OFFLINE_TEST_URL || 'http://127.0.0.1:4180/?demo=1');
  await page.locator('.demo-roles').waitFor();
  await page.waitForLoadState('networkidle');
  assert.equal(
    requests.some((url) => /pdf-reader|pdf\.worker|tesseract|pdf-optimize|\/ocr-/.test(url)),
    false,
    'cold entry must not fetch document engines',
  );
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText('Offline PDF fixture', { x: 40, y: 700, font, size: 18 });
  const bytes = await pdf.save();
  await page.locator('.demo-roles').getByRole('button', { name: 'Владелец', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть админ', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Разделы владельца' })
    .getByRole('button', { name: 'Публикации в библиотеке', exact: true })
    .click();
  await page.getByLabel('Название материала', { exact: true }).fill('Offline PDF fixture');
  await page.getByLabel('Файл', { exact: true }).setInputFiles({
    name: 'offline.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes),
  });
  await page.getByRole('button', { name: 'Загрузить материал', exact: true }).click();
  await page.getByText('Материал опубликован в общей библиотеке.', { exact: true }).waitFor();
  await page.locator('.demo-roles').getByRole('button', { name: 'Студент', exact: true }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'Библиотека', exact: true }).click();
  const card = page
    .locator('.library-card')
    .filter({ has: page.getByRole('heading', { name: 'Offline PDF fixture', exact: true }) });
  await card.locator('.book-actions-more>summary').click();
  await card.getByRole('button', { name: 'Сохранить без интернета', exact: true }).click();
  await page
    .getByText('Материал сохранён для автономного чтения.', { exact: true })
    .waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.equal(
    requests.some((url) => /tesseract|pdf-optimize|\/ocr-/.test(url)),
    false,
    'offline saving must not download OCR or optimizer',
  );
  await page
    .locator('.sidebar')
    .getByRole('button', { name: 'Сохранённые материалы', exact: true })
    .click();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Читать сохранённую копию', exact: true }).click();
  await page.locator('.reader-document canvas').waitFor({ timeout: 30000 });
  assert.ok((await page.locator('.reader-document canvas').count()) > 0);
  console.log(
    'PASS cold entry excludes heavy engines; offline PDF works with external worker; saving excludes OCR and optimizer',
  );
} finally {
  await browser.close();
}
