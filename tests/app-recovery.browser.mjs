import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { browserExecutable } from './browser-runtime.mjs';
const browser = await chromium.launch({
  executablePath: browserExecutable,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(process.env.STUDY_TEST_URL || 'http://127.0.0.1:5184/?demo=1');
  await page.locator('.demo-roles').waitFor();
  await page.evaluate(async () => {
    localStorage.setItem(
      'studyhub-draft-v1:recovery-fixture',
      JSON.stringify({ body: 'private study text' }),
    );
    const { demoGateway } = await import('/src/demo.ts');
    const snapshot = demoGateway.snapshot.bind(demoGateway);
    demoGateway.snapshot = async () => {
      const state = await snapshot();
      return { ...state, me: { ...state.me, full_name: { email: 'private@example.test' } } };
    };
  });
  await page.getByRole('button', { name: 'Студент', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Не удалось открыть StudyHub' }).waitFor();
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('studyhub-draft-v1:recovery-fixture')).body,
    ),
    'private study text',
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать отчёт об ошибке' }).click();
  const file = await download;
  const stream = await file.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  const report = JSON.parse(text);
  assert.ok(report.entries.some((entry) => entry.kind === 'app-render'));
  for (const value of [
    'private@example.test',
    'private study text',
    'access_token',
    'refresh_token',
  ])
    assert.ok(!text.includes(value));
  await page.getByRole('button', { name: 'Обновить страницу', exact: true }).click();
  await page.getByRole('heading', { name: 'Ваше пространство', exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('studyhub-draft-v1:recovery-fixture')).body,
    ),
    'private study text',
  );
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  console.log(
    'PASS root render failure shows recovery UI, exports sanitized diagnostics, reload restores the app and preserves local drafts.',
  );
} finally {
  await browser.close();
}
