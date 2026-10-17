import { browserExecutable } from './browser-runtime.mjs';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  executablePath: browserExecutable,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({ locale: 'ru-RU' }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.setDefaultTimeout(15000);
  await page.clock.install({ time: new Date('2026-10-19T02:30:00Z') });
  await page.goto(process.env.STUDY_TEST_URL || 'http://127.0.0.1:5184/?demo=1');
  await page.locator('.demo-roles').waitFor();
  await page.evaluate(async () => {
    const { resetDemo } = await import('/src/demo.ts');
    resetDemo();
  });
  const role = (name) => page.locator('.demo-roles').getByRole('button', { name, exact: true }),
    nav = page.locator('.sidebar');
  await role('Староста').click();
  await page.getByRole('button', { name: 'Открыть админ', exact: true }).click();
  const admin = page.getByRole('region', { name: 'Админ старосты' });
  await admin.getByRole('button', { name: 'Расписание', exact: true }).click();
  await page.getByText('Повторяется каждую неделю', { exact: true }).waitFor();
  for (const [n, course, start, end, room] of [
    [1, 'g0c0', '08:00', '09:20', '204'],
    [2, 'g0c1', '09:30', '10:50', '308'],
  ]) {
    await page.getByRole('button', { name: 'Добавить пару', exact: true }).click();
    await page.getByLabel('Дисциплина пары ' + n, { exact: true }).selectOption(course);
    await page.getByLabel('Начало пары ' + n, { exact: true }).fill(start);
    await page.getByLabel('Конец пары ' + n, { exact: true }).fill(end);
    await page.getByLabel('Аудитория пары ' + n, { exact: true }).fill(room);
  }
  await page.getByLabel('Начало пары 2', { exact: true }).fill('09:00');
  await page.getByRole('button', { name: 'Сохранить расписание', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Время пар пересекается' }).waitFor();
  await page.getByLabel('Начало пары 2', { exact: true }).fill('09:30');
  await page.getByRole('button', { name: 'Сохранить расписание', exact: true }).click();
  await page.getByText('Расписание сохранено.', { exact: true }).waitFor();
  await page.getByLabel('Аудитория пары 1', { exact: true }).fill('Несохранённый кабинет');
  page.once('dialog', (d) => d.dismiss());
  await page
    .getByRole('navigation', { name: 'Дни недели для заполнения' })
    .getByRole('button', { name: 'Вторник', exact: true })
    .click();
  assert.equal(
    await page.getByLabel('Аудитория пары 1', { exact: true }).inputValue(),
    'Несохранённый кабинет',
  );
  await page.getByLabel('Аудитория пары 1', { exact: true }).fill('204');
  await page.getByText('Изменения на отдельную дату', { exact: true }).click();
  const rows = page.locator('.schedule-date-row');
  await rows.first().getByRole('button', { name: 'Изменить на эту дату' }).click();
  const editor = page.getByRole('region', { name: 'Изменение занятия на дату' });
  await editor.getByLabel('Отменить занятие на эту дату').check();
  await editor.getByRole('button', { name: 'Сохранить изменение', exact: true }).click();
  await page.getByText('Изменение сохранено только на выбранную дату.', { exact: true }).waitFor();
  await role('Студент').click();
  await nav.getByRole('button', { name: 'Расписание', exact: true }).click();
  const schedule = page.locator('.schedule-world');
  await schedule.getByText('Отменено', { exact: true }).waitFor();
  assert.equal(await schedule.locator('.schedule-lesson').count(), 2);
  assert.equal(await schedule.getByLabel('Группа', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Добавить пару', exact: true }).count(), 0);
  await schedule.getByRole('button', { name: 'Следующая неделя' }).click();
  await schedule.getByText('Аудитория 204', { exact: true }).waitFor();
  assert.equal(await schedule.getByText('Отменено', { exact: true }).count(), 0);
  await page.reload();
  await schedule.getByText('Аудитория 204', { exact: true }).waitFor();
  assert.equal(await schedule.locator('.schedule-lesson').count(), 2);
  await schedule.locator('.schedule-lesson').first().click();
  await page.locator('.course-tabs [aria-current=page]').filter({ hasText: 'Материалы' }).waitFor();
  await nav.getByRole('button', { name: 'Расписание', exact: true }).click();
  await schedule.locator('.schedule-lesson').first().waitFor();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `schedule overflow ${width}`,
    );
    await page.screenshot({ path: `/tmp/studyhub-schedule-v45-${width}.png`, fullPage: true });
  }
  await role('Староста').click();
  await page.getByRole('button', { name: 'Открыть админ', exact: true }).click();
  await admin.getByRole('button', { name: 'Расписание', exact: true }).click();
  await page.getByLabel('Дисциплина пары 1', { exact: true }).waitFor();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `editor overflow ${width}`,
    );
    await page.screenshot({
      path: `/tmp/studyhub-schedule-editor-v45-${width}.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS weekly editor: two lessons, overlap guard, draft guard, isolated cancellation, recurring following week, student read-only/group context, reload, direct course opening and mobile layouts',
  );
} finally {
  await browser.close();
}
