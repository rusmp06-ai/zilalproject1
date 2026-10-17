import { browserExecutable } from './browser-runtime.mjs';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  executablePath: browserExecutable,
  args: ['--no-sandbox'],
});
let page;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('dialog', (d) => d.accept());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.UPLOAD_RECOVERY_TEST_URL || 'http://127.0.0.1:5266/?demo=1');
  await page.locator('.demo-roles').waitFor();
  await page.evaluate(async () => {
    const { resetDemo, selectDemo } = await import('/src/demo.ts');
    resetDemo();
    selectDemo('leader');
  });
  await page.reload();
  async function helper() {
    await page.locator('.sidebar [data-section="admin"]').click();
    await page
      .getByRole('navigation', { name: 'Разделы админа' })
      .getByRole('button', { name: 'Дисциплины и преподаватели', exact: true })
      .click();
    await page.getByRole('button', { name: 'Добавить документ с ИИ', exact: true }).click();
  }
  await helper();
  const area = page.getByRole('region', { name: 'Добавление документа с ИИ' }),
    original = {
      name: 'lecture.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Original lecture: capital and investment.'),
    };
  async function prepare(title) {
    await area.getByLabel('Документ для распознавания').setInputFiles(original);
    await area.getByLabel('Тип документа', { exact: true }).selectOption('lecture');
    await area.getByLabel('Название документа', { exact: true }).fill(title);
    await area.getByLabel('Дисциплина для публикации', { exact: true }).selectOption('g0c0');
  }
  await prepare('Лекция после обрыва');
  await page.evaluate(async () => {
    const { demoGateway: a } = await import('/src/demo.ts');
    a.publishIntake = async () => {
      throw Error('Обрыв передачи');
    };
  });
  await area.getByRole('button', { name: 'Утвердить и опубликовать' }).click();
  await area.getByText('Обрыв передачи', { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => localStorage.getItem('studyhub-upload-v1:demo:leader')));
  await page.reload();
  await helper();
  await area.getByRole('region', { name: 'Незавершённая публикация' }).waitFor();
  assert.equal(await area.getByRole('button', { name: 'Продолжить загрузку' }).isDisabled(), true);
  await area
    .getByLabel('Исходный файл для повтора')
    .setInputFiles({ ...original, buffer: Buffer.from('Wrong') });
  await area.getByText(/Это другой файл/).waitFor();
  await area.getByLabel('Исходный файл для повтора').setInputFiles(original);
  await page.evaluate(async () => {
    const { demoGateway: a } = await import('/src/demo.ts');
    const publish = a.publishIntake.bind(a);
    a.publishIntake = async (p, f) => {
      await publish(p, f);
      throw Error('Ответ о публикации потерян');
    };
  });
  await area.getByRole('button', { name: 'Продолжить загрузку' }).click();
  await area.getByText('Ответ о публикации потерян', { exact: true }).waitFor();
  await area.getByRole('button', { name: 'Проверить публикацию' }).click();
  await area
    .getByText('Материал опубликован. Оригинальный файл сохранён.', { exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() => localStorage.getItem('studyhub-upload-v1:demo:leader')),
    null,
  );
  await area.getByRole('button', { name: 'Добавить следующий документ' }).click();
  await prepare('Будет отменено');
  await page.evaluate(async () => {
    const { demoGateway: a } = await import('/src/demo.ts');
    a.publishIntake = async () => {
      throw Error('Передача прервана');
    };
    a.cancelIntake = async () => {
      throw Error('Отмена без сети');
    };
  });
  await area.getByRole('button', { name: 'Утвердить и опубликовать' }).click();
  await area.getByText('Передача прервана', { exact: true }).waitFor();
  await area.getByRole('button', { name: 'Отменить незавершённую публикацию' }).click();
  await area.getByText('Отмена без сети', { exact: true }).waitFor();
  await page.reload();
  await helper();
  await area
    .getByText('Начата отмена. Повторная публикация заблокирована.', { exact: true })
    .waitFor();
  assert.equal(await area.getByRole('button', { name: 'Продолжить загрузку' }).count(), 0);
  await area.getByRole('button', { name: 'Отменить незавершённую публикацию' }).click();
  await area.getByText(/резерв места освобождён/).waitFor();
  await area.getByRole('button', { name: 'Закрыть помощника' }).click();
  const count = await page.evaluate(async () => {
    const { demoGateway: a } = await import('/src/demo.ts');
    return (await a.courseMaterials('g0c0', 'lecture', 0)).items.length;
  });
  assert.equal(count, 1);
  await page.locator('.demo-roles').getByRole('button', { name: 'Студент', exact: true }).click();
  await page.locator('.sidebar [data-section="groups"]').click();
  await page.getByRole('button', { name: 'Открыть дисциплину', exact: true }).first().click();
  await page
    .locator('.course-tabs')
    .getByRole('button', { name: 'Материалы', exact: true })
    .click();
  await page
    .locator('.course-book')
    .filter({ has: page.getByRole('heading', { name: 'Лекция после обрыва', exact: true }) })
    .getByRole('button', { name: 'Открыть файл', exact: true })
    .click();
  await page
    .getByRole('region', { name: 'Читалка', exact: true })
    .getByText('Original lecture: capital and investment.', { exact: true })
    .waitFor();
  assert.equal(await page.getByText('Будет отменено', { exact: true }).count(), 0);

  await page.locator('.reader-more summary').click();
  await page.getByRole('button', { name: 'Заметка к странице', exact: true }).click();
  await page.getByLabel('Название записи', { exact: true }).fill('Конспект после обрыва');
  await page
    .getByLabel('Мысль или вопрос')
    .fill('Этот текст должен пережить ошибку и перезагрузку.');
  await page.getByRole('button', { name: 'Закрыть просмотр', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.evaluate(async () => {
    const { demoGateway: a } = await import('/src/demo.ts');
    a.saveNote = async () => {
      throw Error('Заметка не передана');
    };
  });
  await page.getByRole('button', { name: 'Открыть файл', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить запись', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Заметка не передана' }).waitFor();
  assert.equal(
    await page.getByLabel('Мысль или вопрос').inputValue(),
    'Этот текст должен пережить ошибку и перезагрузку.',
  );
  await page.reload();
  await page.getByLabel('Мысль или вопрос').waitFor();
  assert.equal(
    await page.getByLabel('Мысль или вопрос').inputValue(),
    'Этот текст должен пережить ошибку и перезагрузку.',
  );
  await page.getByRole('button', { name: 'Закрыть просмотр', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.evaluate(async () => {
    const { demoGateway: a } = await import('/src/demo.ts');
    const save = a.saveNote.bind(a),
      notes = a.notes.bind(a);
    a.notes = async (...args) => {
      if (window.__noteOffline) throw Error('Проверка без сети');
      return notes(...args);
    };
    a.saveNote = async (...args) => {
      await save(...args);
      window.__noteOffline = true;
      throw Error('Ответ о заметке потерян');
    };
  });
  await page.getByRole('button', { name: 'Открыть файл', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить запись', exact: true }).click();
  await page.getByText(/Не удалось проверить сохранение заметки/).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Проверить сохранение', exact: true }).click();
  await page.getByText('Заметка сохранена в «Мои заметки».', { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(async () => {
      const { demoGateway: a } = await import('/src/demo.ts');
      return (await a.notes('', 0)).filter((n) => n.title === 'Конспект после обрыва').length;
    }),
    1,
  );
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS upload lifecycle: manual without Gemini, interrupted request, reload and exact-file recovery, lost success reconciled once, interrupted cancellation resumed, student reads original, reader note failure/reload/lost-response recovery without duplicate, mobile',
  );
} catch (e) {
  console.error('URL', page?.url());
  console.error((await page?.locator('body').innerText())?.slice(0, 6500));
  throw e;
} finally {
  await browser.close();
}
