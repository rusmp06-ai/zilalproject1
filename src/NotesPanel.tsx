import { saveNoteSafely, type PendingNoteSave } from './note-save';
import { decodeCourseNote, encodeCourseNote } from './course-notes';
import { useDraft, registerNavigationGuard } from './drafts';
import { loadPersonalNotes, decodePlan } from './personal-plan';
import { useEffect, useState, useRef } from 'react';
import { decodeReaderNote, encodeReaderNote, noteText } from './reader-tools';
import { ReaderSourceDialog } from './ReaderSourceDialog';
import { canReadDocument } from './reader-tools';
import type { Gateway, Note, ReaderSource, Course, CourseTopic } from './types';
export function NotesPanel({
  api,
  userId = 'test',
  course,
  topics = [],
  sourceIds = [],
}: {
  api: Gateway;
  userId?: string;
  course?: Course;
  topics?: CourseTopic[];
  sourceIds?: string[];
}) {
  const [source, setSource] = useState<{ data: ReaderSource; page: number } | null>(null),
    [sourceBusy, setSourceBusy] = useState(false);
  const request = useRef(0),
    opener = useRef<HTMLElement | null>(null);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  async function openSource(body: string) {
    const note = decodeReaderNote(body);
    if (!note) return;
    opener.current = document.activeElement as HTMLElement;
    const version = ++request.current;
    setSourceBusy(true);
    setError('');
    try {
      const data = await api.readerSource(note.sourceId);
      if (!canReadDocument(data.item.mime_type || ''))
        throw Error('Этот формат не поддерживается читалкой.');
      if (version === request.current) setSource({ data, page: note.page });
    } catch {
      if (version === request.current)
        setError(
          'Источник удалён, недоступен или не удалось подключиться. Сама заметка сохранена.',
        );
    } finally {
      if (version === request.current) setSourceBusy(false);
    }
  }
  const [items, setItems] = useState<Note[]>([]),
    [search, setSearch] = useState(''),
    [draftSearch, setDraftSearch] = useState(''),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [revision, setRevision] = useState(0),
    [deleting, setDeleting] = useState('');
  const saving = useRef(false);
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    const leave = () => {
      if (!saving.current) return true;
      window.alert('Дождитесь завершения сохранения или удаления заметки.');
      return false;
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (saving.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const unregister = registerNavigationGuard(leave);
    window.addEventListener('beforeunload', unload);
    return () => {
      unregister();
      window.removeEventListener('beforeunload', unload);
    };
  }, []);
  const draft = useDraft<{
    edit: Note | null;
    title: string;
    body: string;
    topicId: string;
    pending: PendingNoteSave | null;
  }>((api.demo ? 'demo:' : 'live:') + userId + ':note' + (course ? ':' + course.id : ''), {
    edit: null,
    title: '',
    body: '',
    topicId: '',
    pending: null,
  });
  const { edit, title, body, topicId } = draft.value;
  const setEdit = (edit: Note | null) => draft.setValue((v) => ({ ...v, edit })),
    setTitle = (title: string) => draft.setValue((v) => ({ ...v, title })),
    setBody = (body: string) => draft.setValue((v) => ({ ...v, body }));
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    loadPersonalNotes(api)
      .then((notes) =>
        notes
          .filter(
            (n) =>
              !course ||
              decodeCourseNote(n.body)?.courseId === course.id ||
              sourceIds.includes(decodeReaderNote(n.body)?.sourceId || ''),
          )
          .filter((n) =>
            (n.title + ' ' + noteText(n)).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
          )
          .slice(offset, offset + 51),
      )
      .then((n) => {
        if (active) setItems(n);
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setItems([]);
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [api, search, offset, revision, course?.id, sourceIds.join(',')]);
  function clear() {
    draft.clear();
  }
  async function action(fn: () => Promise<void>, ok: string) {
    if (saving.current) return;
    saving.current = true;
    setWriting(true);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      setMessage(ok);
      setRevision((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Действие не выполнено.');
    } finally {
      saving.current = false;
      setWriting(false);
      setBusy(false);
    }
  }
  return (
    <section>
      {source && (
        <ReaderSourceDialog
          api={api}
          source={source.data}
          page={source.page}
          onClose={() => {
            setSource(null);
            setTimeout(() => opener.current?.focus(), 0);
          }}
        />
      )}{' '}
      {sourceBusy && <p role="status">Проверяем доступ к источнику…</p>}
      {draft.changed && (
        <p className="helper">
          {draft.storageError
            ? 'Черновик только в памяти: хранилище вкладки недоступно.'
            : 'Черновик сохраняется в этой вкладке до сохранения заметки.'}
        </p>
      )}
      <p>
        Личные записи доступны только вашему аккаунту. Другие студенты, преподаватели и владелец не
        читают их через приложение.
      </p>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="notice success" role="status">
          {message}
        </div>
      )}
      <section className="card upload-panel">
        <h2>{edit ? 'Редактирование заметки' : 'Новая заметка'}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              const source = edit ? decodeReaderNote(edit.body) : null,
                linked = edit ? decodeCourseNote(edit.body) : null;
              const context = course
                ? {
                    courseId: course.id,
                    courseTitle: course.title,
                    topicId: topicId || null,
                    text: body,
                  }
                : linked
                  ? { ...linked, text: body }
                  : null;
              await saveNoteSafely(
                api,
                {
                  title,
                  body: source
                    ? encodeReaderNote({ ...source, text: body })
                    : context
                      ? encodeCourseNote(context)
                      : body,
                  id: edit?.id || null,
                  version: edit?.version || null,
                },
                draft.value.pending,
                (pending) => draft.setValue((v) => ({ ...v, pending })),
              );
              clear();
              setSearch('');
              setDraftSearch('');
              setOffset(0);
            }, 'Заметка сохранена.');
          }}
        >
          <label>
            Название заметки
            <input
              disabled={busy || writing || !!draft.value.pending}
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          {course && topics.length > 0 && !decodeReaderNote(edit?.body || '') && (
            <label>
              Тема заметки
              <select
                aria-label="Тема заметки"
                value={topicId}
                disabled={busy || writing || !!draft.value.pending}
                onChange={(e) => draft.setValue((v) => ({ ...v, topicId: e.target.value }))}
              >
                <option value="">Вся дисциплина</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Текст заметки
            <textarea
              aria-label="Текст заметки"
              disabled={busy || writing || !!draft.value.pending}
              maxLength={
                edit && decodeReaderNote(edit.body)
                  ? 20000
                  : course || (edit && decodeCourseNote(edit.body))
                    ? 40000
                    : 50000
              }
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <div className="card-actions">
            <button disabled={busy || writing} className="primary">
              {draft.value.pending ? 'Проверить сохранение' : 'Сохранить заметку'}
            </button>
            {edit && !draft.value.pending && (
              <button disabled={busy || writing} type="button" onClick={clear}>
                Отменить редактирование
              </button>
            )}
          </div>
        </form>
      </section>
      <form
        style={{ marginTop: 24 }}
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(draftSearch);
          setOffset(0);
          setRevision((n) => n + 1);
        }}
      >
        <label>
          Поиск по заметкам
          <input
            maxLength={200}
            value={draftSearch}
            onChange={(e) => setDraftSearch(e.target.value)}
          />
        </label>
        <div className="card-actions">
          <button disabled={busy || writing}>Найти заметки</button>
          <button
            disabled={busy || writing}
            type="button"
            onClick={() => {
              setSearch('');
              setDraftSearch('');
              setOffset(0);
              setRevision((n) => n + 1);
            }}
          >
            Показать все заметки
          </button>
          <button
            type="button"
            disabled={busy || writing}
            onClick={() => setRevision((n) => n + 1)}
          >
            Обновить заметки
          </button>
        </div>
      </form>
      {busy && <p role="status">Загрузка…</p>}
      {items.slice(0, 50).map((n) => (
        <article key={n.id} className="card" style={{ marginTop: 18 }}>
          <h3>{n.title}</h3>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{noteText(n)}</p>
          {decodeReaderNote(n.body) && (
            <div className="note-source">
              <small>
                Источник: {decodeReaderNote(n.body)!.sourceTitle} · страница{' '}
                {decodeReaderNote(n.body)!.page}
              </small>
              {decodeReaderNote(n.body)!.quote && (
                <blockquote>{decodeReaderNote(n.body)!.quote}</blockquote>
              )}
              <button disabled={busy || sourceBusy} onClick={() => void openSource(n.body)}>
                Открыть источник · стр. {decodeReaderNote(n.body)!.page}
              </button>
            </div>
          )}
          {decodeCourseNote(n.body) && (
            <p className="helper">
              {decodeCourseNote(n.body)!.courseTitle}
              {topics.find((t) => t.id === decodeCourseNote(n.body)?.topicId)
                ? ' · ' + topics.find((t) => t.id === decodeCourseNote(n.body)?.topicId)!.title
                : ''}
            </p>
          )}
          <small>
            Изменено: {new Date(n.updated_at).toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' })}
          </small>
          <div className="card-actions">
            {deleting === n.id ? (
              <>
                <span>Удалить заметку?</span>
                <button
                  disabled={busy || writing}
                  className="danger"
                  onClick={() =>
                    void action(async () => {
                      await api.deleteNote(n.id, n.version);
                      if (edit?.id === n.id) clear();
                      setDeleting('');
                    }, 'Заметка удалена.')
                  }
                >
                  Подтвердить удаление
                </button>
                <button disabled={busy || writing} onClick={() => setDeleting('')}>
                  Отмена
                </button>
              </>
            ) : (
              <>
                <button
                  disabled={busy || writing || !!draft.value.pending}
                  onClick={() => {
                    setEdit(n);
                    setTitle(n.title);
                    setBody(noteText(n));
                    draft.setValue((v) => ({
                      ...v,
                      topicId: decodeCourseNote(n.body)?.topicId || '',
                    }));
                    setDeleting('');
                    setMessage('');
                  }}
                >
                  Редактировать заметку
                </button>
                <button
                  disabled={busy || writing}
                  className="danger"
                  onClick={() => setDeleting(n.id)}
                >
                  Удалить заметку
                </button>
              </>
            )}
          </div>
        </article>
      ))}
      {!busy && !items.some((n) => !decodePlan(n.body)) && !error && (
        <div className="card empty">
          {search ? 'Заметки не найдены.' : 'Личных заметок пока нет.'}
        </div>
      )}
      <div className="pagination">
        <button
          disabled={busy || offset === 0}
          onClick={() => setOffset((n) => Math.max(0, n - 50))}
        >
          Назад
        </button>
        <span>Страница {offset / 50 + 1}</span>
        <button disabled={busy || items.length <= 50} onClick={() => setOffset((n) => n + 50)}>
          Далее
        </button>
      </div>
    </section>
  );
}
