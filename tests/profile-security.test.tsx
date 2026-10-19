import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:5204/?demo=1',
});
for (const key of [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'location',
  'history',
  'HTMLElement',
  'HTMLInputElement',
  'MutationObserver',
  'DOMParser',
  'FormData',
])
  Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, screen, cleanup, waitFor, fireEvent, within } =
  await import('@testing-library/react');
const { ProfilePanel } = await import('../src/ProfilePanel');
const { demoGateway, selectDemo } = await import('../src/demo');
test('password confirmation rejects mismatch and clears inputs only after successful update', async () => {
  selectDemo('student');
  const snapshot = await demoGateway.snapshot();
  const calls: string[][] = [];
  render(
    React.createElement(ProfilePanel, {
      api: {
        ...demoGateway,
        demo: false,
        changePassword: async (a: string, b: string) => {
          calls.push([a, b]);
        },
      },
      snapshot,
      onSaved: async () => {},
      onShelf: () => {},
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Безопасность', exact: true }));
  fireEvent.change(screen.getByLabelText('Текущий пароль'), { target: { value: 'oldpassword' } });
  fireEvent.change(screen.getByLabelText('Новый пароль', { exact: true }), {
    target: { value: 'newpassword123' },
  });
  fireEvent.change(screen.getByLabelText('Повторите новый пароль'), {
    target: { value: 'differentpassword' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Изменить пароль', exact: true }));
  await screen.findByText('Новые пароли не совпадают.');
  assert.equal(calls.length, 0);
  fireEvent.change(screen.getByLabelText('Повторите новый пароль'), {
    target: { value: 'newpassword123' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Изменить пароль', exact: true }));
  await screen.findByText('Пароль изменён.');
  assert.deepEqual(calls, [['oldpassword', 'newpassword123']]);
  assert.equal((screen.getByLabelText('Текущий пароль') as HTMLInputElement).value, '');
  cleanup();
});

test('profile load can be retried and unsaved edits or pending saves cannot silently disappear', async () => {
  selectDemo('student');
  const snapshot = await demoGateway.snapshot();
  let loads = 0,
    saved = 0,
    finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const account = await demoGateway.account();
  const api = {
    ...demoGateway,
    account: async () => {
      if (++loads === 1) throw Error('Временный сбой');
      return account;
    },
    saveAccount: async () => {
      saved++;
      await pending;
    },
  };
  const { mayLeaveDrafts } = await import('../src/drafts');
  const confirm = window.confirm,
    alert = window.alert;
  let confirmations = 0;
  window.confirm = () => {
    confirmations++;
    return false;
  };
  window.alert = () => {};
  try {
    render(
      React.createElement(ProfilePanel, {
        api,
        snapshot,
        onSaved: async () => {},
        onShelf: () => {},
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить загрузку профиля' }));
    const input = await screen.findByLabelText('Имя и фамилия');
    assert.equal(loads, 2);
    assert.equal(screen.queryByText('Временный сбой'), null);
    assert.equal(mayLeaveDrafts(), true);
    fireEvent.change(input, { target: { value: 'Новое имя' } });
    assert.equal(mayLeaveDrafts(), false);
    assert.equal(confirmations, 1);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить профиль', exact: true }));
    assert.equal(mayLeaveDrafts(), false);
    assert.equal(confirmations, 1);
    assert.equal(
      (screen.getByRole('button', { name: 'Безопасность', exact: true }) as HTMLButtonElement)
        .disabled,
      true,
    );
    finish();
    await screen.findByText('Профиль сохранён.');
    assert.equal(saved, 1);
    assert.equal(mayLeaveDrafts(), true);
    assert.equal(confirmations, 1);
  } finally {
    finish();
    cleanup();
    window.confirm = confirm;
    window.alert = alert;
  }
});
