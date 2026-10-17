import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:5203/?demo=1',
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
const { App } = await import('../src/App');
const { groupContext } = await import('../src/group-context');
const { leaderGroups } = await import('../src/leader-context');
const { LeaderAdminPanel } = await import('../src/LeaderAdminPanel');
const { demoGateway, resetDemo, selectDemo } = await import('../src/demo');
// Each test starts as a fresh visit; remounts inside a test retain their URL.
test.beforeEach(() => history.replaceState(null, '', '/?demo=1'));
test.afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 0));
  localStorage.clear();
  sessionStorage.clear();
});
test('leader study group and admin groups are separate, including multiple roles', async () => {
  resetDemo();
  selectDemo('leader');
  const snap = await demoGateway.snapshot();
  const mixed = {
    ...snap,
    groups: [...snap.groups, { id: 'other', name: 'Other', blocked: false, created_by: 'owner' }],
    memberships: [
      ...snap.memberships,
      { user_id: snap.me.id, group_id: 'other', role: 'teacher' as const, active: true },
    ],
  };
  assert.equal(groupContext(mixed, 'other').id, 'g0');
  assert.equal(groupContext(mixed).canChoose, false);
  assert.deepEqual(
    leaderGroups(mixed).map((g) => g.id),
    ['g0'],
  );
  const registered = {
    ...mixed,
    memberships: [
      ...mixed.memberships,
      { user_id: snap.me.id, group_id: 'other', role: 'student' as const, active: true },
    ],
  };
  assert.equal(groupContext(registered).id, 'other');
  assert.deepEqual(
    leaderGroups(registered).map((g) => g.id),
    ['g0'],
  );
  assert.equal(
    leaderGroups({ ...mixed, memberships: mixed.memberships.map((m) => ({ ...m, active: false })) })
      .length,
    0,
  );
});
test('leader studies without publishing controls, opens admin and returns to the same account', async () => {
  resetDemo();
  selectDemo('leader');
  render(<App />);
  await screen.findByText('Ваше пространство');
  assert.equal(screen.queryByRole('button', { name: 'Приглашения', exact: true }) === null, true);
  fireEvent.click(screen.getByRole('button', { name: 'Группы и дисциплины', exact: true }));
  assert.equal(screen.queryByLabelText('Новая дисциплина') === null, true);
  assert.equal(screen.queryByRole('button', { name: 'Снять назначение' }) === null, true);
  assert.equal(screen.queryByLabelText('Текущая группа') === null, true);
  fireEvent.click(screen.getAllByRole('button', { name: 'Открыть дисциплину' })[0]);
  fireEvent.click(await screen.findByRole('button', { name: 'Материалы', exact: true }));
  await screen.findByText('Материалов пока нет.');
  assert.equal(screen.queryByRole('button', { name: 'Опубликовать материал' }) === null, true);
  fireEvent.click(screen.getByRole('button', { name: 'Темы', exact: true }));
  assert.equal(screen.queryByRole('button', { name: 'Управлять темами' }) === null, true);
  fireEvent.click(screen.getByRole('button', { name: 'Библиотека', exact: true }));
  await screen.findByText('Как пользоваться общей библиотекой');
  assert.equal(screen.queryByLabelText('Название материала') === null, true);
  assert.equal(
    screen.queryByRole('button', { name: 'Добавить материал', exact: true }) === null,
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Расписание', exact: true }));
  await waitFor(() => assert.equal(screen.queryByText('Загружаем расписание…') === null, true));
  assert.equal(screen.queryByRole('button', { name: 'Управление занятиями' }) === null, true);
  fireEvent.click(screen.getByRole('button', { name: 'Объявления', exact: true }));
  await waitFor(() => assert.equal(screen.queryByText('Загрузка…') === null, true));
  assert.equal(screen.queryByLabelText('Заголовок объявления') === null, true);
  fireEvent.click(screen.getByRole('button', { name: 'Открыть админ' }));
  await screen.findByText('Староста · студент');
  assert.ok(screen.getByRole('button', { name: 'Приглашения', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Дисциплины и преподаватели' }));
  assert.ok(screen.getByLabelText('Новая дисциплина'));
  fireEvent.click(screen.getByRole('button', { name: 'К учебному пространству' }));
  await screen.findByText('Ваше пространство');
  assert.equal((await demoGateway.snapshot()).me.id, 'leader');
  assert.equal(screen.queryByLabelText('Новая дисциплина') === null, true);
});
test('leader submits own assignment and cannot read or grade student work', async () => {
  resetDemo();
  selectDemo('teacher');
  await demoGateway.createAssignment(
    'g0c0',
    'Личная работа старосты',
    'Ответьте на вопрос',
    null,
    100,
    false,
  );
  const task = (await demoGateway.assignments('g0c0')).items[0];
  selectDemo('student');
  await demoGateway.submit(task.id, 'Чужая работа', null);
  const other = (await demoGateway.works(task.id, 0))[0];
  selectDemo('leader');
  render(<App />);
  await screen.findByText('Ваше пространство');
  fireEvent.click(screen.getByRole('button', { name: 'Группы и дисциплины', exact: true }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Открыть дисциплину' })[0]);
  fireEvent.click(await screen.findByRole('button', { name: 'Задания', exact: true }));
  fireEvent.change(await screen.findByLabelText('Выберите задание'), {
    target: { value: task.id },
  });
  fireEvent.change(await screen.findByLabelText('Ваш ответ'), {
    target: { value: 'Мой ответ старосты' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Отправить работу' }));
  await screen.findByText('Работа отправлена на проверку.');
  assert.equal(screen.queryByText('Чужая работа') === null, true);
  assert.equal(screen.queryByRole('button', { name: 'Создать задание' }) === null, true);
  assert.equal(screen.queryByLabelText('Балл') === null, true);
  assert.equal((await demoGateway.works(task.id, 0))[0].student_id, 'leader');
  await assert.rejects(() => demoGateway.grade(other.id, 50, '', true));
  const roster = await demoGateway.groupMembers('g0', 0);
  assert.ok(roster.some((m) => m.full_name === 'Студент'));
  await assert.rejects(() => demoGateway.groupMembers('g1', 0));
  selectDemo('student');
  await assert.rejects(() => demoGateway.groupMembers('g0', 0));
  assert.equal((await demoGateway.works(task.id, 0))[0].text_answer, 'Чужая работа');
});
test('missing roster RPC reports prerequisite while other admin sections still work', async () => {
  resetDemo();
  selectDemo('leader');
  const snap = await demoGateway.snapshot(),
    api = {
      ...demoGateway,
      groupMembers: async () => {
        throw Object.assign(Error('not found'), { code: 'PGRST202' });
      },
    };
  render(
    <LeaderAdminPanel api={api} snapshot={snap} onChanged={async () => {}} onStudy={() => {}} />,
  );
  await screen.findByRole('alert');
  assert.match(screen.getByRole('alert').textContent || '', /v0.23/);
  fireEvent.click(screen.getByRole('button', { name: 'Расписание', exact: true }));
  await screen.findByRole('button', { name: 'Добавить пару', exact: true });
});

test('dual-role study view finds personal attempts beyond other students and hides draft grades', async () => {
  const { studyWorks } = await import('../src/AssignmentsPanel');
  const other = {
    id: 'other',
    student_id: 'student',
    released_at: null,
    score: 90,
    feedback: 'Draft',
  };
  const own = { ...other, id: 'own', student_id: 'leader' };
  const api = {
    ...demoGateway,
    works: async (_id: string, offset: number) =>
      (offset === 0
        ? Array.from({ length: 50 }, (_, i) => ({ ...other, id: String(i) }))
        : [own]) as any,
  };
  const rows = await studyWorks(api, 'task', 'leader', 0, true, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].student_id, 'leader');
  assert.equal(rows[0].score, null);
  assert.equal(rows[0].feedback, null);
});

test('revoking leadership removes the admin forms on refreshed snapshot', async () => {
  resetDemo();
  selectDemo('leader');
  const snap = await demoGateway.snapshot();
  const props = { api: demoGateway, snapshot: snap, onChanged: async () => {}, onStudy: () => {} };
  const view = render(<LeaderAdminPanel {...props} />);
  await screen.findByText('Староста · студент');
  fireEvent.click(screen.getByRole('button', { name: 'Дисциплины и преподаватели' }));
  assert.ok(screen.getByLabelText('Новая дисциплина'));
  view.rerender(
    <LeaderAdminPanel
      {...props}
      snapshot={{ ...snap, memberships: snap.memberships.filter((m) => m.user_id !== snap.me.id) }}
    />,
  );
  await screen.findByText(
    'Полномочий для управления нет. Обновите данные или обратитесь к владельцу.',
  );
  assert.equal(screen.queryByLabelText('Новая дисциплина') === null, true);
  assert.equal(screen.queryByRole('navigation', { name: 'Разделы админа' }) === null, true);
});
