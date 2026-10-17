import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(process.env.NAVIGATION_PRODUCTION_URL || 'http://127.0.0.1:4264/?demo=1');
  const roles = page.locator('.demo-roles'),
    nav = page.locator('.sidebar');
  await roles.waitFor();
  await roles.getByRole('button', { name: 'Преподаватель', exact: true }).click();
  await nav.locator('[data-section="journal"]').click();
  await page.getByRole('button', { name: 'Новое задание', exact: true }).click();
  await page.getByLabel('Название задания').fill('Задание для ссылки');
  await page.getByLabel('Условия задания', { exact: true }).fill('Проверьте восстановление ответа');
  await page.getByRole('button', { name: 'Опубликовать задание', exact: true }).click();
  await page.getByText('Задание опубликовано.', { exact: true }).waitFor();
  const task = await page.getByLabel('Задание журнала').inputValue();
  await roles.getByRole('button', { name: 'Студент', exact: true }).click();
  await nav.locator('[data-section="groups"]').click();
  await page.getByRole('button', { name: 'Открыть дисциплину', exact: true }).first().click();
  await page.locator('.course-tabs').getByRole('button', { name: 'Задания', exact: true }).click();
  await page.getByLabel('Выберите задание').selectOption(task);
  await page.getByLabel('Ваш ответ').fill('Сохранённый ответ в сборке');
  const url = page.url();
  await page.reload();
  await page.getByLabel('Ваш ответ').waitFor();
  assert.equal(page.url(), url);
  assert.equal(await page.getByLabel('Ваш ответ').inputValue(), 'Сохранённый ответ в сборке');
  await nav.locator('[data-section="schedule"]').click();
  await page.goBack();
  await page.getByLabel('Ваш ответ').waitFor();
  await page.goForward();
  await page.locator('.schedule-world').waitFor();
  await nav.locator('[data-section="library"]').click();
  await page.getByRole('button', { name: 'Открыть', exact: true }).first().click();
  await page.getByRole('dialog').waitFor();
  assert.ok(new URL(page.url()).searchParams.get('book'));
  const bookURL = page.url();
  await page.reload();
  await page.getByRole('dialog').waitFor();
  assert.equal(page.url(), bookURL);
  await page.getByRole('button', { name: 'Закрыть просмотр', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.has('book'), false);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log(
    'PASS compiled navigation: UI-created task and draft restored automatically, history, library reader restored after reload, mobile and no page errors',
  );
} finally {
  await browser.close();
}
