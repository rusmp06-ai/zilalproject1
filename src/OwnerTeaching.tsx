import { useEffect, useState } from 'react';
import type { Gateway, Snapshot } from './types';
export function OwnerTeaching({
  api,
  snapshot,
  user,
}: {
  api: Gateway;
  snapshot: Snapshot;
  user: string;
}) {
  const [courses, setCourses] = useState<string[] | null>(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setCourses(null);
    setError('');
    const groups = [
      ...new Set(
        snapshot.memberships
          .filter((m) => m.user_id === user && m.active && m.role === 'teacher')
          .map((m) => m.group_id),
      ),
    ];
    void (async () => {
      const ids = new Set<string>();
      for (const group of groups)
        for (let offset = 0; offset < 100000; offset += 50) {
          const rows = await api.teachingCatalog(group, offset);
          for (const row of rows) if (row.teacher_id === user) ids.add(row.course_id);
          if (rows.length < 50) break;
          if (offset === 99950) throw Error('Limit');
        }
      return [...ids];
    })()
      .then((ids) => {
        if (active) setCourses(ids);
      })
      .catch(() => {
        if (active) setError('Назначения преподавателя не удалось загрузить.');
      });
    return () => {
      active = false;
    };
  }, [api, snapshot, user, revision]);
  return (
    <div>
      <h4>Назначенные дисциплины</h4>
      {error ? (
        <p role="alert">
          {error}
          <button onClick={() => setRevision((n) => n + 1)}>Повторить загрузку назначений</button>
        </p>
      ) : courses === null ? (
        <p role="status">Проверяем назначения…</p>
      ) : courses.length ? (
        courses.map((id) => {
          const course = snapshot.courses.find((c) => c.id === id);
          return (
            <p key={id}>
              {course?.title || 'Дисциплина недоступна'} ·{' '}
              {snapshot.groups.find((g) => g.id === course?.group_id)?.name || 'Группа недоступна'}
              {course?.archived ? ' · архив' : ''}
            </p>
          );
        })
      ) : (
        <p>Дисциплины не назначены.</p>
      )}
    </div>
  );
}
