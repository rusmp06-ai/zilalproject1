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
  await page.goto(process.env.PROFILE_TEST_URL || 'http://127.0.0.1:5205/?demo=1');
  await page.locator('.demo-roles').getByRole('button', { name: 'Студент', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть профиль' }).click();
  const profile = page.getByRole('region', { name: 'Личный профиль' });
  await profile.getByLabel('Имя и фамилия').fill('Мария Иванова');
  await profile.getByLabel('Университет', { exact: true }).fill('Учебный университет');
  await profile.getByLabel('Курс', { exact: true }).fill('2');
  await profile.getByLabel('Фото профиля', { exact: true }).setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: await page.screenshot({ clip: { x: 0, y: 0, width: 16, height: 16 } }),
  });
  await profile.getByRole('img', { name: 'Фото профиля' }).waitFor();
  await profile.getByRole('button', { name: 'Сохранить профиль', exact: true }).click();
  await profile.getByRole('status').filter({ hasText: 'Профиль сохранён' }).waitFor();
  assert.equal(await profile.getByRole('combobox').count(), 0);
  await page.reload();
  await page.getByRole('button', { name: 'Открыть профиль' }).click();
  await profile.getByLabel('Имя и фамилия').waitFor();
  assert.equal(await profile.getByLabel('Имя и фамилия').inputValue(), 'Мария Иванова');
  assert.equal(
    await profile.getByLabel('Университет', { exact: true }).inputValue(),
    'Учебный университет',
  );
  assert.equal(await profile.getByRole('img').count(), 1);
  await profile.getByRole('button', { name: 'Безопасность', exact: true }).click();
  await profile.getByText('Смена пароля доступна в настоящем аккаунте.').waitFor();
  assert.equal(await profile.locator('input[type=password]').count(), 0);
  await page.locator('.demo-roles').getByRole('button', { name: 'Староста', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть профиль' }).click();
  await profile.getByText('Студент · Староста', { exact: true }).waitFor();
  assert.notEqual(await profile.getByLabel('Имя и фамилия').inputValue(), 'Мария Иванова');
  assert.equal(await profile.getByRole('img').count(), 0);
  await page.setViewportSize({ width: 320, height: 850 });
  await page.screenshot({ path: '/tmp/studyhub-profile-mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log(
    'PASS profile save/reload, photo processing, account isolation, fixed roles and group, demo security guard, mobile width',
  );
} finally {
  await browser.close();
}
