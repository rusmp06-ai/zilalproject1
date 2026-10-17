import { browserExecutable } from './browser-runtime.mjs';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  executablePath: browserExecutable,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.NOTIFICATIONS_TEST_URL || 'http://127.0.0.1:5208/?demo=1');
  await page.locator('.demo-roles').waitFor();
  const task = await page.evaluate(async () => {
    const { demoGateway: api, resetDemo, selectDemo } = await import('/src/demo.ts');
    resetDemo();
    selectDemo('teacher');
    for (let i = 1; i <= 61; i++)
      await api.saveBoard({
        group: 'g0',
        course: 'g0c0',
        kind: 'announcement',
        title: 'Объявление ' + i,
        body: 'Учебное сообщение',
        location: '',
        start: null,
        end: null,
        id: null,
      });
    await api.createAssignment(
      'g0c0',
      'Просроченное задание',
      'Ответьте на вопрос',
      new Date(Date.now() - 3600000).toISOString(),
      100,
      true,
    );
    await api.createAssignment(
      'g0c0',
      'Будущее задание',
      '',
      new Date(Date.now() + 86400000).toISOString(),
      100,
      true,
    );
    return (await api.assignments('g0c0')).items.find((a) => a.title === 'Просроченное задание').id;
  });
  await page.locator('.demo-roles').getByRole('button', { name: 'Студент', exact: true }).click();
  const sidebar = page.locator('.sidebar'),
    ann = sidebar.getByRole('button', { name: 'Объявления', exact: true }),
    tasks = sidebar.getByRole('button', { name: 'Все задания', exact: true });
  await ann.locator('.notification-bell').waitFor();
  assert.equal(await ann.locator('.notification-bell b').textContent(), '61');
  assert.equal(await tasks.locator('.notification-bell b').textContent(), '1');
  assert.ok(await ann.getAttribute('aria-describedby'));
  await page.screenshot({ path: '/tmp/studyhub-notifications-desktop.png' });
  await ann.click();
  const card = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Объявление 61', exact: true }) });
  await card.getByRole('button', { name: 'Отметить прочитанным' }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-section=announcements] .notification-bell b')?.textContent ===
      '60',
  );
  await page.reload();
  await ann.locator('.notification-bell').waitFor();
  assert.equal(await ann.locator('.notification-bell b').textContent(), '60');
  await ann.click();
  await card.getByRole('heading', { name: 'Объявление 61', exact: true }).waitFor();
  assert.equal(await card.getByRole('button', { name: 'Отметить прочитанным' }).count(), 0);
  await page.locator('.workspace').getByRole('button', { name: 'Далее', exact: true }).click();
  await page.getByRole('heading', { name: 'Объявление 1', exact: true }).waitFor();
  assert.equal(await ann.locator('.notification-bell b').textContent(), '60');
  await page.locator('.demo-roles').getByRole('button', { name: 'Староста', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-section=announcements] .notification-bell b')?.textContent ===
      '61',
  );
  await page.locator('.demo-roles').getByRole('button', { name: 'Студент', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-section=announcements] .notification-bell b')?.textContent ===
      '60',
  );
  await tasks.click();
  await page.locator('.study-row').filter({ hasText: 'Просроченное задание' }).click();
  await page.getByLabel('Ваш ответ').fill('Ответ студента');
  await page.getByRole('button', { name: 'Отправить работу', exact: true }).click();
  await page.getByText('Работа отправлена на проверку.', { exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector('[data-section=tasks] .notification-bell'),
  );
  await page.evaluate(async (task) => {
    const { demoGateway: api, selectDemo } = await import('/src/demo.ts');
    selectDemo('teacher');
    const w = (await api.works(task, 0))[0];
    await api.returnWork(w.id, 'Доработайте ответ');
    selectDemo('student');
  }, task);
  await tasks.locator('.notification-bell').waitFor();
  assert.equal(await tasks.locator('.notification-bell b').textContent(), '1');
  await page.setViewportSize({ width: 320, height: 850 });
  await sidebar.getByRole('button', { name: 'Главная', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Уведомления разделов' })
    .getByRole('button', { name: 'Новые объявления: 60' })
    .waitFor();
  await page.screenshot({ path: '/tmp/studyhub-notifications-mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log(
    'PASS red bells, count beyond page limit, explicit read and reload persistence, account isolation, real UI submission/return, mobile shortcuts and width',
  );
} finally {
  await browser.close();
}
