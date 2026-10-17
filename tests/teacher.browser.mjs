import { browserExecutable } from './browser-runtime.mjs';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  executablePath: browserExecutable,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(process.env.TEACHER_TEST_URL || 'http://127.0.0.1:5210/?demo=1');
  await page.locator('.demo-roles').waitFor();
  const task = await page.evaluate(async () => {
    const { demoGateway: api, resetDemo, selectDemo } = await import('/src/demo.ts');
    resetDemo();
    selectDemo('teacher');
    const task = await api.teacherSaveAssignment({
      course: 'g0c0',
      title: 'Практическая работа',
      description: 'Обоснуйте ответ',
      due: new Date(Date.now() + 86400000).toISOString(),
      max: 100,
      late: true,
      id: null,
      revision: null,
    });
    selectDemo('leader');
    const token = await api.invite('student', 'g0', [], 60);
    for (let i = 1; i <= 36; i++) {
      await api.signup('Учебный участник ' + i, 'u' + i + '@example.test', 'testpassword123', null);
      await api.redeem(token);
      await api.submit(task, 'Ответ участника ' + i, null);
    }
    selectDemo('student');
    await api.submit(
      task,
      'Первое решение',
      new File(['Документ студента: обоснование ответа.'], 'answer.txt', { type: 'text/plain' }),
    );
    selectDemo('owner');
    await api.saveBoard({
      group: 'g0',
      course: 'g0c0',
      kind: 'schedule',
      title: 'Семинар преподавателя',
      body: 'Разбор решений',
      location: '204',
      start: new Date(Date.now() + 3600000).toISOString(),
      end: new Date(Date.now() + 7200000).toISOString(),
      id: null,
    });
    await api.saveBoard({
      group: 'g0',
      course: 'g0c1',
      kind: 'schedule',
      title: 'Чужая дисциплина',
      body: '',
      location: '999',
      start: new Date(Date.now() + 1800000).toISOString(),
      end: new Date(Date.now() + 3000000).toISOString(),
      id: null,
    });
    return task;
  });
  const role = (name) => page.locator('.demo-roles').getByRole('button', { name, exact: true });
  const sidebar = page.locator('.sidebar');
  await role('Преподаватель').click();
  await page.getByRole('heading', { name: 'Кабинет преподавателя', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Семинар преподавателя', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('heading', { name: 'Чужая дисциплина', exact: true }).count(),
    0,
  );
  await page.screenshot({ path: '/tmp/studyhub-teacher-overview.png' });
  await sidebar.getByRole('button', { name: 'На проверку', exact: true }).click();
  await page.getByText('Найдено работ: 37', { exact: true }).waitFor();
  assert.equal(await page.locator('.teacher-queue-list article').count(), 30);
  await page.getByRole('button', { name: 'Следующие работы' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.teacher-queue-list article').length === 7,
  );
  await page.getByLabel('Поиск студента или задания').fill('Студент');
  await page.waitForFunction(
    () => document.querySelectorAll('.teacher-queue-list article').length === 1,
  );
  await page.getByRole('button', { name: 'Проверить работу', exact: true }).click();
  await page.getByLabel('Комментарий студенту').waitFor();
  await page.getByRole('button', { name: 'Открыть файл работы' }).click();
  await page.getByRole('dialog', { name: 'Файл работы студента' }).waitFor();
  await page.getByText(/Документ студента: обоснование ответа/).waitFor();
  await page.getByRole('button', { name: 'Закрыть файл работы' }).click();
  await page.getByLabel('Балл', { exact: true }).fill('80');
  await page.getByLabel('Комментарий студенту').fill('Черновой комментарий');
  await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await page.getByText('Черновик сохранён. Студент его не видит.', { exact: true }).waitFor();
  await page.evaluate(async (task) => {
    const { demoGateway: api, selectDemo } = await import('/src/demo.ts');
    selectDemo('student');
    const w = (await api.works(task, 0))[0];
    if (w.score !== null || w.feedback !== null) throw Error('Draft visible to student');
    selectDemo('teacher');
  }, task);
  await page.locator('.teacher-return summary').click();
  await page.getByLabel('Что нужно доработать').fill('Добавьте расчёт');
  await page.getByRole('button', { name: 'Вернуть работу студенту' }).click();
  await page.getByText('Работа возвращена на доработку.', { exact: true }).waitFor();
  await role('Студент').click();
  await sidebar.getByRole('button', { name: 'Группы и дисциплины', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть дисциплину', exact: true }).first().click();
  await page.locator('.course-tabs').getByRole('button', { name: 'Задания', exact: true }).click();
  await page
    .getByRole('option', { name: 'Практическая работа', exact: true })
    .waitFor({ state: 'attached' });
  await page.getByLabel('Выберите задание').selectOption(task);
  await page.getByLabel('Ваш ответ').fill('Исправленное решение с расчётом');
  await page.getByRole('button', { name: 'Отправить работу', exact: true }).click();
  await page.getByText('Работа отправлена на проверку.', { exact: true }).waitFor();
  await role('Преподаватель').click();
  await sidebar.getByRole('button', { name: 'На проверку', exact: true }).click();
  await page.getByLabel('Поиск студента или задания').fill('Студент');
  await page.getByRole('button', { name: 'Проверить работу', exact: true }).click();
  await page.getByText('Исправленное решение с расчётом', { exact: true }).waitFor();
  await page
    .locator('.teacher-detail details')
    .filter({ has: page.getByText('История попыток (2)', { exact: true }) })
    .locator('summary')
    .click();
  await page.getByRole('button', { name: 'Попытка 1 · На доработке', exact: true }).click();
  await page.getByText('Первое решение', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Опубликовать оценку', exact: true }).count(),
    0,
  );
  await page.getByRole('button', { name: 'Открыть актуальную попытку' }).click();
  await page.getByLabel('Комментарий студенту').fill('Мой сохранённый текст');
  await page.getByLabel('Балл', { exact: true }).fill('90');
  await page.evaluate(async (task) => {
    const { demoGateway: api } = await import('/src/demo.ts');
    const w = (await api.teacherQueue(null, task, 'pending', 'Студент', 0)).items[0];
    await api.teacherReview(w.id, w.review_version, 'draft', 75, 'Изменение в другой вкладке');
  }, task);
  await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Работа изменилась' }).waitFor();
  assert.equal(await page.getByLabel('Комментарий студенту').inputValue(), 'Мой сохранённый текст');
  await page.getByRole('button', { name: 'Обновить работу' }).click();
  await page.getByRole('button', { name: 'Перенести мой черновик в текущую версию' }).click();
  await page.getByRole('button', { name: 'Опубликовать оценку', exact: true }).click();
  await page.getByText('Оценка опубликована.', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).count(),
    0,
  );
  await page.getByText('История оценивания', { exact: true }).click();
  await page
    .locator('.teacher-decision-event')
    .filter({ hasText: 'Оценка опубликована · 90' })
    .waitFor();
  assert.ok(
    (await page
      .locator('.teacher-decision-event')
      .filter({ hasText: 'Сохранён черновик' })
      .count()) > 0,
  );
  await page.screenshot({ path: '/tmp/studyhub-teacher-review.png', fullPage: true });
  await sidebar.getByRole('button', { name: 'Задания и журнал', exact: true }).click();
  await page
    .getByRole('option', { name: 'Практическая работа', exact: true })
    .waitFor({ state: 'attached' });
  await page.getByLabel('Задание журнала').selectOption(task);
  await page
    .getByText('Студентов в выбранном списке: 38. Черновые оценки отмечены отдельно.', {
      exact: true,
    })
    .waitFor();
  await page.getByLabel('Состояние сдачи').selectOption('not_submitted');
  await page.waitForFunction(
    () => document.querySelectorAll('.teacher-roster article').length === 1,
  );
  assert.ok((await page.locator('.teacher-roster').textContent()).includes('Айдана'));
  await page.getByLabel('Состояние сдачи').selectOption('all');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать выбранный список CSV' }).click();
  await download;
  await page.getByRole('button', { name: 'Изменить условия и срок' }).click();
  await page.getByLabel('Максимальный балл').fill('50');
  await page.getByRole('button', { name: 'Сохранить изменения задания' }).click();
  await page.getByRole('alert').filter({ hasText: 'нельзя менять максимальный балл' }).waitFor();
  await page.getByLabel('Максимальный балл').fill('100');
  await page.getByLabel('Условия задания').fill('Уточнённые условия');
  await page.getByRole('button', { name: 'Сохранить изменения задания' }).click();
  await page.getByText('Изменения задания сохранены.', { exact: true }).waitFor();
  await sidebar.getByRole('button', { name: 'Объявления', exact: true }).click();
  await page.getByRole('button', { name: 'Написать студентам', exact: true }).click();
  await page.getByLabel('Заголовок объявления').fill('Материалы к семинару');
  await page.getByLabel('Описание').fill('Повторите первую тему');
  await page.getByRole('button', { name: 'Опубликовать объявление', exact: true }).click();
  await page.getByText('Объявление опубликовано.', { exact: true }).waitFor();
  await page.setViewportSize({ width: 320, height: 850 });
  await sidebar.getByRole('button', { name: 'Главная', exact: true }).click();
  await page.screenshot({ path: '/tmp/studyhub-teacher-mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log(
    'PASS teacher overview/assigned schedule, 37-work pagination, inline file reading, private draft, return and resubmission, historical read-only attempt, conflict preservation, grade publication, full roster/CSV, editing constraints, announcements and mobile width',
  );
} finally {
  await browser.close();
}
