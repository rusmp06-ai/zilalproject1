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
const { act } = await import('@testing-library/react');
Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
const { demoGateway, resetDemo, selectDemo } = await import('../src/demo');
const { isOverdue, NotificationBell, useNotifications, notifyChanged } =
  await import('../src/notifications');
test.afterEach(() => cleanup());
test('only known pending states past the exact deadline are overdue', () => {
  const now = Date.now();
  for (const status of ['not_submitted', 'returned', 'uploading', 'deleting'])
    assert.equal(isOverdue(new Date(now - 1).toISOString(), status, now), true);
  for (const status of ['submitted', 'graded', 'unknown', undefined])
    assert.equal(isOverdue(new Date(now - 1).toISOString(), status, now), false);
  assert.equal(isOverdue(new Date(now).toISOString(), 'not_submitted', now), false);
  assert.equal(isOverdue(null, 'not_submitted', now), false);
});
test('red bell caps visual count and does not change navigation button name', () => {
  render(
    <button>
      Объявления
      <NotificationBell count={105} title="Новые объявления" />
    </button>,
  );
  assert.ok(screen.getByRole('button', { name: 'Объявления', exact: true }));
  assert.ok(screen.getByText('99+'));
  assert.ok(document.querySelector('.notification-bell svg'));
});
test('demo read receipts are isolated and submitted/graded tasks clear overdue', async () => {
  resetDemo();
  selectDemo('teacher');
  await demoGateway.saveBoard({
    group: 'g0',
    course: 'g0c0',
    kind: 'announcement',
    title: 'New announcement',
    body: 'Text',
    location: '',
    start: null,
    end: null,
    id: null,
  });
  await demoGateway.createAssignment(
    'g0c0',
    'Past',
    '',
    new Date(Date.now() - 100000).toISOString(),
    100,
    true,
  );
  const task = (await demoGateway.assignments('g0c0')).items[0];
  assert.deepEqual(await demoGateway.notificationCounts(), {
    user_id: 'teacher',
    announcements: 0,
    overdue: 0,
  });
  selectDemo('student');
  assert.deepEqual(await demoGateway.notificationCounts(), {
    user_id: 'student',
    announcements: 1,
    overdue: 1,
  });
  const news = (await demoGateway.board('g0', 'announcement', null, null, 0)).items[0];
  assert.equal(news.unread, true);
  await demoGateway.markAnnouncementRead(news.id);
  assert.equal((await demoGateway.notificationCounts()).announcements, 0);
  selectDemo('leader');
  assert.equal((await demoGateway.notificationCounts()).announcements, 1);
  assert.equal((await demoGateway.notificationCounts()).overdue, 1);
  selectDemo('student');
  await demoGateway.submit(task.id, 'Answer', null);
  assert.equal((await demoGateway.notificationCounts()).overdue, 0);
  selectDemo('teacher');
  const work = (await demoGateway.works(task.id, 0))[0];
  await demoGateway.returnWork(work.id, 'Revise');
  selectDemo('student');
  assert.equal((await demoGateway.notificationCounts()).overdue, 1);
  await demoGateway.submit(task.id, 'Revised', null);
  selectDemo('teacher');
  const latest = (await demoGateway.works(task.id, 0))[0];
  await demoGateway.grade(latest.id, 90, 'Good', true);
  selectDemo('student');
  assert.equal((await demoGateway.notificationCounts()).overdue, 0);
  selectDemo('owner');
  await demoGateway.block(null, 'g0', true);
  selectDemo('student');
  assert.equal((await demoGateway.notificationCounts()).announcements, 0);
  await demoGateway.logout();
  await assert.rejects(() => demoGateway.notificationCounts());
});
function Probe({ api, user }: { api: any; user: string }) {
  const { counts, error } = useNotifications(api, user, 'overview');
  return <p>{counts ? counts.user_id + ':' + counts.announcements : error || 'loading'}</p>;
}
test('late responses from another account cannot replace the current count', async () => {
  let finishA: (v: any) => void = () => {};
  const api = {
    ...demoGateway,
    notificationCounts: () =>
      new Promise((r) => {
        finishA = r;
      }),
  };
  const view = render(<Probe api={api} user="a" />);
  const apiB = {
    ...demoGateway,
    notificationCounts: async () => ({ user_id: 'b', announcements: 2, overdue: 0 }),
  };
  view.rerender(<Probe api={apiB} user="b" />);
  await screen.findByText('b:2');
  await act(async () => finishA({ user_id: 'a', announcements: 9, overdue: 0 }));
  assert.ok(screen.getByText('b:2'));
});
test('a failed refresh hides stale counts instead of pretending they are current', async () => {
  let fail = false;
  const api = {
    ...demoGateway,
    notificationCounts: async () => {
      if (fail) throw Error('Network');
      return { user_id: 'student', announcements: 2, overdue: 0 };
    },
  };
  render(<Probe api={api} user="student" />);
  await screen.findByText('student:2');
  fail = true;
  await act(async () => notifyChanged());
  await screen.findByText('Не удалось обновить уведомления.');
  assert.equal(screen.queryByText('student:2'), null);
});
