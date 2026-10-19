import { useEffect, useMemo, useState } from 'react';
import { offlineFiles, offlineReading, removeOffline, type OfflineFile } from './offline-files';
import { ReaderSourceDialog } from './ReaderSourceDialog';
import type { Gateway } from './types';
export function OfflineShelf({ api, user }: { api: Gateway; user: string }) {
  const [items, setItems] = useState<OfflineFile[]>([]),
    [selected, setSelected] = useState<OfflineFile | null>(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [removing, setRemoving] = useState('');
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    offlineFiles(user)
      .then((rows) => {
        if (alive) {
          setItems(rows);
          setError('');
        }
      })
      .catch(() => {
        if (alive) setError('Хранилище устройства недоступно.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user, revision]);
  const gateway = useMemo<Gateway>(
    () => ({
      ...api,
      downloadLibrary: async () => {
        if (!selected) throw Error('Нет файла.');
        return selected.blob;
      },
      readingState: async () => {
        if (!selected) throw Error('Нет файла.');
        return selected.reading;
      },
      saveReading: (state) => offlineReading(user, state),
      notes: async () => [],
      saveNote: async () => {
        throw Error('Заметки сохраняются в аккаунте при подключении к интернету.');
      },
    }),
    [api, user, selected],
  );
  return (
    <section aria-label="Сохранённые материалы">
      {selected && (
        <ReaderSourceDialog
          localOnly
          api={gateway}
          source={{ kind: 'library', item: selected.item }}
          page={selected.reading.page}
          onClose={() => {
            setSelected(null);
            setRevision((n) => n + 1);
          }}
        />
      )}
      <p>
        Личные копии на этом устройстве. Позиция чтения и закладки здесь сохраняются локально и не
        заменяют данные аккаунта. Копии остаются доступными без сети; актуальность доступа
        проверяется при новом скачивании.
      </p>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button disabled={loading} onClick={() => setRevision((n) => n + 1)}>
            Повторить загрузку
          </button>
        </div>
      )}
      {loading && <p role="status">Загрузка сохранённых материалов…</p>}
      {items.map((f) => (
        <article key={f.key} className="card" style={{ marginTop: 16 }}>
          <h3>{f.item.title}</h3>
          <small>Сохранено: {new Date(f.savedAt).toLocaleDateString('ru-RU')}</small>
          <div className="card-actions">
            <button onClick={() => setSelected(f)}>Читать сохранённую копию</button>
            <button
              disabled={!!removing}
              onClick={() => {
                setRemoving(f.item.id);
                setError('');
                void removeOffline(user, f.item.id)
                  .then(() => setRevision((n) => n + 1))
                  .catch(() => setError('Не удалось удалить копию.'))
                  .finally(() => setRemoving(''));
              }}
            >
              {removing === f.item.id ? 'Удаление…' : 'Удалить с устройства'}
            </button>
          </div>
        </article>
      ))}
      {!loading && !items.length && !error && (
        <p>Сохраните нужную книгу из библиотеки, пока есть интернет.</p>
      )}
    </section>
  );
}
