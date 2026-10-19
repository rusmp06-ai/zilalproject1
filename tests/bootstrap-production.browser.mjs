import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { browserExecutable } from './browser-runtime.mjs';
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({
  executablePath: browserExecutable,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 740 } });
  await page.route('**/assets/index-*.js', (route) => route.abort('failed'));
  const url = process.env.BOOTSTRAP_PRODUCTION_URL || 'http://127.0.0.1:4180/?demo=1';
  await page.goto(url);
  await page.getByRole('region', { name: 'Загрузка StudyHub' }).waitFor();
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.unroute('**/assets/index-*.js');
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await page.locator('.demo-roles').waitFor();
  await page.getByRole('button', { name: 'Студент', exact: true }).click();
  await page.getByRole('heading', { name: 'Ваше пространство', exact: true }).waitFor();
  const response = await page.request.get(new URL('/build-info.json', url).href);
  assert.equal(response.status(), 200);
  const info = await response.json();
  assert.equal(info.version, version);
  assert.ok(Number.isFinite(Date.parse(info.builtAt)));
  assert.ok(info.commit === null || /^[a-f0-9]{40}$/.test(info.commit));
  console.log(
    'PASS compiled bootstrap failure is recoverable at 320px; reload loads the app; public build metadata identifies the expected version without credentials.',
  );
} finally {
  await browser.close();
}
