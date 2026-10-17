import { saveNoteSafely, type PendingNoteSave } from './note-save';
import { useEffect, useRef, useState } from 'react';
import type { Gateway, LibraryItem, ReadingState, Note } from './types';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { textPages } from './reader-state';
import {
  highlightedText,
  readerPreferences,
  defaultPreferences,
  textOutline,
  findText,
  decodeReaderNote,
  encodeReaderNote,
  DOCX_MIME,
  EPUB_MIME,
} from './reader-tools';
import { useReaderSpeech } from './reader-speech';
import { StudyIcon } from './StudyIcon';
import type { ReaderPreferences, ReaderHeading } from './reader-tools';
type Panel = 'contents' | 'bookmarks' | 'search' | 'notes' | 'settings' | 'audio' | null;
const prefKey = 'studyhub-reader-preferences-v1';
function preferences() {
  try {
    return readerPreferences(JSON.parse(localStorage.getItem(prefKey) || 'null'));
  } catch {
    return defaultPreferences;
  }
}
export function ReaderPanel({
  api,
  item,
  onChanged,
  onDirtyChange,
  initialPage,
  allowFavorite = true,
  allowNotes = true,
  notesLabel = 'Заметки к книге',
  storageHint = 'Оформление сохраняется на этом устройстве. Позиция, закладки и заметки — в вашем аккаунте.',
}: {
  api: Gateway;
  item: LibraryItem;
  onChanged: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  initialPage?: number;
  allowFavorite?: boolean;
  allowNotes?: boolean;
  notesLabel?: string;
  storageHint?: string;
}) {
  const [reading, setReading] = useState<ReadingState | null>(null),
    [pages, setPages] = useState<string[] | null>(null),
    [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [pageText, setPageText] = useState(''),
    [outline, setOutline] = useState<ReaderHeading[]>([]),
    [busy, setBusy] = useState(true),
    [rendering, setRendering] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [revision, setRevision] = useState(0);
  const [prefs, setPrefs] = useState(preferences),
    [panel, setPanel] = useState<Panel>(null),
    [width, setWidth] = useState(800),
    [pdfTextMode, setPdfTextMode] = useState(false),
    [query, setQuery] = useState(''),
    [results, setResults] = useState<{ page: number; snippet: string }[]>([]),
    [searching, setSearching] = useState(false),
    [searched, setSearched] = useState(false),
    [selection, setSelection] = useState(''),
    [notes, setNotes] = useState<Note[]>([]),
    [noteOffset, setNoteOffset] = useState(0),
    [moreNotes, setMoreNotes] = useState(false),
    [noteBusy, setNoteBusy] = useState(false),
    [noteSaving, setNoteSaving] = useState(false),
    [noteError, setNoteError] = useState(''),
    [noteRevision, setNoteRevision] = useState(0),
    [draft, setDraft] = useState<{
      page: number;
      quote: string;
      text: string;
      title: string;
      pending?: PendingNoteSave | null;
    } | null>(null);
  const [draftKey, setDraftKey] = useState(''),
    [draftStorageError, setDraftStorageError] = useState(false);
  useEffect(() => {
    let active = true;
    void api
      .snapshot()
      .then((snapshot) => {
        if (!active) return;
        const key =
          'studyhub-reader-draft-v1:' +
          (api.demo ? 'demo:' : 'live:') +
          snapshot.me.id +
          ':' +
          item.id;
        let restored = null;
        try {
          const raw = JSON.parse(sessionStorage.getItem(key) || 'null');
          if (
            raw &&
            Number.isInteger(raw.page) &&
            raw.page > 0 &&
            typeof raw.quote === 'string' &&
            raw.quote.length <= 2000 &&
            typeof raw.text === 'string' &&
            raw.text.length <= 20000 &&
            typeof raw.title === 'string' &&
            raw.title.length <= 200
          )
            restored = raw;
        } catch {
          setDraftStorageError(true);
        }
        setDraftKey(key);
        if (restored) {
          setDraft(restored);
          setPanel('notes');
        }
      })
      .catch(() => {
        if (active)
          setNoteError(
            'Не удалось проверить аккаунт для черновика заметки. Откройте документ заново.',
          );
      });
    return () => {
      active = false;
    };
  }, [api, item.id]);
  useEffect(() => {
    if (!draftKey) return;
    try {
      if (draft) sessionStorage.setItem(draftKey, JSON.stringify(draft));
      else sessionStorage.removeItem(draftKey);
      setDraftStorageError(false);
    } catch {
      setDraftStorageError(true);
    }
  }, [draftKey, draft]);
  const [focusMode, setFocusMode] = useState(false),
    [returnPage, setReturnPage] = useState<number | null>(null);
  const moreMenu = useRef<HTMLDetailsElement>(null);
  const [ocrBusy, setOcrBusy] = useState(false),
    [ocrProgress, setOcrProgress] = useState(0),
    [ocrLanguage, setOcrLanguage] = useState<'rus' | 'eng'>('rus');
  const ocrAbort = useRef<AbortController | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null),
    documentArea = useRef<HTMLDivElement>(null),
    root = useRef<HTMLElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    noteSavingRef = useRef(false),
    saving = useRef(false),
    searchVersion = useRef(0),
    pdfTexts = useRef(new Map<number, string>()),
    aliveRef = useRef(true);
  const content =
    pages && reading
      ? pages[reading.page - 1]
      : reading
        ? pdfTexts.current.get(reading.page) || ''
        : pageText;
  const pendingSpeechPage = useRef<number | null>(null);
  const [searchProgress, setSearchProgress] = useState(0);
  const audio = useReaderSpeech(() => {
    if (!reading || reading.page >= reading.total_pages) return;
    pendingSpeechPage.current = reading.page + 1;
    void change({ ...reading, page: reading.page + 1 }, false, true).then((ok) => {
      if (!ok) pendingSpeechPage.current = null;
    });
  });
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      ocrAbort.current?.abort();
      searchVersion.current++;
      pendingSpeechPage.current = null;
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(prefKey, JSON.stringify(prefs));
    } catch {
      /* Reading remains usable in restricted browsers. */
    }
  }, [prefs]);
  useEffect(() => {
    onDirtyChange?.(!!draft && (!!draft.text.trim() || !!draft.quote));
    return () => onDirtyChange?.(false);
  }, [draft, onDirtyChange]);
  useEffect(() => {
    if (!draft?.text.trim()) return;
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [draft?.text]);
  useEffect(() => {
    let alive = true;
    let task: ReturnType<(typeof import('./pdf-reader'))['loadPdf']> | undefined;
    setBusy(true);
    setReading(null);
    setPages(null);
    setPdf(null);
    setError('');
    setOutline([]);
    pdfTexts.current.clear();
    void (async () => {
      try {
        const [blob, saved] = await Promise.all([
          api.downloadLibrary(item),
          api.readingState(item.id),
        ]);
        let total: number;
        if (
          item.mime_type === 'text/plain' ||
          item.mime_type === DOCX_MIME ||
          item.mime_type === EPUB_MIME
        ) {
          const p =
            item.mime_type === EPUB_MIME
              ? await (await import('./epub-reader')).loadEpub(await blob.arrayBuffer())
              : item.mime_type === DOCX_MIME
                ? await (await import('./docx-reader')).loadDocx(await blob.arrayBuffer())
                : textPages(await blob.text());
          total = p.length;
          if (alive) {
            setPages(p);
            setOutline(textOutline(p));
          }
        } else {
          const { loadPdf } = await import('./pdf-reader');
          if (!alive) return;
          const bytes = await blob.arrayBuffer();
          if (!alive) return;
          task = loadPdf(new Uint8Array(bytes));
          const document = await task.promise;
          total = document.numPages;
          if (alive) setPdf(document);
          void (async () => {
            try {
              const entries: ReaderHeading[] = [];
              const walk = async (
                nodes: Awaited<ReturnType<PDFDocumentProxy['getOutline']>>,
                level: number,
              ) => {
                for (const node of nodes || []) {
                  if (!alive || entries.length >= 300) return;
                  try {
                    const dest =
                      typeof node.dest === 'string'
                        ? await document.getDestination(node.dest)
                        : node.dest;
                    if (dest?.length) {
                      const page =
                        typeof dest[0] === 'number'
                          ? dest[0]
                          : await document.getPageIndex(dest[0]);
                      entries.push({ title: node.title, page: page + 1, level });
                    }
                  } catch {
                    /* Skip an invalid destination, not the document. */
                  }
                  await walk(node.items, level + 1);
                }
              };
              await walk(await document.getOutline(), 1);
              if (alive) setOutline(entries);
            } catch {
              /* Outline is optional. */
            }
          })();
        }
        if (!alive) return;
        const next = {
          ...saved,
          page: Math.max(
            1,
            Math.min(
              initialPage && Number.isInteger(initialPage) ? initialPage : saved.page,
              total,
            ),
          ),
          total_pages: total,
          bookmarks: saved.bookmarks.filter((n) => n <= total),
        };
        setReading(next);
        const updated =
          next.page !== saved.page ||
          next.total_pages !== saved.total_pages ||
          next.bookmarks.length !== saved.bookmarks.length
            ? await api.saveReading(next)
            : next;
        if (alive) {
          setReading(updated);
          onChanged();
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Не удалось открыть документ.');
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
      searchVersion.current++;
      void task?.destroy();
    };
  }, [api, item.id, revision]);
  useEffect(() => {
    const element = documentArea.current;
    if (!element) return;
    const resize = () => setWidth(Math.max(220, Math.min(900, element.clientWidth - 40)));
    resize();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', resize);
      return () => window.removeEventListener('resize', resize);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [reading?.total_pages, panel]);
  useEffect(() => {
    if (!pdf || !reading || !canvas.current || pdfTextMode) return;
    let alive = true;
    let render: RenderTask | undefined;
    setRendering(true);
    setPageText('');
    void (async () => {
      try {
        const p = await pdf.getPage(reading.page);
        if (!alive) return;
        const view = p.getViewport({ scale: 1 }),
          scale = (Math.min(width / view.width, 1600 / view.height) * prefs.zoom) / 100,
          viewport = p.getViewport({ scale }),
          ratio = Math.min(
            window.devicePixelRatio || 1,
            2,
            Math.sqrt(8000000 / (viewport.width * viewport.height)),
          ),
          c = canvas.current;
        if (!c) return;
        c.width = Math.ceil(viewport.width * ratio);
        c.height = Math.ceil(viewport.height * ratio);
        c.style.width = viewport.width + 'px';
        c.style.height = viewport.height + 'px';
        render = p.render({
          canvas: c,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        await render.promise;
        const text = await p.getTextContent();
        const value =
          pdfTexts.current.get(reading.page) ||
          text.items
            .map((i) => ('str' in i ? i.str + ('hasEOL' in i && i.hasEOL ? '\n' : ' ') : ''))
            .join('')
            .trim();
        if (alive) {
          setPageText(value);
          pdfTexts.current.set(reading.page, value);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Страница не отображается.');
      } finally {
        if (alive) setRendering(false);
      }
    })();
    return () => {
      alive = false;
      render?.cancel();
    };
  }, [pdf, reading?.page, width, prefs.zoom, pdfTextMode]);
  useEffect(() => {
    if (!pdf || !reading || !pdfTextMode) return;
    let alive = true;
    setRendering(true);
    setPageText('');
    void (async () => {
      try {
        const p = await pdf.getPage(reading.page),
          text = await p.getTextContent(),
          value =
            pdfTexts.current.get(reading.page) ||
            text.items
              .map((i) => ('str' in i ? i.str + ('hasEOL' in i && i.hasEOL ? '\n' : ' ') : ''))
              .join('')
              .trim();
        if (alive) {
          setPageText(value);
          pdfTexts.current.set(reading.page, value);
        }
      } catch {
        if (alive) setError('Не удалось извлечь текст страницы.');
      } finally {
        if (alive) setRendering(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pdf, reading?.page, pdfTextMode]);
  useEffect(() => {
    if (documentArea.current) {
      documentArea.current.scrollTop = 0;
      documentArea.current.scrollLeft = 0;
    }
    setSelection('');
    if (pendingSpeechPage.current !== reading?.page) pendingSpeechPage.current = null;
    audio.stop();
  }, [reading?.page]);
  useEffect(() => {
    if (pendingSpeechPage.current !== reading?.page || busy || rendering) return;
    if (pdf && reading && !pdfTexts.current.has(reading.page)) return;
    pendingSpeechPage.current = null;
    audio.start(content);
  }, [reading?.page, content, busy, rendering]);
  useEffect(() => {
    if (panel !== 'notes') return;
    let alive = true;
    setNoteBusy(true);
    setNoteError('');
    api
      .notes(item.id, noteOffset)
      .then((items) => {
        if (alive) {
          setNotes(items.filter((n) => decodeReaderNote(n.body)?.sourceId === item.id));
          setMoreNotes(items.length === 50);
        }
      })
      .catch(() => {
        if (alive) {
          setNotes([]);
          setNoteError('Не удалось загрузить заметки.');
        }
      })
      .finally(() => {
        if (alive) setNoteBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [api, item.id, panel, noteOffset, noteRevision]);
  async function change(next: ReadingState, remember = false, automatic = false) {
    if (!automatic) pendingSpeechPage.current = null;
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await api.saveReading(next);
      if (aliveRef.current) {
        if (remember && reading && next.page !== reading.page) setReturnPage(reading.page);
        setReading(updated);
        setNotice('Отметки сохранены.');
        onChanged();
      }
      return true;
    } catch (e) {
      if (aliveRef.current)
        setError(e instanceof Error ? e.message : 'Не удалось сохранить отметки.');
      return false;
    } finally {
      saving.current = false;
      if (aliveRef.current) setBusy(false);
    }
  }
  async function recognize() {
    if (!pdf || !reading || ocrBusy) return;
    const page = reading.page,
      controller = new AbortController();
    ocrAbort.current = controller;
    setOcrBusy(true);
    setOcrProgress(0);
    setNotice('');
    try {
      const { recognizePage } = await import('./ocr');
      const text = await recognizePage(pdf, page, ocrLanguage, controller.signal, setOcrProgress);
      if (!controller.signal.aborted && aliveRef.current) {
        pdfTexts.current.set(page, text);
        setPageText(text);
        setPdfTextMode(true);
        setNotice(
          text
            ? 'Текст распознан. Проверьте его: возможны ошибки. Результат доступен до закрытия книги.'
            : 'Текст не найден. Попробуйте другой язык или более чёткий скан.',
        );
      }
    } catch {
      if (aliveRef.current)
        setNotice(
          controller.signal.aborted
            ? 'Распознавание отменено.'
            : 'Не удалось распознать страницу. Для загрузки языковой модели нужен интернет.',
        );
    } finally {
      if (aliveRef.current) setOcrBusy(false);
      ocrAbort.current = null;
    }
  }
  async function refresh() {
    setBusy(true);
    setError('');
    try {
      const saved = await api.readingState(item.id),
        total = pages?.length || pdf?.numPages || saved.total_pages;
      const normalized = {
        ...saved,
        page: Math.max(
          1,
          Math.min(initialPage && Number.isInteger(initialPage) ? initialPage : saved.page, total),
        ),
        total_pages: total,
        bookmarks: saved.bookmarks.filter((p) => p <= total),
      };
      setReading(saved.total_pages === total ? normalized : await api.saveReading(normalized));
      setNotice('Отметки обновлены.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось обновить отметки.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (panel !== 'search' && searching) {
      searchVersion.current++;
      setSearching(false);
    }
  }, [panel]);
  function toggle(value: Panel) {
    setFocusMode(false);
    if (moreMenu.current) moreMenu.current.open = false;
    setPanel((old) => (old === value ? null : value));
    if (value === 'search') setTimeout(() => searchInput.current?.focus(), 0);
  }
  const locked = busy || rendering || ocrBusy;
  const searchHighlight = (text: string) =>
    searched
      ? highlightedText(text, query).map((part, i) =>
          part.match ? <mark key={i}>{part.text}</mark> : part.text,
        )
      : text;
  const highlighted = (text: string) =>
    audio.current && audio.mode === 'page' && audio.text === text && audio.state !== 'idle' ? (
      <>
        {searchHighlight(text.slice(0, audio.current.start))}
        <mark className="reader-spoken">
          {searchHighlight(text.slice(audio.current.start, audio.current.end))}
        </mark>
        {searchHighlight(text.slice(audio.current.end))}
      </>
    ) : (
      searchHighlight(text)
    );
  useEffect(() => {
    if (searched)
      documentArea.current?.querySelector('mark')?.scrollIntoView?.({ block: 'center' });
  }, [reading?.page, searched, query, pageText, width, prefs.fontSize, prefs.lineHeight]);
  useEffect(() => {
    if (audio.current && audio.mode === 'page')
      documentArea.current?.querySelector('.reader-spoken')?.scrollIntoView?.({ block: 'nearest' });
  }, [audio.current]);
  function captureSelection() {
    const s = window.getSelection();
    if (s?.rangeCount && documentArea.current?.contains(s.getRangeAt(0).commonAncestorContainer))
      setSelection(s.toString().trim().slice(0, 2000));
    else setSelection('');
  }
  async function copySelection() {
    try {
      await navigator.clipboard.writeText(selection);
      setNotice('Цитата скопирована.');
    } catch {
      setNotice('Браузер не разрешил копирование. Используйте Ctrl+C или меню выделения.');
    }
  }
  function startNote(quote = '') {
    if (!allowNotes || !reading || noteSavingRef.current) return;
    if (!draftKey) {
      setNotice('Проверяем аккаунт для сохранения черновика. Попробуйте ещё раз.');
      return;
    }
    if (draft?.pending) {
      setPanel('notes');
      return;
    }
    if (draft?.text.trim() && !window.confirm('Заменить несохранённую заметку?')) return;
    setDraft({
      page: reading.page,
      quote,
      text: '',
      title: item.title.slice(0, 165) + ' · стр. ' + reading.page,
    });
    setFocusMode(false);
    if (moreMenu.current) moreMenu.current.open = false;
    setPanel('notes');
  }
  async function saveNote() {
    if (!draft || noteSavingRef.current) return;
    noteSavingRef.current = true;
    setNoteSaving(true);
    setNoteError('');
    try {
      await saveNoteSafely(
        api,
        {
          title: draft.title,
          body: encodeReaderNote({
            sourceId: item.id,
            sourceTitle: item.title,
            page: draft.page,
            quote: draft.quote,
            text: draft.text,
          }),
          id: null,
          version: null,
        },
        draft.pending || null,
        (pending) => setDraft((value) => (value ? { ...value, pending } : value)),
      );
      if (aliveRef.current) {
        setDraft(null);
        setSelection('');
        setNoteOffset(0);
        setNoteRevision((n) => n + 1);
        setNotice('Заметка сохранена в «Мои заметки».');
      }
    } catch (e) {
      if (aliveRef.current) setNoteError(e instanceof Error ? e.message : 'Заметка не сохранена.');
    } finally {
      noteSavingRef.current = false;
      if (aliveRef.current) setNoteSaving(false);
    }
  }
  async function search() {
    const version = ++searchVersion.current;
    setSearching(true);
    setSearchProgress(0);
    setSearched(false);
    setResults([]);
    try {
      let found: { page: number; snippet: string }[] = [];
      if (pdf) {
        for (let n = 1; n <= pdf.numPages; n++) {
          if (version !== searchVersion.current || !aliveRef.current) return;
          let text = pdfTexts.current.get(n);
          if (text === undefined) {
            const page = await pdf.getPage(n),
              data = await page.getTextContent();
            text = data.items.map((i) => ('str' in i ? i.str : '')).join(' ');
            pdfTexts.current.set(n, text);
          }
          const match = findText([text], query)[0];
          if (match) found.push({ ...match, page: n });
          if (found.length >= 100) break;
          if (n % 10 === 0) {
            setSearchProgress(n);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
        }
      } else found = findText(pages || [], query);
      if (version === searchVersion.current && aliveRef.current) {
        setResults(found);
        setSearched(true);
      }
    } catch {
      if (version === searchVersion.current && aliveRef.current)
        setNotice('Поиск не завершён. Попробуйте ещё раз.');
    } finally {
      if (version === searchVersion.current && aliveRef.current) setSearching(false);
    }
  }
  function listen(value = content, kind: 'page' | 'selection' = 'page') {
    pendingSpeechPage.current = null;
    setFocusMode(false);
    setPanel('audio');
    if (moreMenu.current) moreMenu.current.open = false;
    if (pdf) setPdfTextMode(true);
    audio.start(value, kind);
  }
  async function fullScreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      setNotice('Браузер не разрешил полноэкранный режим.');
    }
  }
  return (
    <section
      ref={root}
      className="reader"
      data-focus={focusMode}
      data-theme={prefs.theme}
      aria-label="Читалка"
      onKeyDown={(e) => {
        const input = (e.target as HTMLElement).closest(
          'input,textarea,select,button,[contenteditable=true]',
        );
        if (e.key === 'Escape' && (panel || focusMode || moreMenu.current?.open)) {
          e.preventDefault();
          e.stopPropagation();
          setPanel(null);
          setFocusMode(false);
          if (moreMenu.current) moreMenu.current.open = false;
          documentArea.current?.focus();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          setFocusMode(false);
          setPanel('search');
          setTimeout(() => searchInput.current?.focus(), 0);
        } else if (!input && !window.getSelection()?.toString() && reading && !locked) {
          if (
            (e.key === 'ArrowRight' || e.key === 'PageDown') &&
            reading.page < reading.total_pages
          ) {
            e.preventDefault();
            void change({ ...reading, page: reading.page + 1 });
          }
          if ((e.key === 'ArrowLeft' || e.key === 'PageUp') && reading.page > 1) {
            e.preventDefault();
            void change({ ...reading, page: reading.page - 1 });
          }
        }
      }}
    >
      {audio.error && panel !== 'audio' && (
        <p role="alert" className="notice error">
          {audio.error}
        </p>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
          {pages || pdf ? (
            <button disabled={busy} onClick={() => void refresh()}>
              Обновить отметки
            </button>
          ) : (
            <button disabled={busy} onClick={() => setRevision((n) => n + 1)}>
              Повторить открытие
            </button>
          )}
        </div>
      )}
      {notice && (
        <p className="reader-status" role="status">
          {notice}
        </p>
      )}
      {busy && !reading && <p role="status">Открываем документ…</p>}
      {reading && (
        <>
          <div className="reader-toolbar">
            {(
              [
                ['contents', 'Оглавление'],
                ['bookmarks', 'Закладки'],
                ['search', 'Поиск в документе'],
                ['notes', notesLabel],
                ['settings', 'Настройки чтения'],
              ] as [Panel, string][]
            )
              .filter(([id]) => allowNotes || id !== 'notes')
              .map(([id, label]) => (
                <button
                  key={id}
                  aria-label={label}
                  title={label}
                  aria-pressed={panel === id}
                  onClick={() => toggle(id)}
                >
                  <StudyIcon
                    name={
                      id === 'contents'
                        ? 'book'
                        : id === 'bookmarks'
                          ? 'bookmark'
                          : id === 'search'
                            ? 'search'
                            : id === 'notes'
                              ? 'note'
                              : 'settings'
                    }
                  />
                  <span>{label}</span>
                </button>
              ))}
            <button
              aria-label={
                reading.bookmarks.includes(reading.page) ? 'Убрать закладку' : 'Добавить закладку'
              }
              title={
                reading.bookmarks.includes(reading.page) ? 'Убрать закладку' : 'Добавить закладку'
              }
              disabled={
                locked ||
                (!reading.bookmarks.includes(reading.page) && reading.bookmarks.length >= 100)
              }
              onClick={() => {
                setPanel('bookmarks');
                void change({
                  ...reading,
                  bookmarks: reading.bookmarks.includes(reading.page)
                    ? reading.bookmarks.filter((p) => p !== reading.page)
                    : [...reading.bookmarks, reading.page],
                });
              }}
            >
              <StudyIcon
                name={reading.bookmarks.includes(reading.page) ? 'bookmark' : 'bookmark-add'}
              />
              <span>
                {reading.bookmarks.includes(reading.page) ? 'Убрать закладку' : 'Добавить закладку'}
              </span>
            </button>
            <button
              className="reader-focus-toggle"
              aria-label={focusMode ? 'Вернуть инструменты' : 'Сосредоточенное чтение'}
              aria-pressed={focusMode}
              title={focusMode ? 'Вернуть инструменты' : 'Сосредоточенное чтение'}
              onClick={() => {
                setFocusMode((v) => !v);
                setPanel(null);
                if (moreMenu.current) moreMenu.current.open = false;
                documentArea.current?.focus();
              }}
            >
              <StudyIcon name="focus" />
              <span>{focusMode ? 'Вернуть инструменты' : 'Сосредоточиться'}</span>
            </button>
            <details ref={moreMenu} className="reader-more">
              <summary>Ещё</summary>
              <div className="reader-more-actions">
                {allowFavorite && (
                  <button
                    disabled={locked}
                    aria-pressed={reading.favorite}
                    onClick={() => void change({ ...reading, favorite: !reading.favorite })}
                  >
                    {reading.favorite ? 'Убрать из избранного' : 'В избранное'}
                  </button>
                )}
                {allowNotes && (
                  <button disabled={locked} onClick={() => startNote()}>
                    Заметка к странице
                  </button>
                )}
                <button disabled={locked} onClick={() => toggle('audio')}>
                  Озвучка
                </button>
                {document.fullscreenEnabled && (
                  <button onClick={() => void fullScreen()}>Полный экран</button>
                )}
              </div>
            </details>
          </div>
          <div className="reader-layout">
            {panel && (
              <aside className="reader-sidebar" aria-label="Инструменты чтения">
                <div className="reader-sidebar-heading">
                  <h3>
                    {panel === 'contents'
                      ? 'Оглавление'
                      : panel === 'bookmarks'
                        ? 'Закладки'
                        : panel === 'search'
                          ? 'Поиск'
                          : panel === 'notes'
                            ? notesLabel
                            : panel === 'audio'
                              ? 'Озвучка'
                              : 'Настройки чтения'}
                  </h3>
                  <button aria-label="Скрыть инструменты" onClick={() => setPanel(null)}>
                    ×
                  </button>
                </div>
                {panel === 'contents' && (
                  <>
                    {outline.length ? (
                      outline.map((h, i) => (
                        <button
                          className="reader-toc-entry"
                          aria-current={h.page === reading.page ? 'page' : undefined}
                          key={i}
                          disabled={locked}
                          style={{ paddingLeft: Math.min(h.level, 4) * 10 }}
                          onClick={() => void change({ ...reading, page: h.page }, true)}
                        >
                          {h.title}
                          <small>Стр. {h.page}</small>
                        </button>
                      ))
                    ) : (
                      <p>В документе нет оглавления. Перейдите к странице по номеру внизу.</p>
                    )}
                    {item.mime_type === DOCX_MIME && (
                      <p className="helper">
                        DOCX показан как текст. Изображения и исходная вёрстка доступны в скачанном
                        файле.
                      </p>
                    )}
                  </>
                )}
                {panel === 'bookmarks' && (
                  <div className="reader-bookmarks">
                    {reading.bookmarks.length ? (
                      [...reading.bookmarks]
                        .sort((a, b) => a - b)
                        .map((p) => (
                          <button
                            disabled={locked}
                            aria-current={p === reading.page ? 'page' : undefined}
                            key={p}
                            onClick={() => void change({ ...reading, page: p }, true)}
                          >
                            К странице {p}
                          </button>
                        ))
                    ) : (
                      <p>Закладок пока нет.</p>
                    )}
                  </div>
                )}
                {panel === 'audio' && (
                  <>
                    <p className="helper">Произносите страницу целиком или выделенный фрагмент.</p>
                    {audio.error && (
                      <p role="alert" className="notice error">
                        {audio.error}
                      </p>
                    )}
                    {!audio.supported ? (
                      <p>Этот браузер не поддерживает озвучку. Попробуйте Chrome или Edge.</p>
                    ) : (
                      <>
                        <label>
                          Скорость · {audio.prefs.rate}×
                          <input
                            aria-label="Скорость озвучки"
                            type="range"
                            min={0.75}
                            max={2}
                            step={0.25}
                            value={audio.prefs.rate}
                            onChange={(e) => {
                              pendingSpeechPage.current = null;
                              audio.configure({ ...audio.prefs, rate: Number(e.target.value) });
                            }}
                          />
                        </label>
                        <label>
                          Голос
                          <select
                            aria-label="Голос озвучки"
                            value={audio.prefs.voice}
                            onChange={(e) => {
                              pendingSpeechPage.current = null;
                              audio.configure({ ...audio.prefs, voice: e.target.value });
                            }}
                          >
                            <option value="">Автоматически по языку текста</option>
                            {audio.prefs.voice &&
                              !audio.voices.some((v) => v.voiceURI === audio.prefs.voice) && (
                                <option value={audio.prefs.voice}>
                                  Сохранённый голос недоступен — автоматически
                                </option>
                              )}
                            {audio.voices.map((v) => (
                              <option key={v.voiceURI} value={v.voiceURI}>
                                {v.name} · {v.lang}
                                {v.localService ? ' · на устройстве' : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="check">
                          <input
                            checked={audio.prefs.autoNext}
                            onChange={(e) => {
                              pendingSpeechPage.current = null;
                              audio.configure({ ...audio.prefs, autoNext: e.target.checked });
                            }}
                            type="checkbox"
                          />
                          Продолжать на следующей странице
                        </label>
                        <div className="card-actions">
                          <button
                            className="primary"
                            disabled={locked || !content}
                            onClick={() => listen()}
                          >
                            Произнести страницу
                          </button>
                          {selection && (
                            <button
                              disabled={locked}
                              onClick={() => listen(selection, 'selection')}
                            >
                              Произнести выделение
                            </button>
                          )}
                        </div>
                        {audio.current && (
                          <p className="reader-speech-excerpt">{audio.current.text}</p>
                        )}
                        <p className="helper">
                          Голоса предоставляет браузер или устройство. Некоторые голоса требуют
                          интернета. Изменение голоса или скорости останавливает чтение.
                        </p>
                        {!content && (
                          <p>
                            У скана нет текста для озвучки. Откройте поиск и распознайте страницу.
                          </p>
                        )}
                      </>
                    )}
                  </>
                )}
                {panel === 'settings' && (
                  <>
                    <fieldset className="reader-themes">
                      <legend>Оформление</legend>
                      {(['light', 'sepia', 'dark'] as const).map((theme, i) => (
                        <button
                          key={theme}
                          aria-pressed={prefs.theme === theme}
                          onClick={() => setPrefs({ ...prefs, theme })}
                        >
                          {['Светлая', 'Сепия', 'Тёмная'][i]}
                        </button>
                      ))}
                    </fieldset>
                    {pdf && (
                      <>
                        <label>
                          Масштаб PDF · {prefs.zoom}%
                          <input
                            aria-label="Масштаб PDF"
                            type="range"
                            min={50}
                            max={200}
                            step={10}
                            value={prefs.zoom}
                            onChange={(e) => setPrefs({ ...prefs, zoom: Number(e.target.value) })}
                          />
                        </label>
                        <button onClick={() => setPrefs({ ...prefs, zoom: 100 })}>
                          По ширине страницы
                        </button>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={pdfTextMode}
                            onChange={(e) => setPdfTextMode(e.target.checked)}
                          />
                          Читать текст PDF
                        </label>
                      </>
                    )}
                    {!pdf || pdfTextMode ? (
                      <>
                        <label>
                          Размер текста · {prefs.fontSize}px
                          <input
                            aria-label="Размер текста"
                            type="range"
                            min={16}
                            max={32}
                            step={1}
                            value={prefs.fontSize}
                            onChange={(e) =>
                              setPrefs({ ...prefs, fontSize: Number(e.target.value) })
                            }
                          />
                        </label>
                        <label>
                          Шрифт
                          <select
                            aria-label="Шрифт чтения"
                            value={prefs.font}
                            onChange={(e) =>
                              setPrefs({ ...prefs, font: e.target.value as 'serif' | 'sans' })
                            }
                          >
                            <option value="serif">Книжный</option>
                            <option value="sans">Без засечек</option>
                          </select>
                        </label>
                        <label>
                          Ширина текста
                          <select
                            aria-label="Ширина текста"
                            value={prefs.column}
                            onChange={(e) => setPrefs({ ...prefs, column: Number(e.target.value) })}
                          >
                            <option value={52}>Узкая</option>
                            <option value={72}>Обычная</option>
                            <option value={90}>Широкая</option>
                          </select>
                        </label>
                        <label>
                          Межстрочный интервал
                          <input
                            aria-label="Межстрочный интервал"
                            type="range"
                            min={1.4}
                            max={2.2}
                            step={0.1}
                            value={prefs.lineHeight}
                            onChange={(e) =>
                              setPrefs({ ...prefs, lineHeight: Number(e.target.value) })
                            }
                          />
                        </label>
                      </>
                    ) : (
                      <p className="helper">
                        Для PDF используйте масштаб. Размер шрифта и интервал доступны в режиме
                        «Читать текст PDF».
                      </p>
                    )}
                    <button onClick={() => setPrefs({ ...defaultPreferences })}>
                      Сбросить оформление
                    </button>
                    <p className="helper">{storageHint}</p>
                    <p className="helper">
                      ← / → и Page Up / Page Down — страницы; Ctrl+F — поиск. Esc возвращает
                      инструменты или закрывает панель.
                    </p>
                  </>
                )}
                {panel === 'search' && (
                  <>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void search();
                      }}
                    >
                      <label>
                        Найти в тексте
                        <input
                          ref={searchInput}
                          value={query}
                          maxLength={200}
                          onChange={(e) => {
                            setQuery(e.target.value);
                            searchVersion.current++;
                            setSearching(false);
                            setSearched(false);
                            setResults([]);
                          }}
                        />
                      </label>
                      <button disabled={searching || !query.trim()}>
                        {searching ? 'Ищем…' : 'Найти фрагмент'}
                      </button>
                    </form>
                    {pdf && (
                      <details className="ocr-controls">
                        <summary>Распознать скан</summary>
                        <label>
                          Язык скана
                          <select
                            value={ocrLanguage}
                            disabled={ocrBusy}
                            onChange={(e) => setOcrLanguage(e.target.value as 'rus' | 'eng')}
                          >
                            <option value="rus">Русский</option>
                            <option value="eng">Английский</option>
                          </select>
                        </label>
                        <button disabled={locked} onClick={() => void recognize()}>
                          Распознать текущую страницу
                        </button>
                        {ocrBusy && (
                          <>
                            <p role="status">Распознаём: {ocrProgress}%</p>
                            <button onClick={() => ocrAbort.current?.abort()}>
                              Отменить распознавание
                            </button>
                          </>
                        )}
                        <p className="helper">
                          Обработка скана выполняется на устройстве; языковая модель загружается из
                          интернета. Распознанный текст участвует в поиске до закрытия книги.
                        </p>
                      </details>
                    )}
                    {searching && (
                      <>
                        <p role="status">
                          Проверено страниц: {searchProgress}
                          {pdf ? ' из ' + pdf.numPages : ''}
                        </p>
                        <button
                          onClick={() => {
                            searchVersion.current++;
                            setSearching(false);
                            setNotice('Поиск остановлен.');
                          }}
                        >
                          Остановить поиск
                        </button>
                      </>
                    )}
                    {searched && (
                      <p>
                        {results.length
                          ? 'Найдено страниц: ' + results.length
                          : 'Совпадений нет. Для сканированных PDF нужен текстовый слой.'}
                      </p>
                    )}
                    {results.map((r) => (
                      <button
                        className="reader-search-result"
                        disabled={locked}
                        key={r.page}
                        onClick={() => {
                          if (pdf) setPdfTextMode(true);
                          void change({ ...reading, page: r.page }, true);
                        }}
                      >
                        <b>Страница {r.page}</b>
                        <span>{r.snippet}</span>
                      </button>
                    ))}
                    {results.length === 100 && (
                      <p className="helper">
                        Показаны первые 100 совпадений по страницам. Уточните запрос.
                      </p>
                    )}
                  </>
                )}
                {panel === 'notes' && (
                  <>
                    {noteError && (
                      <div className="notice error" role="alert">
                        {noteError}
                        <button disabled={noteBusy} onClick={() => setNoteRevision((n) => n + 1)}>
                          Обновить заметки
                        </button>
                      </div>
                    )}
                    {draft && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void saveNote();
                        }}
                      >
                        <small>Страница {draft.page}</small>
                        <p className="helper">
                          {draftStorageError
                            ? 'Черновик только в памяти: хранилище вкладки недоступно.'
                            : 'Черновик сохраняется в этой вкладке.'}
                        </p>
                        {draft.quote && <blockquote>{draft.quote}</blockquote>}
                        <label>
                          Название записи
                          <input
                            disabled={noteSaving || !!draft.pending}
                            required
                            maxLength={200}
                            value={draft.title}
                            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                          />
                        </label>
                        <label>
                          Мысль или вопрос
                          <textarea
                            disabled={noteSaving || !!draft.pending}
                            required
                            maxLength={20000}
                            value={draft.text}
                            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                          />
                        </label>
                        <button className="primary" disabled={noteSaving}>
                          {draft.pending ? 'Проверить сохранение' : 'Сохранить запись'}
                        </button>
                        <button
                          type="button"
                          disabled={noteSaving || !!draft.pending}
                          onClick={() => {
                            if (
                              !draft.text.trim() ||
                              window.confirm('Отменить несохранённую заметку?')
                            )
                              setDraft(null);
                          }}
                        >
                          Отменить запись
                        </button>
                      </form>
                    )}
                    {noteBusy && <p role="status">Загружаем заметки…</p>}
                    {notes.map((n) => {
                      const note = decodeReaderNote(n.body)!;
                      return (
                        <article className="reader-note" key={n.id}>
                          <button
                            disabled={locked || note.page > reading.total_pages}
                            onClick={() => void change({ ...reading, page: note.page }, true)}
                          >
                            Открыть страницу {note.page}
                          </button>
                          <h4>{n.title}</h4>
                          {note.quote && <blockquote>{note.quote}</blockquote>}
                          <p>{note.text}</p>
                        </article>
                      );
                    })}
                    {!noteBusy && !notes.length && !noteError && (
                      <p>
                        Сохраните вопрос или выделите текст и добавьте свою мысль. Запись появится и
                        в «Мои заметки».
                      </p>
                    )}
                    <div className="card-actions">
                      <button
                        disabled={noteBusy || !noteOffset}
                        onClick={() => setNoteOffset((n) => Math.max(0, n - 50))}
                      >
                        Предыдущие записи
                      </button>
                      <button
                        disabled={noteBusy || !moreNotes}
                        onClick={() => setNoteOffset((n) => n + 50)}
                      >
                        Следующие записи
                      </button>
                    </div>
                  </>
                )}
              </aside>
            )}
            <div
              ref={documentArea}
              className="reader-document"
              tabIndex={0}
              onMouseUp={captureSelection}
              onTouchEnd={captureSelection}
              aria-label="Область чтения"
              style={
                {
                  '--reader-font-size': prefs.fontSize + 'px',
                  '--reader-line-height': prefs.lineHeight,
                  '--reader-column': prefs.column + 'ch',
                  '--reader-font':
                    prefs.font === 'sans'
                      ? 'Arial, Helvetica, sans-serif'
                      : 'Georgia, Times New Roman, serif',
                } as React.CSSProperties
              }
            >
              {selection && (
                <div className="reader-selection">
                  <span>Выделено: {selection.length} символов</span>
                  <button onClick={() => void copySelection()}>Копировать цитату</button>
                  {audio.supported && (
                    <button onClick={() => listen(selection, 'selection')}>
                      Произнести выделение
                    </button>
                  )}
                  {allowNotes && (
                    <button onClick={() => startNote(selection)}>Заметка из выделения</button>
                  )}
                </div>
              )}
              {pages ? (
                <div className="reader-text" aria-label="Текст страницы">
                  {highlighted(pages[reading.page - 1])}
                </div>
              ) : pdfTextMode ? (
                <div className="reader-text" aria-label="Текст PDF-страницы">
                  {pageText
                    ? highlighted(pageText)
                    : !rendering
                      ? 'На этой странице нет текстового слоя. Переключитесь на отображение страниц.'
                      : ''}
                </div>
              ) : (
                <>
                  <canvas ref={canvas} aria-label={'PDF · страница ' + reading.page} />
                  {pageText && (
                    <details>
                      <summary>Текст PDF-страницы</summary>
                      <p className="reader-text">{highlighted(pageText)}</p>
                    </details>
                  )}
                </>
              )}
              {rendering && <p role="status">Отображаем страницу…</p>}
            </div>
          </div>
          {audio.state !== 'idle' && (
            <div className="reader-audio-player" aria-label="Управление озвучкой">
              <span>
                {audio.mode === 'selection' ? 'Выделенный фрагмент' : 'Страница ' + reading.page} ·{' '}
                {audio.prefs.rate}×{audio.state === 'paused' ? ' · Пауза' : ''}
              </span>
              <button onClick={audio.state === 'paused' ? audio.resume : audio.pause}>
                {audio.state === 'paused' ? 'Продолжить озвучку' : 'Пауза'}
              </button>
              <button
                onClick={() => {
                  pendingSpeechPage.current = null;
                  audio.stop();
                }}
              >
                Остановить озвучку
              </button>
            </div>
          )}
          <div className="reader-bottom">
            {returnPage !== null && returnPage !== reading.page && (
              <button
                className="reader-return"
                disabled={locked}
                onClick={() => void change({ ...reading, page: returnPage }, true)}
              >
                Вернуться к странице {returnPage}
              </button>
            )}
            <p>
              Страница {reading.page} из {reading.total_pages} · Прогресс:{' '}
              {Math.round((reading.page / reading.total_pages) * 100)}%
            </p>
            <progress aria-label="Прогресс чтения" max={reading.total_pages} value={reading.page} />
            {reading.total_pages > 1 && (
              <div className="reader-navigation">
                <button
                  disabled={locked || reading.page <= 1}
                  onClick={() => void change({ ...reading, page: reading.page - 1 })}
                >
                  Предыдущая страница
                </button>
                <form
                  className="reader-jump"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const p = Number(new FormData(e.currentTarget).get('page'));
                    if (Number.isInteger(p) && p >= 1 && p <= reading.total_pages)
                      void change({ ...reading, page: p }, true);
                  }}
                >
                  <label>
                    Страница
                    <input
                      key={reading.page}
                      name="page"
                      type="number"
                      min={1}
                      max={reading.total_pages}
                      defaultValue={reading.page}
                      required
                      disabled={locked}
                    />
                  </label>
                  <button disabled={locked}>Перейти к странице</button>
                </form>
                <button
                  disabled={locked || reading.page >= reading.total_pages}
                  onClick={() => void change({ ...reading, page: reading.page + 1 })}
                >
                  Следующая страница
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
