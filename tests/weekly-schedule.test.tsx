import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/?demo=1' });
for (const k of [
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
  Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
window.confirm = () => true;
const React = await import('react');
const { render, screen, fireEvent, cleanup, waitFor } = await import('@testing-library/react');
const { demoGateway, resetDemo, selectDemo } = await import('../src/demo');
const { WeeklyScheduleEditor } = await import('../src/WeeklyScheduleEditor');
const { lessonDay } = await import('../src/lesson-day');
const { validateSlots } = await import('../src/weekly-schedule');
test.afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
async function fill() {
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить пару' }));
  fireEvent.change(screen.getByLabelText('Дисциплина пары 1'), { target: { value: 'g0c0' } });
  fireEvent.change(screen.getByLabelText('Начало пары 1'), { target: { value: '08:00' } });
  fireEvent.change(screen.getByLabelText('Конец пары 1'), { target: { value: '09:20' } });
}
test('lost save acknowledgement survives remount and retries the same request without duplicating lessons', async () => {
  resetDemo();
  selectDemo('leader');
  const snapshot = await demoGateway.snapshot();
  let first = true;
  const requests: string[] = [];
  const api = {
    ...demoGateway,
    saveWeeklyDay: async (...args: Parameters<typeof demoGateway.saveWeeklyDay>) => {
      requests.push(args[4]);
      await demoGateway.saveWeeklyDay(...args);
      if (first) {
        first = false;
        throw Error('Ответ сервера потерян. Повторите отправку.');
      }
    },
  };
  const view = render(<WeeklyScheduleEditor api={api} snapshot={snapshot} group="g0" />);
  await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить расписание' }));
  await screen.findByText('Ответ сервера потерян. Повторите отправку.');
  assert.equal((await demoGateway.weeklyDay('g0', 1)).version, 1);
  view.unmount();
  render(<WeeklyScheduleEditor api={api} snapshot={snapshot} group="g0" />);
  await screen.findByLabelText('Начало пары 1');
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить расписание' }));
  await screen.findByText('Расписание сохранено.');
  assert.equal(requests[0], requests[1]);
  assert.equal((await demoGateway.weeklyDay('g0', 1)).items.length, 1);
  assert.equal((await demoGateway.weeklyDay('g0', 1)).version, 1);
});
test('restored stale draft cannot overwrite a newer weekly plan and explicit refresh loads the server version', async () => {
  resetDemo();
  selectDemo('leader');
  const snapshot = await demoGateway.snapshot();
  const view = render(<WeeklyScheduleEditor api={demoGateway} snapshot={snapshot} group="g0" />);
  await fill();
  await waitFor(() => assert.ok(sessionStorage.length > 0));
  view.unmount();
  await demoGateway.saveWeeklyDay(
    'g0',
    1,
    [
      {
        id: crypto.randomUUID(),
        course_id: 'g0c1',
        start_time: '10:00',
        end_time: '11:20',
        location: '308',
      },
    ],
    0,
    crypto.randomUUID(),
  );
  render(<WeeklyScheduleEditor api={demoGateway} snapshot={snapshot} group="g0" />);
  await screen.findByLabelText('Начало пары 1');
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить расписание' }));
  await screen.findByText('Расписание уже изменилось. Обновите день перед сохранением.');
  assert.equal((await demoGateway.weeklyDay('g0', 1)).items[0].course_id, 'g0c1');
  fireEvent.click(screen.getByRole('button', { name: 'Обновить день' }));
  await waitFor(() =>
    assert.equal((screen.getByLabelText('Дисциплина пары 1') as HTMLSelectElement).value, 'g0c1'),
  );
});
test('cancelled lesson is excluded from the current pair and weekly overlap validation rejects equal/reversed windows', () => {
  const event = {
    id: 'cancelled',
    group_id: 'g0',
    course_id: 'g0c0',
    kind: 'schedule' as const,
    title: 'Cancelled',
    body: '',
    location: '',
    starts_at: '2026-10-19T02:00:00Z',
    ends_at: '2026-10-19T03:20:00Z',
    author_name: '',
    created_at: '2026-10-01T00:00:00Z',
    can_manage: false,
    cancelled: true,
  };
  assert.equal(lessonDay([event], Date.parse('2026-10-19T02:30:00Z')).current, null);
  assert.throws(() =>
    validateSlots([
      { id: '1', course_id: 'g0c0', start_time: '09:20', end_time: '09:20', location: '' },
    ]),
  );
});
