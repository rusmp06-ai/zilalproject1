import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  page.setDefaultTimeout(12000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.LEADER_TEST_URL || 'http://127.0.0.1:5203/?demo=1');
  await page.locator('.demo-roles').waitFor();
  await page.evaluate(async () => {
    const { demoGateway: api, resetDemo, selectDemo } = await import('/src/demo.ts');
    resetDemo();
    selectDemo('teacher');
    await api.createAssignment('g0c0', 'Работа старосты', 'Ответьте на вопрос', null, 100, false);
    const task = (await api.assignments('g0c0')).items[0];
    selectDemo('student');
    await api.submit(task.id, 'Личный ответ другого студента', null);
    selectDemo('leader');
    await api.saveMaterial('g0c0', 'lecture', 'Лекция группы', 'Учебный текст', null, null);
  });
  await page.locator('.demo-roles').getByRole('button', { name: 'Староста', exact: true }).click();
  await page.getByRole('heading', { name: 'Ваше пространство', exact: true }).waitFor();
  const side = page.locator('.sidebar');
  assert.equal(await side.getByRole('button', { name: 'Приглашения', exact: true }).count(), 0);
  assert.equal(await page.getByRole('combobox').count(), 0);
  await side.getByRole('button', { name: 'Группы и дисциплины', exact: true }).click();
  assert.equal(await page.getByLabel('Новая дисциплина').count(), 0);
  await page.getByRole('button', { name: 'Открыть дисциплину', exact: true }).first().click();
  await page
    .locator('.course-tabs')
    .getByRole('button', { name: 'Материалы', exact: true })
    .click();
  await page.getByRole('heading', { name: 'Лекция группы', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Опубликовать материал', exact: true }).count(),
    0,
  );
  await page.locator('.course-tabs').getByRole('button', { name: 'Задания', exact: true }).click();
  await page.getByLabel('Выберите задание').selectOption({ label: 'Работа старосты' });
  await page.getByLabel('Ваш ответ').fill('Ответ старосты');
  await page.getByRole('button', { name: 'Отправить работу', exact: true }).click();
  await page.getByText('Работа отправлена на проверку.', { exact: true }).waitFor();
  assert.equal(await page.getByText('Личный ответ другого студента', { exact: true }).count(), 0);
  assert.equal(
    await page.getByRole('button', { name: 'Опубликовать оценку', exact: true }).count(),
    0,
  );
  await side.getByRole('button', { name: 'Библиотека', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Как пользоваться общей библиотекой', exact: true })
    .waitFor();
  assert.equal(await page.getByLabel('Название материала').count(), 0);
  await page.getByRole('button', { name: 'Открыть админ', exact: true }).click();
  const admin = page.getByRole('region', { name: 'Админ старосты' });
  await admin.getByText('Староста · студент', { exact: true }).waitFor();
  await admin
    .locator('.people-list b')
    .filter({ hasText: /^Студент$/ })
    .waitFor();
  assert.equal(await admin.getByRole('button', { name: 'Заблокировать', exact: true }).count(), 0);
  const nav = admin.getByRole('navigation', { name: 'Разделы админа' });
  await nav.getByRole('button', { name: 'Дисциплины и преподаватели', exact: true }).click();
  await admin.getByLabel('Новая дисциплина').fill('Право');
  await admin.getByRole('button', { name: 'Добавить дисциплину', exact: true }).click();
  await admin.getByText('Дисциплина создана.', { exact: true }).waitFor();
  await admin.getByText('Право', { exact: true }).waitFor();
  await nav.getByRole('button', { name: 'Расписание', exact: true }).click();
  await admin.getByRole('button', { name: 'Добавить пару', exact: true }).click();
  await admin.getByLabel('Дисциплина пары 1', { exact: true }).selectOption('g0c0');
  await admin.getByLabel('Начало пары 1', { exact: true }).fill('08:00');
  await admin.getByLabel('Конец пары 1', { exact: true }).fill('09:20');
  await admin.getByLabel('Аудитория пары 1', { exact: true }).fill('308');
  await admin.getByRole('button', { name: 'Сохранить расписание', exact: true }).click();
  await admin.getByText('Расписание сохранено.', { exact: true }).waitFor();
  await nav.getByRole('button', { name: 'Приглашения', exact: true }).click();
  assert.equal(await admin.getByRole('option', { name: /Староста/ }).count(), 0);
  await admin.getByRole('button', { name: 'Создать ссылку', exact: true }).click();
  await admin.getByLabel('Пригласительная ссылка').waitFor();
  assert.match(await admin.getByLabel('Пригласительная ссылка').inputValue(), /#invite=/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'Admin mobile overflow',
  );
  await page.screenshot({ path: '/tmp/studyhub-leader-admin-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'Admin 320 overflow',
  );
  await page.getByRole('button', { name: 'К учебному пространству', exact: true }).click();
  await page.getByRole('heading', { name: 'Ваше пространство', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Открыть админ', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Новая дисциплина').count(), 0);
  await page.evaluate(async () => {
    const { demoGateway: api } = await import('/src/demo.ts');
    const snap = await api.snapshot();
    if (snap.me.id !== 'leader') throw Error('Account changed');
    if ((await api.assignments('g0c0')).canGrade) throw Error('Leader can grade');
    try {
      await api.groupMembers('g1', 0);
      throw Error('Foreign roster allowed');
    } catch (e) {
      if (e.message === 'Foreign roster allowed') throw e;
    }
  });
  await page.locator('.demo-roles').getByRole('button', { name: 'Студент', exact: true }).click();
  await page.getByRole('heading', { name: 'Ваше пространство', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Открыть админ', exact: true }).count(), 0);
  assert.equal(await page.getByRole('region', { name: 'Админ старосты' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS leader study/admin separation, own submission privacy, roster scope, course/schedule/invitation creation, return to study, student guard and mobile 390/320',
  );
} finally {
  await browser.close();
}
