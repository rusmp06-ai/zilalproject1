import test from 'node:test';
import assert from 'node:assert/strict';
import { accountInput, profileName } from '../src/account';
test('profile metadata permits personal details and excludes access flags', () => {
  const input = accountInput({
    university: ' University ',
    owner: true,
    blocked: false,
    group: 'other',
  } as any);
  assert.equal(input.university, 'University');
  assert.equal('owner' in input, false);
  assert.equal('group' in input, false);
});
test('profile rejects external or active image content and oversized data', () => {
  for (const avatar of [
    'https://example.com/photo.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    `data:image/jpeg;base64,${'a'.repeat(120001)}`,
  ])
    assert.throws(() => accountInput({ avatar }));
  assert.throws(() => profileName('   '));
  assert.throws(() => accountInput({ faculty: 'a'.repeat(151) }));
  assert.equal(profileName(' Мария '), 'Мария');
});

test('account errors are actionable Russian messages without provider payloads', async () => {
  const { authError } = await import('../src/account');
  assert.match(authError({ code: 'invalid_credentials' }), /Неверная почта или пароль/);
  assert.match(authError({ code: 'email_not_confirmed' }), /Подтвердите почту/);
  assert.match(authError({ name: 'AuthRetryableFetchError' }), /Проверьте интернет/);
  assert.match(authError({ code: 'over_email_send_rate_limit' }), /Подождите/);
  assert.equal(
    authError({ code: 'private-provider-error' }),
    'Не удалось выполнить действие с аккаунтом. Попробуйте позже.',
  );
});
