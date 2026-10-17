import { useEffect, useMemo, useRef } from 'react';
import { ReaderPanel } from './ReaderPanel';
import { emptyReading, validateReading } from './reader-state';
import type { Gateway, Work, LibraryItem, ReadingState } from './types';
/** Submission files keep their own access checks and never enter the public library. */
export function TeacherWorkReader({
  api,
  work,
  onClose,
  initialReading,
  onReadingChange,
}: {
  api: Gateway;
  work: Work;
  onClose: () => void;
  initialReading?: ReadingState;
  onReadingChange?: (s: ReadingState) => void;
}) {
  const dialog = useRef<HTMLElement>(null),
    reading = useRef(initialReading?.item_id === work.id ? initialReading : emptyReading(work.id));
  const bridge = useMemo(() => {
    const item: LibraryItem = {
      id: work.id,
      title: work.original_name || 'Файл работы',
      author_id: work.student_id,
      author_name: work.student_name,
      source_group_id: '',
      group_name: '',
      created_at: work.submitted_at || new Date().toISOString(),
      status: 'published',
      storage_path: work.storage_path || '',
      original_name: work.original_name || 'work',
      mime_type: work.mime_type || 'application/octet-stream',
      size_bytes: work.size_bytes || 0,
      can_manage: false,
    };
    const gateway: Gateway = {
      ...api,
      downloadLibrary: () => api.downloadWork(work),
      readingState: async () => reading.current,
      saveReading: async (next) => {
        validateReading(next);
        reading.current = { ...next, version: reading.current.version + 1 };
        onReadingChange?.(reading.current);
        return reading.current;
      },
    };
    return { item, gateway };
  }, [api, work]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null,
      overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape' && !document.fullscreenElement) {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Tab') {
        const nodes = [
          ...(dialog.current?.querySelectorAll<HTMLElement>(
            'button,input,select,textarea,summary,[tabindex]',
          ) || []),
        ].filter(
          (n) =>
            n.getClientRects().length > 0 &&
            !n.hasAttribute('disabled') &&
            n.getAttribute('tabindex') !== '-1',
        );
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0]?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return (
    <section
      ref={dialog}
      className="preview-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Файл работы студента"
    >
      <div className="preview-content">
        <header>
          <div>
            <h2>{work.original_name}</h2>
            <p>
              {work.student_name} · попытка {work.attempt_no}
            </p>
          </div>
          <button autoFocus onClick={onClose}>
            Закрыть файл работы
          </button>
        </header>
        <ReaderPanel
          api={bridge.gateway}
          item={bridge.item}
          allowFavorite={false}
          allowNotes={false}
          storageHint="Файл доступен только по правам на эту работу. Позиция и закладки сохраняются, пока работа открыта в кабинете."
          onChanged={() => {}}
        />
      </div>
    </section>
  );
}
