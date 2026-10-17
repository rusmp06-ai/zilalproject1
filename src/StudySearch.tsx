import { useEffect, useRef, useState } from 'react';
import { noteText, canReadDocument } from './reader-tools';
import { ReaderSourceDialog } from './ReaderSourceDialog';
import { CloseButton } from './CloseButton';
import { searchFilters, searchKinds, type SearchFilter, type SearchResult } from './study-search';
import { useViewState, shortText } from './view-state';
import type { Gateway, Snapshot, Note, ReaderSource } from './types';
function Highlight({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(⟦[^⟧]*⟧)/g)
        .map((part, i) => (part.startsWith('⟦') ? <mark key={i}>{part.slice(1, -1)}</mark> : part))}
    </>
  );
}
export function StudySearch({
  api,
  snapshot,
  onCourse,
  onTasks,
  onOpen,
}: {
  api: Gateway;
  snapshot: Snapshot;
  onCourse: (id: string, task?: string) => void;
  onTasks: () => void;
  onOpen?: (result: SearchResult) => void;
}) {
  const [query, setQuery] = useViewState<string>('search', 'query', '', shortText),
    [filter, setFilter] = useViewState<SearchFilter>('search', 'filter', 'all', (v) =>
      Object.hasOwn(searchFilters, v),
    );
  const [items, setItems] = useState<SearchResult[]>([]),
    [issues, setIssues] = useState<string[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [more, setMore] = useState(false),
    [hasMore, setHasMore] = useState(false),
    [revision, retry] = useState(0),
    [note, setNote] = useState<Note | null>(null);
  const [source, setSource] = useState<ReaderSource | null>(null);
  const immediate = useRef(false);
  const controller = useRef<AbortController | null>(null),
    version = useRef(0),
    offset = useRef(0),
    loading = useRef(false),
    input = useRef<HTMLInputElement>(null),
    opener = useRef<HTMLElement | null>(null),
    dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    const run = ++version.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setItems([]);
    setError('');
    setIssues([]);
    setHasMore(false);
    offset.current = 0;
    loading.current = false;
    setMore(false);
    setBusy(query.trim().length >= 2);
    const delay = immediate.current ? 0 : 300;
    immediate.current = false;
    const timer = setTimeout(() => {
      if (query.trim().length < 2) return;
      void api
        .studySearch(query.trim(), filter, 0, abort.signal)
        .then((page) => {
          if (run !== version.current || abort.signal.aborted) return;
          setItems(page.items);
          offset.current = page.items.length;
          setHasMore(page.hasMore);
          setIssues(page.issues);
        })
        .catch((e) => {
          if (!abort.signal.aborted && run === version.current)
            setError(e instanceof Error ? e.message : 'Не удалось выполнить поиск.');
        })
        .finally(() => {
          if (run === version.current) setBusy(false);
        });
    }, delay);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [api, snapshot.me.id, query, filter, revision]);
  async function next() {
    if (loading.current || busy) return;
    loading.current = true;
    setMore(true);
    setError('');
    const run = version.current;
    try {
      const page = await api.studySearch(
        query.trim(),
        filter,
        offset.current,
        controller.current?.signal,
      );
      if (run !== version.current) return;
      offset.current += page.items.length;
      setItems((old) => [
        ...old,
        ...page.items.filter((r) => !old.some((o) => o.id === r.id && o.kind === r.kind)),
      ]);
      setHasMore(page.hasMore);
      setIssues(page.issues);
    } catch (e) {
      if (run === version.current && !controller.current?.signal.aborted)
        setError(e instanceof Error ? e.message : 'Не удалось загрузить результаты.');
    } finally {
      if (run === version.current) {
        loading.current = false;
        setMore(false);
      }
    }
  }
  async function open(r: SearchResult) {
    setError('');
    if (r.kind === 'note') {
      const run = version.current;
      opener.current = document.activeElement as HTMLElement;
      try {
        const value = await api.searchNote(r.id);
        if (run === version.current) setNote(value);
      } catch {
        if (run === version.current) setError('Заметка удалена или недоступна.');
      }
      return;
    }
    if (onOpen) {
      onOpen(r);
      return;
    }
    if (r.kind === 'book') {
      try {
        const value = await api.readerSource(r.id);
        if (canReadDocument(value.item.mime_type || '')) setSource(value);
        else if (value.kind === 'library') {
          const blob = await api.downloadLibrary(value.item),
            url = URL.createObjectURL(blob),
            a = document.createElement('a');
          a.href = url;
          a.download = value.item.original_name || value.item.title;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      } catch {
        setError('Документ удалён или недоступен.');
      }
      return;
    }
    if (r.kind === 'plan') onTasks();
    else if (r.courseId) onCourse(r.courseId, r.kind === 'assignment' ? r.id : undefined);
  }
  function close() {
    setNote(null);
    opener.current?.focus();
  }
  useEffect(() => {
    if (!note) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, [note]);
  return (
    <section className="study-search" aria-label="Результаты поиска">
      {source && (
        <ReaderSourceDialog api={api} source={source} page={1} onClose={() => setSource(null)} />
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          immediate.current = true;
          retry((n) => n + 1);
        }}
      >
        <label htmlFor="global-study-search">Поиск по учебному пространству</label>
        <div className="search-entry">
          <input
            ref={input}
            id="global-study-search"
            minLength={2}
            maxLength={200}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Название, тема или ключевые слова"
          />
          <button className="primary" disabled={query.trim().length < 2}>
            Найти
          </button>
        </div>
      </form>
      <div className="search-filters" aria-label="Тип результата">
        {Object.entries(searchFilters).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={filter === value}
            onClick={() => setFilter(value as SearchFilter)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="helper">
        По названиям, описаниям и личным записям. Поиск внутри документа — в читалке.
      </p>
      {busy && <p role="status">Ищем…</p>}
      {error && (
        <div role="alert" className="notice error">
          {error}{' '}
          <button onClick={() => (items.length ? void next() : retry((n) => n + 1))}>
            Повторить
          </button>
        </div>
      )}
      {issues.map((issue) => (
        <p className="notice" role="status" key={issue}>
          {issue}
        </p>
      ))}
      {!busy && query.trim().length >= 2 && !error && (
        <p role="status">
          {items.length
            ? `Найдено: ${items.length}${hasMore ? '+' : ''}`
            : 'Совпадений нет. Попробуйте другое слово.'}
        </p>
      )}
      <div className="search-results">
        {items.map((r) => (
          <article className="search-result" key={r.kind + r.id}>
            <div>
              <small>
                {searchKinds[r.kind]}
                {r.courseTitle ? ' · ' + r.courseTitle : ''}
              </small>
              <h3>
                <Highlight text={r.highlightedTitle || r.title} />
              </h3>
              {r.snippet && (
                <p>
                  <Highlight text={r.snippet} />
                </p>
              )}
              {r.due && (
                <small>
                  Срок: {new Date(r.due).toLocaleDateString('ru-RU', { timeZone: 'Asia/Bishkek' })}
                </small>
              )}
              {r.status && (
                <small className="search-status">
                  {{
                    completed: 'Выполнено',
                    pending: 'В работе',
                    submitted: 'Сдано',
                    graded: 'Проверено',
                    returned: 'На доработку',
                    not_submitted: 'Не сдано',
                  }[r.status] || ''}
                </small>
              )}
            </div>
            <button onClick={() => void open(r)}>Открыть</button>
          </article>
        ))}
      </div>
      {hasMore && (
        <button className="search-more" disabled={more || busy} onClick={() => void next()}>
          {more ? 'Загружаем…' : 'Показать ещё'}
        </button>
      )}
      {note && (
        <div className="search-note-backdrop">
          <div
            ref={dialog}
            className="modal search-note"
            role="dialog"
            aria-modal="true"
            aria-label={note.title}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                close();
              }
              if (e.key === 'Tab') {
                e.preventDefault();
                dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
              }
            }}
          >
            <CloseButton label="Закрыть заметку" onClick={close} />
            <h2>{note.title}</h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>{noteText(note)}</p>
          </div>
        </div>
      )}
    </section>
  );
}
