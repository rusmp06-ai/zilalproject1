import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Tests the Web Speech integration deterministically; headless Chromium has no installed OS voices.
  await page.addInitScript(() => {
    const engine = {
      spoken: [],
      current: null,
      pauses: 0,
      resumes: 0,
      getVoices: () => [
        { voiceURI: 'ru-local', name: 'Русский', lang: 'ru-RU', localService: true },
        { voiceURI: 'en-local', name: 'English', lang: 'en-US', localService: true },
      ],
      speak(u) {
        this.spoken.push(u);
        this.current = u;
      },
      cancel() {
        this.current = null;
      },
      pause() {
        this.pauses++;
      },
      resume() {
        this.resumes++;
      },
      addEventListener() {},
      removeEventListener() {},
    };
    window.__speech = engine;
    Object.defineProperty(window, 'speechSynthesis', { value: engine, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: class {
        constructor(text) {
          this.text = text;
        }
      },
      configurable: true,
    });
  });
  await page.goto(process.env.READER_TEST_URL || 'http://127.0.0.1:5197/?demo=1', {
    waitUntil: 'networkidle',
  });
  await page.evaluate(async () => {
    const d = await import('/src/demo.ts');
    d.resetDemo();
    d.selectDemo('owner');
    await d.demoGateway.uploadLibrary(
      'g0',
      'Учебник с озвучкой',
      new File(
        ['Глава 1. Учебный материал\n' + 'Учебная фраза для внимательного чтения. '.repeat(320)],
        'audio.txt',
        { type: 'text/plain' },
      ),
    );
  });
  await page.getByRole('button', { name: 'Студент', exact: true }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'Библиотека', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть «Учебник с озвучкой»', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Учебник с озвучкой' });
  await dialog.getByLabel('Текст страницы', { exact: true }).waitFor();
  await dialog.locator('.reader-more > summary').click();
  await dialog.getByRole('button', { name: 'Озвучка', exact: true }).click();
  await dialog.getByLabel('Скорость озвучки', { exact: true }).fill('1.5');
  await dialog.getByLabel('Голос озвучки', { exact: true }).selectOption('ru-local');
  await dialog.getByLabel('Продолжать на следующей странице').check();
  await dialog.getByRole('button', { name: 'Произнести страницу', exact: true }).click();
  await dialog.locator('.reader-spoken').waitFor();
  assert.equal(await page.evaluate(() => window.__speech.current.rate), 1.5);
  assert.equal(await page.evaluate(() => window.__speech.current.voice.voiceURI), 'ru-local');
  await dialog.getByRole('button', { name: 'Пауза', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__speech.pauses), 1);
  await dialog.getByRole('button', { name: 'Продолжить озвучку', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__speech.resumes), 1);
  await page.evaluate(() => {
    let n = 0;
    while (window.__speech.current && n++ < 100) {
      const u = window.__speech.current;
      window.__speech.current = null;
      u.onend();
    }
  });
  await dialog.getByText(/Страница 2 из/).waitFor();
  await dialog.getByRole('button', { name: 'Пауза', exact: true }).waitFor();
  assert.ok(await dialog.locator('.reader-spoken').count());
  await dialog.getByRole('button', { name: 'Следующая страница', exact: true }).click();
  await dialog.getByText(/Страница 3 из/).waitFor();
  assert.equal(
    await dialog.getByRole('button', { name: 'Остановить озвучку', exact: true }).count(),
    0,
  );
  await dialog.locator('.reader-text').evaluate((el) => {
    const r = document.createRange(),
      node = el.firstChild;
    r.setStart(node, 0);
    r.setEnd(node, 35);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await dialog
    .locator('.reader-selection')
    .getByRole('button', { name: 'Произнести выделение', exact: true })
    .click();
  await page.evaluate(() => {
    const u = window.__speech.current;
    window.__speech.current = null;
    u.onend();
  });
  assert.ok((await dialog.getByText(/Страница 3 из/).textContent()).includes('Страница 3'));
  await dialog.getByRole('button', { name: 'Настройки чтения', exact: true }).click();
  await dialog.getByLabel('Шрифт чтения', { exact: true }).selectOption('sans');
  await dialog.getByLabel('Ширина текста', { exact: true }).selectOption('52');
  assert.ok(
    (
      await dialog.locator('.reader-text').evaluate((el) => getComputedStyle(el).fontFamily)
    ).includes('Arial'),
  );
  await dialog.getByRole('button', { name: 'Закрыть просмотр', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть «Учебник с озвучкой»', exact: true }).click();
  await dialog.getByLabel('Текст страницы', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Настройки чтения', exact: true }).click();
  assert.equal(await dialog.getByLabel('Шрифт чтения', { exact: true }).inputValue(), 'sans');
  assert.equal(await dialog.getByLabel('Ширина текста', { exact: true }).inputValue(), '52');
  await dialog.locator('.reader-more > summary').click();
  await dialog.getByRole('button', { name: 'Озвучка', exact: true }).click();
  assert.equal(await dialog.getByLabel('Скорость озвучки', { exact: true }).inputValue(), '1.5');
  await dialog.getByRole('button', { name: 'Произнести страницу', exact: true }).click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      'Audio reader overflow',
    );
    assert.ok(
      await dialog.locator('.reader-document').evaluate((el) => el.clientHeight > 100),
      'Audio reader must leave space for text',
    );
  }
  await dialog.getByRole('button', { name: 'Остановить озвучку', exact: true }).click();
  await dialog.getByRole('button', { name: 'Закрыть просмотр', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__speech.current), null);
  assert.deepEqual(errors, []);
  console.log(
    'PASS speech API integration: voice/rate, pause/resume, highlighting, automatic continuation, manual navigation cancellation, selection, persisted typography, 390/320 widths; no page errors',
  );
} finally {
  await browser.close();
}
