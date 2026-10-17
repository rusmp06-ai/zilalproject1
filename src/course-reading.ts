import { emptyReading, validateReading } from './reader-state';
import type { Gateway, ReadingState } from './types';
// Only a missing RPC activates legacy storage. Network/access failures stay visible.
export function courseReading(
  api: Gateway,
  user: string,
  item: string,
  onLocal: (limited: boolean) => void,
) {
  const key = 'studyhub-course-reading-v1:' + user + ':' + item;
  let local = false,
    memoryOnly = false,
    memory = emptyReading(item);
  function legacy() {
    try {
      const raw = memoryOnly ? null : localStorage.getItem(key);
      if (raw) {
        const value = JSON.parse(raw) as ReadingState;
        validateReading(value);
        if (value.item_id === item) memory = { ...value, favorite: false };
      }
    } catch {
      /* Ignore invalid device metadata. */
    }
    return { ...memory, bookmarks: [...memory.bookmarks] };
  }
  return {
    async read() {
      if (local) return legacy();
      let current: ReadingState;
      try {
        current = await api.courseReadingState(item);
      } catch (e) {
        if ((e as { code?: string }).code !== 'PGRST202') throw e;
        local = true;
        onLocal(false);
        return legacy();
      }
      // Never overwrite an account's existing marks with this device's old copy.
      const old = legacy();
      if (current.version === 0 && old.version > 0 && old.total_pages > 0) {
        current = await api.saveCourseReading({ ...old, version: 0, favorite: false });
        try {
          localStorage.removeItem(key);
        } catch {
          /* Server copy is already saved. */
        }
      }
      return current;
    },
    async save(next: ReadingState) {
      validateReading(next);
      if (next.item_id !== item) throw Error('Документ изменился. Откройте его заново.');
      if (!local) return api.saveCourseReading({ ...next, favorite: false });
      const current = legacy();
      if (current.version !== next.version)
        throw Error('Позиция изменилась в другой вкладке. Обновите отметки.');
      memory = {
        ...next,
        favorite: false,
        version: current.version + 1,
        bookmarks: [...new Set(next.bookmarks)].sort((a, b) => a - b),
      };
      try {
        localStorage.setItem(key, JSON.stringify(memory));
      } catch {
        memoryOnly = true;
        onLocal(true);
      }
      return legacy();
    },
  };
}
