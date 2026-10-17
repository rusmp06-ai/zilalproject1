import test from 'node:test';
import assert from 'node:assert/strict';
import { readRoute, routeURL } from '../src/navigation';

test('course, assignment and book routes round trip without titles or user data', () => {
  const base = new URL('https://study.example/?demo=1');
  for (const route of [
    { tab: 'library', book: 'book-123' },
    { tab: 'groups', course: 'g0c0', section: 'assignment' as const, task: 'task-123' },
    { tab: 'groups', course: 'g0c0', section: 'notes' as const },
    { tab: 'schedule' },
    { tab: 'groups', course: 'g0c0', section: 'materials' as const, material: 'file-123' },
  ]) {
    const url = routeURL(route, base),
      read = readRoute(url);
    assert.equal(read.invalid, false);
    for (const [k, v] of Object.entries(route)) assert.equal((read as any)[k], v);
  }
});

test('navigation preserves invitation and auth fragments, demo mode and unrelated parameters', () => {
  for (const hash of ['#invite=opaque-token', '#access_token=opaque-token&type=recovery']) {
    const base = new URL('https://study.example/?demo=1&lang=ru' + hash),
      url = routeURL({ tab: 'notes' }, base);
    assert.equal(url.hash, hash);
    assert.equal(url.searchParams.get('demo'), '1');
    assert.equal(url.searchParams.get('lang'), 'ru');
    assert.equal(url.searchParams.get('view'), 'notes');
    assert.equal(url.pathname, '/');
  }
});

test('malformed and ambiguous routes are unavailable rather than interpreted as another resource', () => {
  for (const query of [
    'view=library&material=file',
    'view=groups&course=g0c0&material=../file',
    'view=groups&course=g0c0&material=a&material=b',
    'view=unknown',
    'view=groups&course=../private',
    'view=groups&course=g0c0&section=invalid',
    'view=library&task=task',
    'view=groups&course=g0c0&task=task',
    'view=notes&book=book',
    'view=library&view=groups',
    'view=groups&course=g0c0&course=g1c1',
    'section=notes',
    'view=groups&course=' + 'x'.repeat(129),
  ])
    assert.equal(readRoute(new URL('https://study.example/?' + query)).invalid, true, query);
});

test('returning to home clears only route fields', () => {
  const url = routeURL(
    { tab: 'overview' },
    new URL(
      'https://study.example/?demo=1&view=groups&course=g0c0&section=assignment&task=task#invite=token',
    ),
  );
  assert.equal(url.search, '?demo=1');
  assert.equal(url.hash, '#invite=token');
  assert.deepEqual(readRoute(url), {
    tab: 'overview',
    course: undefined,
    section: undefined,
    task: undefined,
    book: undefined,
    invalid: false,
  });
});

test('display choices stay with their section and do not leak to another course', () => {
  const base = new URL(
    'https://study.example/?demo=1&view=groups&course=g0c0&section=materials&ui_query=lecture&ui_topic=t1',
  );
  assert.equal(
    routeURL(
      { tab: 'groups', course: 'g0c0', section: 'materials', material: 'm1' },
      base,
    ).searchParams.get('ui_query'),
    'lecture',
  );
  assert.equal(
    routeURL({ tab: 'groups', course: 'g1c0' }, base).searchParams.has('ui_query'),
    false,
  );
  assert.equal(routeURL({ tab: 'library' }, base).searchParams.has('ui_topic'), false);
});

test('invalid calendar dates fall back safely without throwing', async () => {
  const { validDate } = await import('../src/view-state');
  for (const date of [
    '2026-13-01',
    '2026-02-30',
    '2026-00-10',
    '2026-11-31',
    '2026-02-29',
    'abc',
    '9999-01-01',
  ])
    assert.equal(validDate(date), false, date);
  for (const date of ['2026-11-19', '2028-02-29']) assert.equal(validDate(date), true, date);
});
