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
const { App } = await import('../src/App');
const { OwnerAdminPanel } = await import('../src/OwnerAdminPanel');
const { ownerSummary } = await import('../src/OwnerOverview');
const { catalogPages } = await import('../src/catalog-pages');
const { demoGateway, resetDemo, selectDemo } = await import('../src/demo');
// Each test starts as a fresh visit; remounts inside a test retain their URL.
test.beforeEach(() => history.replaceState(null, '', '/?demo=1'));
test.afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 0));
  localStorage.clear();
  sessionStorage.clear();
});
async function openAdmin(section: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Открыть админ', exact: true }));
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Разделы владельца' })).getByRole('button', {
      name: section,
      exact: true,
    }),
  );
}
test('owner summary counts unique people and includes leaders among students', async () => {
  resetDemo();
  selectDemo('owner');
  const s = await demoGateway.snapshot();
  s.memberships.push({ user_id: 'leader', group_id: 'g0', role: 'student', active: true });
  s.courses[0].archived = true;
  const summary = ownerSummary(s);
  assert.equal(summary.students, 2);
  assert.equal(summary.leaders, 1);
  assert.equal(summary.teachers, 1);
  assert.equal(summary.courses, 7);
  assert.equal(summary.withoutLeader.length, 3);
});
test('full catalog reaches accounts beyond a single server page and never returns partial totals', async () => {
  const accounts = Array.from({ length: 1001 }, (_, id) => ({ id }));
  assert.deepEqual(
    await catalogPages(async (offset, limit) => accounts.slice(offset, offset + limit)),
    accounts,
  );
  await assert.rejects(
    () =>
      catalogPages(async (offset, limit) => {
        if (offset >= 500) throw Error('Connection lost');
        return accounts.slice(offset, offset + limit);
      }),
    /Connection lost/,
  );
});
test('owner overview separates project administration from personal reading', async () => {
  resetDemo();
  selectDemo('owner');
  render(<App />);
  await screen.findByRole('heading', { name: 'Обзор проекта', exact: true });
  const nav = screen.getByRole('button', { name: 'Админ', exact: true });
  assert.ok(nav);
  assert.equal(
    screen.queryByRole('button', { name: 'Управление доступом', exact: true }) === null,
    true,
  );
  assert.equal(
    screen.queryByRole('button', { name: 'Группы и дисциплины', exact: true }) === null,
    true,
  );
  assert.equal(screen.queryByLabelText('Название группы') === null, true);
  fireEvent.click(screen.getByRole('button', { name: 'Библиотека', exact: true }));
  await screen.findByText('Как пользоваться общей библиотекой');
  assert.equal(screen.queryByLabelText('Название материала') === null, true);
  assert.equal(screen.queryByRole('button', { name: 'Удалить', exact: true }) === null, true);
  await openAdmin('Публикации в библиотеке');
  await screen.findByLabelText('Название материала');
  assert.ok(screen.getByRole('button', { name: 'Удалить', exact: true }));
});
test('blocking requires explicit confirmation, can be cancelled and records no private data', async () => {
  resetDemo();
  selectDemo('owner');
  render(<App />);
  await screen.findByRole('heading', { name: 'Обзор проекта', exact: true });
  await openAdmin('Участники и роли');
  const article = screen.getByRole('heading', { name: 'Студент', exact: true }).closest('article')!;
  fireEvent.click(within(article).getByRole('button', { name: 'Заблокировать' }));
  assert.equal(
    (await demoGateway.snapshot()).profiles.find((p) => p.id === 'student')!.blocked,
    false,
  );
  fireEvent.click(within(article).getByRole('button', { name: 'Отмена', exact: true }));
  assert.equal((await demoGateway.auditEvents(0)).length, 0);
  fireEvent.click(within(article).getByRole('button', { name: 'Заблокировать' }));
  fireEvent.click(within(article).getByRole('button', { name: 'Подтвердить блокировку' }));
  await screen.findByText('Статус аккаунта изменён.');
  assert.equal(
    (await demoGateway.snapshot()).profiles.find((p) => p.id === 'student')!.blocked,
    true,
  );
  const events = await demoGateway.auditEvents(0);
  assert.equal(events[0].actor_id, 'owner');
  assert.equal(events[0].entity_id, 'student');
  assert.deepEqual(events[0].details, { blocked: true });
  const me = screen
    .getByRole('heading', { name: 'Владелец платформы', exact: true })
    .closest('article')!;
  assert.equal(within(me).queryByRole('button', { name: 'Заблокировать' }) === null, true);
});
test('role filters include leader in students and show a teacher once across groups', async () => {
  resetDemo();
  selectDemo('owner');
  render(<App />);
  await screen.findByRole('heading', { name: 'Обзор проекта', exact: true });
  await openAdmin('Участники и роли');
  fireEvent.change(screen.getByLabelText('Роль участника'), { target: { value: 'student' } });
  assert.equal(document.querySelectorAll('.owner-account-list article').length, 2);
  fireEvent.change(screen.getByLabelText('Роль участника'), { target: { value: 'teacher' } });
  assert.equal(document.querySelectorAll('.owner-account-list article').length, 1);
  assert.equal(document.querySelectorAll('.owner-memberships li').length, 2);
  fireEvent.change(screen.getByLabelText('Группа участника'), { target: { value: 'g3' } });
  assert.equal(document.querySelectorAll('.owner-account-list article').length, 0);
});
test('owner invitation and history are scoped to owner; tokens never enter the audit', async () => {
  resetDemo();
  selectDemo('owner');
  const token = await demoGateway.invite('leader', null, [], 1);
  assert.equal((await demoGateway.auditEvents(0))[0].action, 'invitation.created');
  assert.equal(JSON.stringify(await demoGateway.auditEvents(0)).includes(token), false);
  selectDemo('leader');
  await assert.rejects(() => demoGateway.auditEvents(0));
  const s = await demoGateway.snapshot();
  render(
    <OwnerAdminPanel
      api={demoGateway}
      snapshot={s}
      onChanged={async () => {}}
      onOverview={() => {}}
    />,
  );
  await screen.findByRole('alert');
  assert.equal(screen.queryByRole('navigation', { name: 'Разделы владельца' }) === null, true);
  assert.equal(screen.queryByLabelText('Название группы') === null, true);
});
test('owner can manage a different group without changing their personal account', async () => {
  resetDemo();
  selectDemo('owner');
  render(<App />);
  await screen.findByRole('heading', { name: 'Обзор проекта', exact: true });
  await openAdmin('Дисциплины и преподаватели');
  fireEvent.change(screen.getByLabelText('Рабочая группа'), { target: { value: 'g2' } });
  fireEvent.change(screen.getByLabelText('Новая дисциплина'), {
    target: { value: 'Управление финансами' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Добавить дисциплину' }));
  await screen.findByText('Дисциплина создана.');
  assert.ok(
    (await demoGateway.snapshot()).courses.some(
      (c) => c.title === 'Управление финансами' && c.group_id === 'g2',
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'К обзору проекта' }));
  await screen.findByRole('heading', { name: 'Обзор проекта', exact: true });
  assert.equal((await demoGateway.snapshot()).me.id, 'owner');
});

test('owner operations loads requests across every group and every page, keeping partial failures explicit', async () => {
  const { loadOwnerOperations } = await import('../src/owner-operations');
  resetDemo();
  selectDemo('owner');
  const snapshot = await demoGateway.snapshot();
  const calls: string[] = [];
  const api = {
    ...demoGateway,
    groupRequests: async (group: string | null, offset: number) => {
      calls.push(group + ':' + offset);
      if (group === 'g1') throw Error('Offline');
      if (group !== 'g0') return [];
      return Array.from({ length: offset === 0 ? 50 : 1 }, (_, i) => ({
        user_id: 'new-' + (offset + i),
        group_id: 'g0',
        full_name: 'New student',
        status: 'pending',
        created_at: '2026-10-01T00:00:00Z',
      }));
    },
    invitationCatalog: async () => {
      throw Error('Offline');
    },
  };
  const result = await loadOwnerOperations(api, snapshot);
  assert.equal(result.requests.length, 51);
  assert.equal(result.requestsComplete, false);
  assert.equal(result.invitations, null);
  assert.ok(result.issues.some((issue) => issue.includes('ИФ-2-24')));
  assert.ok(calls.includes('g0:50'));
  assert.ok(calls.includes('g3:0'));
  const nonOwner = { ...snapshot, owner: false };
  let reads = 0;
  await assert.rejects(
    () =>
      loadOwnerOperations(
        {
          ...api,
          groupRequests: async () => {
            reads++;
            return [];
          },
        },
        nonOwner,
      ),
    /владельцу/,
  );
  assert.equal(reads, 0);
});

test('owner queue confirms decisions, preserves failed requests and retries successfully', async () => {
  const { OwnerOperations } = await import('../src/OwnerOperations');
  resetDemo();
  selectDemo('owner');
  const snapshot = await demoGateway.snapshot();
  let pending = true,
    fail = true,
    writes = 0;
  const api = {
    ...demoGateway,
    groupRequests: async (group: string | null) =>
      group === 'g2' && pending
        ? [
            {
              user_id: 'new',
              group_id: 'g2',
              full_name: 'Новый участник',
              status: 'pending',
              created_at: '2026-10-01T00:00:00Z',
            },
          ]
        : [],
    resolveGroupRequest: async (user: string, group: string, approve: boolean) => {
      writes++;
      assert.equal(user, 'new');
      assert.equal(group, 'g2');
      assert.equal(approve, true);
      if (fail) throw Error('Заявка не передана');
      pending = false;
    },
  };
  render(<OwnerOperations api={api} snapshot={snapshot} queue onChanged={async () => {}} />);
  await screen.findByRole('heading', { name: 'Новый участник' });
  const confirm = window.confirm;
  window.confirm = () => false;
  fireEvent.click(screen.getByRole('button', { name: 'Принять студента' }));
  assert.equal(writes, 0);
  window.confirm = () => true;
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Принять студента' }));
    await screen.findByText('Заявка не передана');
    assert.ok(screen.getByRole('heading', { name: 'Новый участник' }));
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Принять студента' }));
    await screen.findByText('Студент принят в группу.');
    await screen.findByText('Ожидающих заявок нет.');
    assert.equal(writes, 2);
  } finally {
    window.confirm = confirm;
  }
});

test('owner directory finds IDs, distinguishes inactive membership, shows inherited restrictions and excludes owner from ungrouped', async () => {
  resetDemo();
  selectDemo('owner');
  const snapshot = await demoGateway.snapshot();
  snapshot.profiles.push({ id: 'new-person', full_name: 'Без группы', blocked: false });
  snapshot.memberships.push({
    user_id: 'new-person',
    group_id: 'g3',
    role: 'student',
    active: false,
  });
  snapshot.groups[0].blocked = true;
  snapshot.denials.push({
    id: 'restriction',
    group_id: 'g0',
    user_id: null,
    section: 'schedule',
    course_id: null,
  });
  render(
    <OwnerAdminPanel
      api={demoGateway}
      snapshot={snapshot}
      initialSection="accounts"
      onChanged={async () => {}}
      onOverview={() => {}}
    />,
  );
  fireEvent.change(await screen.findByLabelText('Доступ аккаунта'), {
    target: { value: 'ungrouped' },
  });
  assert.equal(document.querySelectorAll('.owner-account-list article').length, 1);
  assert.ok(screen.getByRole('heading', { name: 'Без группы' }));
  fireEvent.click(screen.getByRole('button', { name: 'Подробнее об аккаунте' }));
  await screen.findByText(/членство отключено/);
  fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
  fireEvent.change(screen.getByLabelText('Поиск участника'), { target: { value: 'student' } });
  assert.equal(document.querySelectorAll('.owner-account-list article').length, 1);
  fireEvent.click(screen.getByRole('button', { name: 'Подробнее об аккаунте' }));
  await screen.findByText('Расписание · для группы ИФ-1-24');
  await screen.findByText(/группа закрыта/);
  fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
  fireEvent.change(screen.getByLabelText('Роль участника'), { target: { value: 'owner' } });
  assert.equal(document.querySelectorAll('.owner-account-list article').length, 1);
  assert.ok(screen.getByRole('heading', { name: 'Владелец платформы' }));
});

test('owner health does not report unknown requests or invitations as zero', async () => {
  const { OwnerOperations } = await import('../src/OwnerOperations');
  resetDemo();
  selectDemo('owner');
  const snapshot = await demoGateway.snapshot();
  const api = {
    ...demoGateway,
    groupRequests: async () => {
      throw Error('Offline');
    },
    invitationCatalog: async () => {
      throw Error('Offline');
    },
    library: async () => {
      throw Error('Offline');
    },
  };
  render(<OwnerOperations api={api} snapshot={snapshot} />);
  await screen.findByText('Не все проверены');
  assert.equal(screen.queryByText('Ожидающих заявок нет.'), null);
  assert.equal(screen.getAllByText('Нет данных').length, 2);
});

test('teacher details load all assignment pages and never show a partial list as complete', async () => {
  const { OwnerTeaching } = await import('../src/OwnerTeaching');
  resetDemo();
  selectDemo('owner');
  const snapshot = await demoGateway.snapshot();
  let fail = false;
  const calls: string[] = [];
  const api = {
    ...demoGateway,
    teachingCatalog: async (group: string, offset: number) => {
      calls.push(group + ':' + offset);
      if (fail && group === 'g1') throw Error('Offline');
      if (group === 'g0' && !offset)
        return Array.from({ length: 50 }, (_, i) => ({
          teacher_id: 'other',
          teacher_name: 'Other',
          course_id: 'c' + i,
        }));
      if (group === 'g0')
        return [{ teacher_id: 'teacher', teacher_name: 'Teacher', course_id: 'g0c0' }];
      return [];
    },
  };
  const r = render(<OwnerTeaching api={api} snapshot={snapshot} user="teacher" />);
  await screen.findByText('Корпоративные финансы · ИФ-1-24');
  assert.ok(calls.includes('g0:50'));
  r.unmount();
  fail = true;
  render(<OwnerTeaching api={api} snapshot={snapshot} user="teacher" />);
  await screen.findByText('Назначения преподавателя не удалось загрузить.');
  assert.equal(screen.queryByText('Корпоративные финансы · ИФ-1-24'), null);
  assert.equal(screen.queryByText('Дисциплины не назначены.'), null);
});

test('a confirmed request remains confirmed when refreshing users fails', async () => {
  const { OwnerOperations } = await import('../src/OwnerOperations');
  resetDemo();
  selectDemo('owner');
  const snapshot = await demoGateway.snapshot();
  let pending = true;
  const api = {
    ...demoGateway,
    groupRequests: async (group: string | null) =>
      group === 'g0' && pending
        ? [
            {
              user_id: 'new',
              group_id: 'g0',
              full_name: 'Новый участник',
              status: 'pending',
              created_at: '2026-10-01T00:00:00Z',
            },
          ]
        : [],
    resolveGroupRequest: async () => {
      pending = false;
    },
  };
  const confirm = window.confirm;
  window.confirm = () => true;
  try {
    render(
      <OwnerOperations
        api={api}
        snapshot={snapshot}
        queue
        onChanged={async () => {
          throw Error('Refresh failed');
        }}
      />,
    );
    await screen.findByRole('heading', { name: 'Новый участник' });
    fireEvent.click(screen.getByRole('button', { name: 'Принять студента' }));
    await screen.findByText('Ожидающих заявок нет.');
    assert.ok(screen.getByText('Студент принят в группу.'));
    assert.ok(
      screen.getByText(
        'Заявка обработана, но список пользователей не обновился. Обновите страницу.',
      ),
    );
  } finally {
    window.confirm = confirm;
  }
});

test('owner creation stays confirmed when snapshot refresh fails, but an unsuccessful refresh never reports fresh users', async () => {
  resetDemo();
  selectDemo('owner');
  const snapshot = await demoGateway.snapshot();
  let writes = 0;
  const api = {
    ...demoGateway,
    createGroup: async () => {
      writes++;
    },
  };
  const r = render(
    <OwnerAdminPanel
      api={api}
      snapshot={snapshot}
      onChanged={async () => {
        throw Error('Refresh failed');
      }}
      onOverview={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText('Название группы'), { target: { value: 'New group' } });
  fireEvent.click(screen.getByRole('button', { name: 'Создать группу' }));
  await screen.findByText('Группа создана.');
  await screen.findByText(
    'Изменение сохранено, но данные не обновились. Обновите страницу; повторять действие не нужно.',
  );
  assert.equal(writes, 1);
  r.unmount();
  render(
    <OwnerAdminPanel
      api={api}
      snapshot={snapshot}
      initialSection="accounts"
      onChanged={async () => {
        throw Error('Refresh failed');
      }}
      onOverview={() => {}}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Обновить пользователей' }));
  await screen.findByText('Refresh failed');
  assert.equal(screen.queryByText('Список пользователей обновлён.'), null);
});
