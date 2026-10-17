import { browserExecutable } from './browser-runtime.mjs';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || browserExecutable,
  args: ['--no-sandbox'],
});
try {
  const context = await browser.newContext(),
    page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); // Chromium may report navigator.onLine=true after a service-worker offline reload.
  // Emulate that device signal explicitly while Playwright blocks real network requests.
  await context.addInitScript(() =>
    Object.defineProperty(navigator, 'onLine', {
      get: () => localStorage.getItem('studyhub-test-offline') !== '1',
    }),
  );
  await page.clock.install({ time: new Date('2026-10-15T03:12:00Z') });
  await page.goto(process.env.DAY_OFFLINE_TEST_URL || 'http://127.0.0.1:4194/?demo=1');
  await page.getByRole('button', { name: 'Владелец', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть админ', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Разделы владельца' })
    .getByRole('button', { name: 'Расписание', exact: true })
    .click();
  await page.getByText('Повторяется каждую неделю', { exact: true }).waitFor();
  await page
    .getByRole('navigation', { name: 'Дни недели для заполнения' })
    .getByRole('button', { name: 'Четверг', exact: true })
    .click();
  await page.getByRole('button', { name: 'Добавить пару', exact: true }).click();
  await page.getByLabel('Дисциплина пары 1', { exact: true }).selectOption('g0c0');
  await page.getByLabel('Начало пары 1', { exact: true }).fill('09:00');
  await page.getByLabel('Конец пары 1', { exact: true }).fill('10:20');
  await page.getByLabel('Аудитория пары 1', { exact: true }).fill('204');
  await page.getByRole('button', { name: 'Сохранить расписание', exact: true }).click();
  await page.getByText('Расписание сохранено.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Студент', exact: true }).click();
  const hero = page.getByRole('region', { name: 'Сейчас и следующая пара' });
  await hero.getByRole('heading', { name: 'Корпоративные финансы', exact: true }).waitFor();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await hero.getByText(/доступно без сети/).waitFor();
  await page.evaluate(() => localStorage.setItem('studyhub-test-offline', '1'));
  await context.setOffline(true);
  await page.reload();
  await hero.getByRole('heading', { name: 'Корпоративные финансы', exact: true }).waitFor();
  await hero
    .getByText('Сохранённое расписание · изменения не проверены', { exact: true })
    .waitFor();
  await hero.getByText('204', { exact: true }).waitFor();
  assert.equal(
    await hero.getByRole('button', { name: 'Материалы пары', exact: true }).isDisabled(),
    true,
  );
  await page.getByRole('button', { name: 'Преподаватель', exact: true }).click();
  await page.getByRole('heading', { name: 'Кабинет преподавателя', exact: true }).waitFor();
  assert.equal(
    await hero.getByRole('heading', { name: 'Корпоративные финансы', exact: true }).count(),
    0,
  );
  await page.getByRole('button', { name: 'Студент', exact: true }).click();
  await hero.getByRole('heading', { name: 'Корпоративные финансы', exact: true }).waitFor();
  await context.setOffline(false);
  await page.evaluate(() => {
    localStorage.removeItem('studyhub-test-offline');
    window.dispatchEvent(new Event('online'));
  });
  await page.waitForFunction(
    () => document.querySelector('.lesson-now')?.getAttribute('data-state') === 'fresh',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS production day: automatic shell/cache installation, offline reload with saved time/room, disabled online actions, account isolation and reconnect; no page errors',
  );
} finally {
  await browser.close();
}
