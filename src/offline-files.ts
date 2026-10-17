import type { LibraryItem, ReadingState } from './types';
export type OfflineFile = {
  key: string;
  user: string;
  item: LibraryItem;
  blob: Blob;
  savedAt: string;
  reading: ReadingState;
};
async function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('studyhub-offline-files-v1', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'key' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('files', mode),
        req = operation(tx.objectStore('files'));
      let value: T;
      req.onsuccess = () => {
        value = req.result;
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function saveOffline(file: Omit<OfflineFile, 'key' | 'savedAt'>) {
  const records = await offlineFiles(file.user);
  if (
    records.filter((r) => r.item.id !== file.item.id).reduce((n, r) => n + r.blob.size, 0) +
      file.blob.size >
    50 * 1024 * 1024
  )
    throw Error('Лимит сохранённых материалов — 50 МБ. Удалите ненужные копии.');
  await transact('readwrite', (s) =>
    s.put({ ...file, key: file.user + ':' + file.item.id, savedAt: new Date().toISOString() }),
  );
}
export async function offlineFiles(user: string) {
  const rows = await transact<OfflineFile[]>('readonly', (s) => s.getAll());
  return rows.filter((r) => r.user === user);
}
export async function removeOffline(user: string, id: string) {
  await transact('readwrite', (s) => s.delete(user + ':' + id));
}
export async function offlineReading(user: string, state: ReadingState) {
  const db = await open();
  try {
    return await new Promise<ReadingState>((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite'),
        store = tx.objectStore('files'),
        req = store.get(user + ':' + state.item_id);
      let result: ReadingState;
      req.onsuccess = () => {
        const file = req.result as OfflineFile | undefined;
        if (!file || file.reading.version !== state.version) {
          tx.abort();
          return;
        }
        result = { ...state, version: state.version + 1 };
        file.reading = result;
        store.put(file);
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(Error('Локальная позиция изменилась. Откройте файл заново.'));
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function enableOffline() {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator))
    throw Error('Этот браузер не поддерживает автономную загрузку приложения.');
  await navigator.serviceWorker.register('/sw.js');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Error('Автономная загрузка ещё не завершена. Повторите позже.')),
          30000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
