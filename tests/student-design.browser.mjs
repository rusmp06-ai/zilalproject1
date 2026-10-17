import { browserExecutable } from './browser-runtime.mjs';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: browserExecutable,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const base = process.env.DESIGN_TEST_URL || 'http://127.0.0.1:5199/?demo=1';
  await page.goto(base);
  await page.locator('.demo-roles').waitFor();
  await page.evaluate(async () => {
    const { demoGateway: api, resetDemo, selectDemo } = await import('/src/demo.ts');
    resetDemo();
    selectDemo('teacher');
    await api.saveMaterial(
      'g0c0',
      'lecture',
      'Анализ финансовой устойчивости предприятия: лекция с длинным названием',
      '',
      new File(['Глава 1. Финансовая устойчивость\nТекст учебного материала.'], 'finance.txt', {
        type: 'text/plain',
      }),
      null,
    );
    await api.createAssignment(
      'g0c0',
      'Подготовить расчёт финансовых показателей предприятия',
      'Расчёт по материалам лекции',
      null,
      100,
      true,
    );
    selectDemo('student');
  });
  await page.reload();
  await mkdir('/tmp/studyhub-design-v40', { recursive: true });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const url = new URL(base);
    url.searchParams.set('view', 'groups');
    url.searchParams.set('course', 'g0c0');
    await page.goto(url.href);
    await page.locator('.course-tabs button[aria-current=page]').waitFor();
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Course overview overflow at ${width}`,
    );
    for (const selector of ['.course-refresh', '.course-tabs button'])
      for (const button of await page.locator(selector).all()) {
        const box = await button.boundingBox();
        assert.ok(box.height >= 44, `Small tap target: ${selector} at ${width}`);
      }
    await page.screenshot({ path: `/tmp/studyhub-design-v40/course-${width}.png`, fullPage: true });
    await page
      .locator('.course-tabs')
      .getByRole('button', { name: 'Материалы', exact: true })
      .click();
    await page
      .locator('.course-book')
      .getByRole('heading', { name: /Анализ финансовой устойчивости/ })
      .waitFor();
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Material shelf overflow at ${width}`,
    );
    const file = page.getByRole('button', { name: 'Открыть файл', exact: true });
    assert.ok((await file.boundingBox()).height >= 44);
    await file.click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: 'Закрыть просмотр', exact: true }).click();
    const notes = new URL(url);
    notes.searchParams.set('section', 'notes');
    await page.goto(notes.href);
    await page.getByLabel('Текст заметки', { exact: true }).waitFor();
    const active = await page.locator('.course-tabs [aria-current=page]').boundingBox(),
      nav = await page.locator('.course-tabs').boundingBox();
    assert.ok(
      active.x >= nav.x - 1 && active.x + active.width <= nav.x + nav.width + 1,
      `Restored active tab hidden at ${width}`,
    );
    const input = await page
      .getByLabel('Текст заметки', { exact: true })
      .evaluate((el) => getComputedStyle(el).fontSize);
    assert.ok(parseFloat(input) >= 16, 'Input text must stay readable');
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS student design: 1440/768/390/320 layouts, long material titles, 44px tap targets, restored active tabs visible, readable fields and working document actions',
  );
} finally {
  await browser.close();
}
