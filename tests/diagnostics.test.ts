import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  diagnosticEntries,
  diagnosticsReport,
  recordFailure,
  installErrorCapture,
} from '../src/diagnostics';
const dom = new JSDOM('', {
  url: 'https://app.test/?view=groups&course=private-course-id#access_token=private-token',
});
Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
test.beforeEach(() => dom.window.localStorage.clear());
test('error log captures categories without messages, identifiers, tokens or document contents', () => {
  const remove = installErrorCapture(dom.window as unknown as Window);
  dom.window.dispatchEvent(
    new dom.window.ErrorEvent('error', {
      error: new TypeError('student@example.test access_token=private-token document contents'),
    }),
  );
  const event = new dom.window.Event('unhandledrejection');
  Object.defineProperty(event, 'reason', { value: new RangeError('private document') });
  dom.window.dispatchEvent(event);
  remove();
  const entries = diagnosticEntries();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'TypeError');
  assert.equal(entries[0].view, 'groups');
  const report = JSON.stringify(diagnosticsReport());
  for (const text of [
    'student@example.test',
    'private-token',
    'document contents',
    'private-course-id',
    'private document',
  ])
    assert.ok(!report.includes(text));
});
test('stored diagnostic payloads are sanitized before export', () => {
  dom.window.localStorage.setItem(
    'studyhub-diagnostics-v1',
    JSON.stringify([
      {
        at: new Date().toISOString(),
        kind: 'window-error',
        name: 'Error',
        view: 'student@example.test',
        message: 'private document',
        token: 'private-token',
        online: true,
        count: 1,
      },
      { at: 'private-token', kind: 'window-error', name: 'Error' },
    ]),
  );
  const entries = diagnosticEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].view, 'unknown');
  assert.ok(!JSON.stringify(diagnosticsReport()).includes('private'));
});
test('error log remains bounded and repeated errors are counted', () => {
  for (let i = 0; i < 40; i++)
    recordFailure(i % 2 ? 'window-error' : 'page-render', new Error('ignored'));
  assert.equal(diagnosticEntries().length, 30);
  recordFailure('window-error', new Error('ignored'));
  assert.equal(diagnosticEntries().at(-1)?.count, 2);
});
test('unavailable localStorage cannot crash reporting', () => {
  const descriptor = Object.getOwnPropertyDescriptor(dom.window, 'localStorage')!;
  Object.defineProperty(dom.window, 'localStorage', {
    configurable: true,
    get() {
      throw Error('blocked');
    },
  });
  try {
    assert.doesNotThrow(() => recordFailure('app-render', new Error('private')));
    assert.ok(diagnosticEntries().length);
  } finally {
    Object.defineProperty(dom.window, 'localStorage', descriptor);
  }
});

test('quota-full localStorage retains new reports in memory and records the teaching route', () => {
  recordFailure('page-render', new Error('reset write fallback'));
  dom.window.localStorage.clear();
  dom.reconfigure({ url: 'https://app.test/?view=teaching' });
  const prototype = Object.getPrototypeOf(dom.window.localStorage);
  const original = prototype.setItem;
  prototype.setItem = () => {
    throw new dom.window.DOMException('full', 'QuotaExceededError');
  };
  try {
    recordFailure('app-render', new TypeError('private contents'));
    assert.equal(diagnosticEntries().at(-1)?.view, 'teaching');
    assert.equal(diagnosticEntries().at(-1)?.name, 'TypeError');
    assert.ok(!JSON.stringify(diagnosticsReport()).includes('private contents'));
  } finally {
    prototype.setItem = original;
    recordFailure('window-error', new Error('reset fallback'));
  }
});
