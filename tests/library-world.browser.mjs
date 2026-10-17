import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const artifacts = '/tmp/studyhub-library-world';
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.LIBRARY_TEST_URL || 'http://127.0.0.1:5194/?demo=1', {
    waitUntil: 'networkidle',
  });
  await page.evaluate(async () => {
    const d = await import('/src/demo.ts');
    d.resetDemo();
    d.selectDemo('owner');
    const names = [
      'Основы экономики',
      'Академическое письмо',
      'Математика для практики',
      'История и общество',
      'Деловой английский',
      'Методы исследования',
      'Право и человек',
      'Учиться эффективно',
    ];
    for (const title of names)
      await d.demoGateway.uploadLibrary(
        'g0',
        title,
        new File(['Глава 1. Введение\n' + 'Полезный учебный текст. '.repeat(450)], 'study.txt', {
          type: 'text/plain',
        }),
      );
    d.selectDemo('student');
    const book = (await d.demoGateway.library('', 0)).items.find((i) => i.title === names[0]);
    await d.demoGateway.saveReading({
      item_id: book.id,
      page: 2,
      total_pages: 3,
      favorite: true,
      bookmarks: [2],
      version: 0,
    });
  });
  await page.getByRole('button', { name: 'Студент', exact: true }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'Библиотека', exact: true }).click();
  await page.getByRole('heading', { name: 'Основы экономики', exact: true }).waitFor();
  assert.equal(await page.locator('.book-cover').count(), 9);
  await page.screenshot({ path: artifacts + '/desktop.png', fullPage: true });
  await page.getByRole('button', { name: /^Читаю/ }).click();
  assert.equal(await page.locator('.library-card').count(), 1);
  await page.getByRole('heading', { name: 'Основы экономики', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Все материалы', exact: true }).click();
  await page.getByLabel('Формат', { exact: true }).selectOption('TXT');
  await page.getByLabel('Порядок', { exact: true }).selectOption('title');
  const titles = await page.locator('.library-card h3').allTextContents();
  assert.deepEqual(
    titles,
    [...titles].sort((a, b) => a.localeCompare(b, 'ru')),
  );
  await page.getByLabel('Только избранное', { exact: true }).check();
  await page.getByRole('heading', { name: 'Основы экономики', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.library-card').length === 1);
  await page.getByLabel('Только избранное', { exact: true }).uncheck();
  await page.getByRole('heading', { name: 'Академическое письмо', exact: true }).waitFor();
  await page.getByLabel('Поиск по библиотеке', { exact: true }).fill('Академическое');
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.library-card').length === 1);
  await page.getByRole('heading', { name: 'Академическое письмо', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Сбросить поиск', exact: true }).click();
  await page.getByRole('heading', { name: 'Основы экономики', exact: true }).waitFor();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'World must fit mobile width',
    );
    assert.ok(
      await page
        .locator('.library-card')
        .first()
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      'Book card must fit',
    );
    await page.screenshot({ path: artifacts + '/mobile-' + width + '.png', fullPage: true });
  }
  const target = page
    .locator('.library-card')
    .filter({ has: page.getByRole('heading', { name: 'Академическое письмо', exact: true }) });
  await target.locator('.book-actions-more > summary').click();
  const download = page.waitForEvent('download');
  await target.getByRole('button', { name: 'Скачать', exact: true }).click();
  assert.equal((await download).suggestedFilename(), 'study.txt');
  await target.locator('.book-actions-more > summary').click();
  await page.getByRole('button', { name: 'Открыть «Академическое письмо»', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Академическое письмо', exact: true });
  await dialog.getByLabel('Текст страницы', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Поиск в документе', exact: true }).click();
  await dialog.getByLabel('Найти в тексте', { exact: true }).press('Escape');
  assert.equal(await dialog.count(), 1);
  await dialog.getByRole('button', { name: 'Закрыть просмотр', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    'PASS book storefront, complete shelves, favorite/search/format/sort, cover opens reader, reader Escape, desktop and 390/320 widths',
  );
} finally {
  await browser.close();
}
