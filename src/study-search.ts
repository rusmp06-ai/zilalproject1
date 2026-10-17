import { noteText, decodeReaderNote } from './reader-tools';
import { loadPlan } from './personal-plan';
import type { Gateway, Snapshot } from './types';
export type SearchKind = 'course' | 'material' | 'assignment' | 'book' | 'note' | 'plan';
export type SearchFilter = 'all' | Exclude<SearchKind, 'plan'>;
export type SearchResult = {
  id: string;
  kind: SearchKind;
  title: string;
  highlightedTitle?: string;
  snippet: string;
  courseId?: string | null;
  courseTitle?: string | null;
  hasFile?: boolean;
  due?: string | null;
  status?: string | null;
};
export type SearchPage = { items: SearchResult[]; hasMore: boolean; issues: string[] };
export const searchFilters: Record<SearchFilter, string> = {
  all: 'Всё',
  material: 'Материалы',
  course: 'Дисциплины',
  assignment: 'Задания',
  book: 'Книги',
  note: 'Заметки',
};
export const searchKinds: Record<SearchKind, string> = {
  course: 'Дисциплина',
  material: 'Материал',
  assignment: 'Задание',
  book: 'Библиотека',
  note: 'Личная заметка',
  plan: 'Личная задача',
};
const tokens = (query: string) => query.toLocaleLowerCase('ru').match(/[\p{L}\p{N}]+/gu) || [];
const stem = (word: string) =>
  word.replace(
    /(иями|ями|ами|ого|ему|ыми|ими|ая|яя|ое|ее|ые|ие|ий|ый|ой|ов|ев|ам|ям|ах|ях|ом|ем|ы|и|а|я|у|ю|е|о|ь)$/u,
    '',
  );
export function searchHighlight(text: string, query: string) {
  const words = tokens(query)
    .map(stem)
    .filter((w) => w.length > 1);
  return text.replace(/[\p{L}\p{N}_.-]+/gu, (word) =>
    words.some((w) => word.toLocaleLowerCase('ru').includes(w)) ? '⟦' + word + '⟧' : word,
  );
}
// Compatibility path uses the existing authorized catalogs. Live databases use the SQL search RPC.
export async function catalogSearch(
  api: Gateway,
  snapshot: Snapshot,
  query: string,
  filter: SearchFilter,
  offset: number,
  signal?: AbortSignal,
): Promise<SearchPage> {
  const q = query.trim().toLocaleLowerCase('ru'),
    words = tokens(q).map(stem).filter(Boolean),
    found: (SearchResult & { score: number })[] = [],
    issues: string[] = [];
  const check = () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  };
  const add = (item: SearchResult, body: string) => {
    if (
      filter !== 'all' &&
      item.kind !== filter &&
      !(filter === 'assignment' && item.kind === 'plan')
    )
      return;
    const title = item.title.toLocaleLowerCase('ru'),
      text = (title + ' ' + body).toLocaleLowerCase('ru');
    if (!words.length ? !text.includes(q) : !words.every((w) => text.includes(w))) return;
    const at = Math.max(0, text.indexOf(words[0] || q) - 55),
      excerpt = (body || item.title).slice(
        Math.max(0, at - title.length - 1),
        Math.max(0, at - title.length - 1) + 220,
      );
    found.push({
      ...item,
      highlightedTitle: searchHighlight(item.title, q),
      snippet: searchHighlight(excerpt, q),
      score:
        title === q
          ? 100
          : title.startsWith(q)
            ? 70
            : words.every((w) => title.includes(w))
              ? 50
              : 10,
    });
  };
  if (['all', 'note', 'assignment'].includes(filter))
    try {
      const plan = await loadPlan(api);
      check();
      for (const note of plan.notes)
        add(
          { kind: 'note', id: note.id, title: note.title, snippet: '' },
          noteText(note) + ' ' + (decodeReaderNote(note.body)?.quote || ''),
        );
      for (const task of plan.tasks)
        add(
          {
            kind: 'plan',
            id: task.id,
            title: task.title,
            snippet: '',
            due: task.plan.due ? task.plan.due + 'T23:59:59+06:00' : null,
            status: task.plan.done ? 'completed' : 'pending',
          },
          task.plan.details,
        );
    } catch (e) {
      check();
      issues.push('Личные записи не загрузились.');
    }
  if (filter === 'all' || filter === 'book')
    try {
      const books = [];
      for (let page = 0; page < 100000; page += 50) {
        check();
        const result = await api.library('', page);
        if (!result.canRead) break;
        books.push(...result.items);
        if (result.items.length < 50) break;
        if (page === 99950) throw Error('Limit');
      }
      for (const book of books.filter((b) => b.status === 'published'))
        add({ kind: 'book', id: book.id, title: book.title, snippet: '' }, book.original_name);
    } catch {
      check();
      issues.push('Библиотека не загрузилась.');
    }
  const courses = snapshot.courses.filter((c) => !c.archived);
  for (let start = 0; start < courses.length; start += 3) {
    check();
    await Promise.all(
      courses.slice(start, start + 3).map(async (course) => {
        if (filter === 'all' || filter === 'course')
          add(
            {
              kind: 'course',
              id: course.id,
              title: course.title,
              snippet: '',
              courseId: course.id,
            },
            '',
          );
        if (filter === 'all' || filter === 'assignment')
          try {
            const page = await api.assignments(course.id);
            const progress = page.canSubmit
              ? await api.assignmentProgress(page.items.map((a) => a.id))
              : [];
            check();
            for (const task of page.items)
              add(
                {
                  kind: 'assignment',
                  id: task.id,
                  title: task.title,
                  snippet: '',
                  courseId: course.id,
                  courseTitle: course.title,
                  due: task.due_at,
                  status: page.canSubmit
                    ? progress.find((p) => p.assignment_id === task.id)?.status || 'not_submitted'
                    : null,
                },
                task.description,
              );
          } catch {
            check();
            issues.push('Задания «' + course.title + '» не загрузились.');
          }
        if (filter === 'all' || filter === 'material')
          for (const kind of ['lecture', 'presentation', 'material'] as const)
            try {
              const materials = [];
              for (let page = 0; page < 100000; page += 50) {
                check();
                const result = await api.courseMaterials(course.id, kind, page);
                materials.push(...result.items);
                if (result.items.length < 50) break;
                if (page === 99950) throw Error('Limit');
              }
              for (const material of materials.filter((m) => m.status === 'published'))
                add(
                  {
                    kind: 'material',
                    id: material.id,
                    title: material.title,
                    snippet: '',
                    courseId: course.id,
                    courseTitle: course.title,
                    hasFile: !!material.file_id,
                  },
                  material.body + ' ' + (material.original_name || ''),
                );
            } catch {
              check();
              issues.push('Материалы «' + course.title + '» не загрузились.');
            }
      }),
    );
  }
  check();
  found.sort(
    (a, b) =>
      b.score - a.score ||
      a.title.localeCompare(b.title, 'ru') ||
      a.kind.localeCompare(b.kind) ||
      a.id.localeCompare(b.id),
  );
  return {
    items: found.slice(offset, offset + 25).map(({ score, ...item }) => item),
    hasMore: found.length > offset + 25,
    issues: [...new Set(issues)],
  };
}
