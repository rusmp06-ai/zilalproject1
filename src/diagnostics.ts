type FailureKind = 'page-render' | 'app-render' | 'window-error' | 'unhandled-rejection';
type FailureName =
  | 'Error'
  | 'TypeError'
  | 'RangeError'
  | 'SyntaxError'
  | 'NetworkError'
  | 'AbortError';
type Entry = {
  at: string;
  kind: FailureKind;
  name: FailureName;
  view: string;
  online: boolean;
  count: number;
};
const key = 'studyhub-diagnostics-v1';
const kinds = new Set(['page-render', 'app-render', 'window-error', 'unhandled-rejection']);
const names = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'NetworkError',
  'AbortError',
]);
const views = new Set([
  'overview',
  'groups',
  'tasks',
  'calendar',
  'notes',
  'schedule',
  'library',
  'announcements',
  'profile',
  'offline',
  'search',
  'admin',
  'journal',
  'teaching',
]);
let memory: Entry[] = [];
let writeFailed = false;
function storage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
function safeEntry(value: unknown): Entry | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(input.at) ||
    !Number.isFinite(Date.parse(input.at)) ||
    !kinds.has(String(input.kind)) ||
    !names.has(String(input.name))
  )
    return null;
  return {
    at: input.at,
    kind: input.kind as FailureKind,
    name: input.name as FailureName,
    view: views.has(String(input.view)) ? String(input.view) : 'unknown',
    online: input.online === true,
    count:
      typeof input.count === 'number' && Number.isInteger(input.count) && input.count > 0
        ? Math.min(input.count, 1000)
        : 1,
  };
}
export function diagnosticEntries(): Entry[] {
  if (writeFailed) return memory.map((entry) => ({ ...entry }));
  try {
    const store = storage();
    const raw = store?.getItem(key);
    if (store && !raw) return [];
    if (raw) {
      if (raw.length > 32768) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed))
        return parsed
          .map(safeEntry)
          .filter((value): value is Entry => !!value)
          .slice(-30);
    }
  } catch {
    /* Device storage is optional, especially in private browsing. */
  }
  return memory.map((entry) => ({ ...entry }));
}
export function recordFailure(kind: FailureKind, error: unknown) {
  try {
    let view = 'unknown';
    try {
      const current = new URL(window.location.href).searchParams.get('view') || 'overview';
      if (views.has(current)) view = current;
    } catch {
      /* No browser location. */
    }
    let name: FailureName = 'Error';
    try {
      if (error && typeof error === 'object' && 'name' in error && names.has(String(error.name)))
        name = error.name as FailureName;
    } catch {
      /* Never inspect arbitrary error payloads. */
    }
    const entries = diagnosticEntries();
    const entry: Entry = {
      at: new Date().toISOString(),
      kind,
      name,
      view,
      online: typeof navigator !== 'undefined' && navigator.onLine,
      count: 1,
    };
    const previous = entries.at(-1);
    if (
      previous &&
      previous.kind === kind &&
      previous.name === name &&
      previous.view === view &&
      Date.parse(entry.at) >= Date.parse(previous.at) &&
      Date.parse(entry.at) - Date.parse(previous.at) < 5000
    ) {
      previous.count = Math.min(1000, previous.count + 1);
      previous.at = entry.at;
    } else entries.push(entry);
    memory = entries.slice(-30);
    try {
      const store = storage();
      writeFailed = !store;
      store?.setItem(key, JSON.stringify(memory));
    } catch {
      writeFailed = true;
      /* Keep an in-memory report when storage is unavailable. */
    }
  } catch {
    /* Error reporting must never break error recovery. */
  }
}
export function diagnosticsReport() {
  return {
    format: 1,
    version: typeof __STUDYHUB_VERSION__ === 'string' ? __STUDYHUB_VERSION__ : 'development',
    generatedAt: new Date().toISOString(),
    entries: diagnosticEntries(),
  };
}
export function downloadDiagnostics() {
  const blob = new Blob([JSON.stringify(diagnosticsReport(), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'studyhub-diagnostics.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function installErrorCapture(target: Window = window) {
  const onError = (event: ErrorEvent) => recordFailure('window-error', event.error);
  const onRejection = (event: PromiseRejectionEvent) =>
    recordFailure('unhandled-rejection', event.reason);
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
