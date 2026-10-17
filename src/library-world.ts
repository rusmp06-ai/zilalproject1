import type { Gateway, LibraryItem, LibraryPage } from './types';
export type BookFormat =
  | 'PDF'
  | 'EPUB'
  | 'DOCX'
  | 'TXT'
  | 'Презентация'
  | 'Таблица'
  | 'Изображение'
  | 'Другой';
export function bookFormat(item: LibraryItem): BookFormat {
  const mime = item.mime_type;
  if (mime === 'application/pdf') return 'PDF';
  if (mime === 'application/epub+zip') return 'EPUB';
  if (mime.includes('wordprocessingml')) return 'DOCX';
  if (mime === 'text/plain') return 'TXT';
  if (mime.includes('presentationml')) return 'Презентация';
  if (mime.includes('spreadsheetml')) return 'Таблица';
  if (mime.startsWith('image/')) return 'Изображение';
  return 'Другой';
}
export function coverPalette(id: string) {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return hash % 6;
}
export async function libraryCatalog(
  api: Gateway,
  query: string,
  favorites: boolean,
): Promise<LibraryPage> {
  const items: LibraryItem[] = [],
    seen = new Set<string>();
  let quota: LibraryPage['quota'] = null;
  for (let offset = 0; offset < 5000; offset += 50) {
    const page = await api.library(query, offset, favorites);
    if (!page.canRead) return { items: [], canRead: false, quota: null };
    quota = page.quota;
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    if (page.items.length < 50) return { items, canRead: true, quota };
  }
  throw Error('Каталог слишком большой для полной загрузки. Уточните название в поиске.');
}
export function libraryShelf(
  items: LibraryItem[],
  shelf: 'all' | 'reading',
  format: string,
  sort: 'new' | 'title',
) {
  return items
    .filter(
      (i) =>
        (shelf !== 'reading' ||
          (i.status === 'published' &&
            (i.total_pages || 0) > 1 &&
            (i.page || 1) < (i.total_pages || 0))) &&
        (!format || bookFormat(i) === format),
    )
    .sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title, 'ru')
        : b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id),
    );
}
