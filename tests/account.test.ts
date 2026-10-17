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
