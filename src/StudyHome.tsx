import { useViewState, validDate, shortText } from './view-state';
import { isOverdue } from './notifications';
import { LessonNow, type ScheduleStatus } from './LessonNow';
import { LessonTimeline } from './LessonTimeline';
import { forgetSchedule, savedSchedules } from './schedule-cache';
import { enableOffline } from './offline-files';
import { boardNotice } from './board-notice';
import { studyDate } from './lesson-day';
import { useSchedule } from './useSchedule';
import { calendarFile, downloadCalendar } from './calendar-export';
import { StudyIcon } from './StudyIcon';
import { PlanPanel } from './PlanPanel';
import { loadTasks, type PlanTask } from './personal-plan';
import { useEffect, useState, useRef } from 'react';
import { groupContext } from './group-context';
import { bishkekInput, boardInstant, boardDate, boardWindow } from './board-time';
import type { Gateway, Snapshot, Assignment, BoardItem, LibraryItem } from './types';

type View = 'home' | 'tasks' | 'calendar';
type Task = Assignment & { courseTitle: string; progress?: string };
type Data = {
  notices: BoardItem[];
  scheduleStatus: ScheduleStatus;
  scheduleSavedAt: string | null;
  scheduleStored: boolean;
  events: BoardItem[];
  personal: PlanTask[];
  tasks: Task[];
  books: LibraryItem[];
  issues: string[];
  scheduleAllowed: boolean;
  libraryAllowed: boolean;
  moreEvents: boolean;
};
const empty = (): Data => ({
  notices: [],
  scheduleStatus: 'loading',
  scheduleSavedAt: null,
  scheduleStored: false,
  events: [],
  personal: [],
  tasks: [],
  books: [],
  issues: [],
  scheduleAllowed: true,
  libraryAllowed: true,
  moreEvents: false,
});
const dateKey = (iso: string) => bishkekInput(iso).slice(0, 10);
const dayLabel = (date: string) =>
  new Date(date + 'T12:00:00+06:00').toLocaleDateString('ru-RU', {
    timeZone: 'Asia/Bishkek',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
export function StudyHome({
  api,
  snapshot,
  view = 'home',
  onNavigate,
  onCourse,
  onRead,
}: {
  api: Gateway;
  snapshot: Snapshot;
  view?: View;
  onNavigate: (tab: string) => void;
  onCourse: (course: string, task?: string, start?: 'materials' | 'notes') => void;
  onRead: (item: LibraryItem) => void;
}) {
  const [selectedGroup, setGroup] = useState(groupContext(snapshot).id),
    [date, setDate] = useViewState<string>(
      view === 'calendar' ? 'calendar' : view === 'tasks' ? 'tasks' : 'overview',
      'date',
      dateKey(new Date().toISOString()),
      validDate,
    ),
    [baseData, setData] = useState<Data>(empty),
    [busy, setBusy] = useState(true),
    [search, setSearch] = useViewState<string>(
      view === 'tasks' ? 'tasks' : 'calendar',
      'query',
      '',
      shortText,
    ),
    [revision, setRevision] = useState(0),
    [offset, setOffset] = useState(0);
  const context = groupContext(snapshot, selectedGroup),
    group = context.id,
    user = (api.demo ? 'demo:' : 'live:') + snapshot.me.id;
  const todayRef = useRef<HTMLElement>(null),
    timelineRef = useRef<HTMLDetailsElement>(null);
  const courses = snapshot.courses.filter((c) => c.group_id === group && !c.archived),
    month = date.slice(0, 7);
  const bounds =
    view === 'calendar'
      ? {
          from: boardInstant(month + '-01T00:00'),
          to: new Date(
            Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1) - 6 * 3600000,
          ).toISOString(),
        }
      : boardWindow(date);
  const schedule = useSchedule(
    api,
    user,
    view === 'tasks' ? '' : group,
    context.name,
    bounds.from,
    bounds.to,
    revision,
    view === 'home' ? new Date(Date.parse(bounds.from) + 86400000).toISOString() : bounds.to,
  );
  const [offlineReady, setOfflineReady] = useState(false);
  const data = {
    ...baseData,
    ...schedule,
    scheduleStored: schedule.scheduleStored && offlineReady,
    issues: [
      ...baseData.issues,
      ...(['saved', 'error'].includes(schedule.scheduleStatus)
        ? ['Расписание не удалось загрузить полностью. Попробуйте ещё раз.']
        : []),
    ],
  };
  useEffect(() => {
    let active = true;
    if (view === 'home' && schedule.scheduleStored)
      void enableOffline()
        .then(() => {
          if (active) setOfflineReady(true);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [view, schedule.scheduleStored]);
  useEffect(() => {
    setGroup((old) => groupContext(snapshot, old).id);
  }, [snapshot]);
  useEffect(() => {
    setOffset(0);
  }, [group]);
  useEffect(() => {
    for (const copy of savedSchedules(user))
      if (!snapshot.groups.some((g) => g.id === copy.groupId && !g.blocked))
        forgetSchedule(user, copy.groupId);
  }, [snapshot, user]);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setData(empty());
    const run = async () => {
      const next = empty();
      const operations: Promise<void>[] = [
        loadTasks(api)
          .then((p) => {
            next.personal = p;
          })
          .catch(() => {
            next.issues.push('Личный план не удалось загрузить.');
          }),
      ];
      if (group && view === 'home')
        operations.push(
          (async () => {
            try {
              for (let offset = 0; offset <= 100000; offset += 50) {
                const p = await api.board(group, 'announcement', null, null, offset);
                if (!p.canRead) return;
                next.notices.push(
                  ...p.items.filter(
                    (n) =>
                      boardNotice(n.body).important &&
                      Date.parse(n.created_at) > Date.now() - 7 * 86400000,
                  ),
                );
                if (p.items.length < 50 || next.notices.length >= 5) {
                  next.notices = next.notices.slice(0, 5);
                  return;
                }
              }
              throw Error('Notice limit');
            } catch {
              next.notices = [];
              next.issues.push('Изменения расписания не удалось проверить.');
            }
          })(),
        );
      operations.push(
        (async () => {
          // Limit concurrent course requests; each catalog enforces access on the server.
          for (let i = 0; i < courses.length; i += 4) {
            await Promise.all(
              courses.slice(i, i + 4).map(async (c) => {
                try {
                  const p = await api.assignments(c.id);
                  let status: import('./types').AssignmentProgress[] | null = null;
                  if (p.canSubmit) {
                    try {
                      status = await api.assignmentProgress(p.items.map((a) => a.id));
                    } catch {
                      next.issues.push(`Статусы сдачи дисциплины «${c.title}» не загрузились.`);
                    }
                  }
                  next.tasks.push(
                    ...p.items.map((a) => ({
                      ...a,
                      courseTitle: c.title,
                      progress: p.canSubmit
                        ? status
                          ? status.find((s) => s.assignment_id === a.id)?.status || 'not_submitted'
                          : 'unknown'
                        : undefined,
                    })),
                  );
                } catch {
                  next.issues.push(
                    `Задания дисциплины «${c.title}» недоступны или не загрузились.`,
                  );
                }
              }),
            );
          }
          next.tasks.sort(
            (a, b) =>
              (a.due_at || '9999').localeCompare(b.due_at || '9999') ||
              a.title.localeCompare(b.title),
          );
        })(),
      );
      if (view === 'home')
        operations.push(
          api
            .library('', 0, true)
            .then((p) => {
              next.libraryAllowed = p.canRead;
              next.books = p.items.filter((i) => i.status === 'published');
            })
            .catch(() => {
              next.issues.push('Избранное библиотеки не удалось загрузить.');
            }),
        );
      await Promise.all(operations);
      if (active) {
        setData(next);
        setBusy(false);
      }
    };
    void run().catch(() => {
      if (active) {
        setData({
          ...empty(),
          issues: ['Не удалось загрузить учебный день. Попробуйте обновить.'],
        });
        setBusy(false);
      }
    });
    return () => {
      active = false;
    };
  }, [api, snapshot, group, view, view === 'calendar' ? month : date, offset, revision]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => {
      const time = Date.now();
      setNow(time);
      if (view === 'home') setDate(studyDate(time));
    };
    const timer = setInterval(tick, 15000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [view]);
  const todayPending = data.tasks.filter(
    (a) =>
      a.due_at &&
      (dateKey(a.due_at) === date || isOverdue(a.due_at, a.progress, now)) &&
      !['submitted', 'graded'].includes(a.progress || ''),
  );
  const pending = data.tasks.filter((a) => !['submitted', 'graded'].includes(a.progress || ''));
  const dated = pending.filter((a) => a.due_at),
    undated = pending.filter((a) => !a.due_at);
  const tasks =
    view === 'home'
      ? [...dated, ...undated]
          .filter((a) => !a.due_at || !todayPending.some((t) => t.id === a.id))
          .slice(0, 4)
      : data.tasks.filter((a) =>
          (a.title + ' ' + a.courseTitle).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        );
  function taskCard(a: Task) {
    return (
      <button className="study-row" key={a.id} onClick={() => onCourse(a.course_id, a.id)}>
        <span>
          <b>{a.title}</b>
          <small>{a.courseTitle}</small>
          {a.progress && (
            <small className={'assignment-state state-' + a.progress}>
              {(
                {
                  not_submitted: 'Нужно сдать',
                  submitted: 'Сдано · на проверке',
                  graded: 'Оценено',
                  returned: 'Вернули на доработку',
                  uploading: 'Загрузка не завершена',
                  deleting: 'Удаление не завершено',
                  unknown: 'Статус не загружен',
                } as Record<string, string>
              )[a.progress] || 'Откройте задание'}
            </small>
          )}
        </span>
        <span className="study-deadline">
          {a.due_at ? boardDate(a.due_at) : 'Без срока'}
          {isOverdue(a.due_at, a.progress, now) && <small>Срок уже прошёл</small>}
        </span>
      </button>
    );
  }
  function eventCard(e: BoardItem) {
    return (
      <button
        className="study-row"
        key={e.id}
        onClick={() => (e.course_id ? onCourse(e.course_id) : onNavigate('schedule'))}
      >
        <span>
          <b>{e.title}</b>
          <small>{e.location || 'Место не указано'}</small>
        </span>
        <span className="study-deadline">
          {e.starts_at ? boardDate(e.starts_at) : ''}
          {e.ends_at && (
            <small>
              До{' '}
              {new Date(e.ends_at).toLocaleTimeString('ru-RU', {
                timeZone: 'Asia/Bishkek',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </small>
          )}
        </span>
      </button>
    );
  }
  const first = new Date(month + '-01T12:00:00+06:00'),
    days = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate(),
    padding = (first.getUTCDay() + 6) % 7;
  const dailyEvents = data.events.filter(
    (e) =>
      !e.cancelled &&
      e.starts_at &&
      e.ends_at &&
      e.starts_at < new Date(Date.parse(boardInstant(date + 'T00:00')) + 86400000).toISOString() &&
      e.ends_at > boardInstant(date + 'T00:00'),
  );
  const dailyTasks = data.tasks.filter((a) => a.due_at && dateKey(a.due_at) === date);
  return (
    <section
      className="study-home"
      aria-label={
        view === 'home'
          ? 'Мой учебный день'
          : view === 'calendar'
            ? 'Учебный календарь'
            : 'Все учебные задания'
      }
    >
      <div className={view === 'home' ? 'study-heading welcome-heading' : 'study-heading'}>
        <div>
          <div className="eyebrow">{view === 'home' ? 'Ваш учебный день' : 'Ваш учебный план'}</div>
          <h2>
            {view === 'home'
              ? `Здравствуйте, ${snapshot.me.full_name.split(' ')[0]}.`
              : view === 'calendar'
                ? 'Календарь учёбы'
                : 'Задания по дисциплинам'}
          </h2>
          <p>
            {view === 'home'
              ? dayLabel(date)
              : view === 'calendar'
                ? 'Пары, задания и личные задачи вместе. Время — Бишкек.'
                : 'Задания вашей группы и актуальные статусы сдачи.'}
          </p>
        </div>
        <button
          className={view === 'home' ? 'day-refresh' : undefined}
          aria-label="Обновить учебный день"
          title="Обновить учебный день"
          disabled={busy}
          onClick={() => setRevision((n) => n + 1)}
        >
          {view === 'home' ? <StudyIcon name="refresh" /> : 'Обновить учебный день'}
        </button>
      </div>
      <div className="study-controls">
        {context.canChoose ? (
          <label>
            Учебная группа
            <select
              value={group}
              onChange={(e) => {
                setGroup(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">Выберите группу</option>
              {context.groups.map((g) => (
                <option value={g.id} key={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          context.name && (
            <span className="group-context">
              <span>Моя группа</span>
              <b>{context.name}</b>
            </span>
          )
        )}
        {view === 'calendar' && (
          <label>
            Месяц
            <input
              type="month"
              value={month}
              onChange={(e) => {
                if (e.target.value) {
                  setDate(e.target.value + '-01');
                  setOffset(0);
                }
              }}
            />
          </label>
        )}
      </div>
      {busy && <p role="status">Собираем ваше учебное пространство…</p>}
      {data.issues.length > 0 && (
        <details className="day-issues" open={view !== 'home'}>
          <summary>Некоторые данные не обновились ({data.issues.length})</summary>
          <div className="notice error" role="alert">
            {data.issues.map((s) => (
              <p key={s}>{s}</p>
            ))}
            <button onClick={() => setRevision((n) => n + 1)}>Попробовать снова</button>
          </div>
        </details>
      )}
      {!group && (
        <div className="card empty">
          Группа пока недоступна. Если вы уже зарегистрированы в группе, обратитесь к владельцу;
          иначе примите приглашение. Библиотека и личные заметки доступны через меню.
        </div>
      )}
      {view === 'home' && (
        <>
          <LessonNow
            events={data.events}
            now={now}
            status={data.scheduleStatus}
            savedAt={data.scheduleSavedAt}
            stored={data.scheduleStored}
            onRefresh={() => setRevision((n) => n + 1)}
            onMaterials={(e) => e.course_id && onCourse(e.course_id, undefined, 'materials')}
            onNotes={(e) => e.course_id && onCourse(e.course_id, undefined, 'notes')}
            onToday={() => {
              if (timelineRef.current) timelineRef.current.open = true;
              todayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              todayRef.current?.focus({ preventScroll: true });
            }}
          />
          <div className="study-grid day-priorities">
            <section className="card deadlines-card">
              <div className="section-heading">
                <h3>
                  {todayPending.some((a) => isOverdue(a.due_at, a.progress, now))
                    ? 'Требуют внимания'
                    : 'Сдать сегодня'}
                </h3>
                <button onClick={() => onNavigate('tasks')}>Все задания</button>
              </div>
              {todayPending.slice(0, 3).map(taskCard)}
              {!busy && !todayPending.length && (
                <p>
                  {data.issues.some((i) => i.startsWith('Задания') || i.startsWith('Статусы сдачи'))
                    ? 'Не удалось проверить все сроки и статусы. Обновите учебный день.'
                    : 'На сегодня срочных заданий нет.'}
                </p>
              )}
              {todayPending.length > 3 && (
                <button onClick={() => onNavigate('tasks')}>
                  Ещё заданий: {todayPending.length - 3}
                </button>
              )}
            </section>
            {(data.notices.length > 0 || data.issues.some((i) => i.startsWith('Изменения'))) && (
              <section className="card day-changes">
                <div className="section-heading">
                  <h3>Важные изменения</h3>
                  <button onClick={() => onNavigate('announcements')}>Все объявления</button>
                </div>
                {data.notices.map((n) => (
                  <article key={n.id}>
                    <h4>{n.title}</h4>
                    <p>{boardNotice(n.body).text}</p>
                    <small>
                      {n.author_name} · {boardDate(n.created_at)}
                    </small>
                  </article>
                ))}
                {!busy && data.issues.some((i) => i.startsWith('Изменения')) && (
                  <p>Не удалось проверить изменения. Обновите учебный день.</p>
                )}
                {!busy &&
                  !data.notices.length &&
                  !data.issues.some((i) => i.startsWith('Изменения')) && (
                    <p>За неделю важных изменений нет.</p>
                  )}
              </section>
            )}
          </div>
          <details ref={timelineRef} className="home-timeline">
            <summary>Все пары сегодня</summary>
            <section ref={todayRef} className="card today-schedule" tabIndex={-1}>
              <div className="section-heading">
                <h3>Расписание сегодня</h3>
                <button onClick={() => onNavigate('calendar')}>Календарь</button>
              </div>
              {['fresh', 'saved'].includes(data.scheduleStatus) ? (
                <LessonTimeline
                  events={data.events}
                  now={now}
                  onOpen={
                    data.scheduleStatus === 'fresh'
                      ? (e) => (e.course_id ? onCourse(e.course_id) : onNavigate('schedule'))
                      : undefined
                  }
                />
              ) : (
                <p>
                  {data.scheduleStatus === 'loading'
                    ? 'Загружаем расписание…'
                    : data.scheduleStatus === 'denied'
                      ? 'Доступ к расписанию закрыт.'
                      : 'Расписание не загрузилось.'}
                </p>
              )}
            </section>
          </details>
          <PlanPanel
            api={api}
            snapshot={snapshot}
            compact
            onCourse={onCourse}
            onNotes={() => onNavigate('notes')}
            onChanged={() => setRevision((n) => n + 1)}
          />
          <div className="study-shortcuts">
            {[
              ['groups', 'Дисциплины', 'Лекции и материалы'],
              ['schedule', 'Моё расписание', 'Пары и аудитории'],
              ['library', 'Читать и учиться', 'Книги и избранное'],
              ['notes', 'Быстрая заметка', 'Сохранить свою мысль'],
            ].map(([tab, title, sub], i) => (
              <button key={tab} onClick={() => onNavigate(tab)}>
                <span className="shortcut-number">
                  <StudyIcon name={['course', 'calendar', 'book', 'note'][i]} />
                </span>
                <b>{title}</b>
                <small>{sub}</small>
                <span className="shortcut-open" aria-hidden="true">
                  <StudyIcon name="next" />
                </span>
              </button>
            ))}
          </div>
          <details className="home-more">
            <summary>
              Дальше по учёбе<span>Сроки, дисциплины и книги</span>
            </summary>
            <div className="home-more-content">
              <div className="study-grid">
                {' '}
                <section className="card deadlines-card">
                  <div className="section-heading">
                    <h3>Ближайшие сроки</h3>
                    <button onClick={() => onNavigate('tasks')}>
                      Все задания <StudyIcon name="next" />
                    </button>
                  </div>
                  {tasks.map(taskCard)}
                  {!busy && !tasks.length && <p>Ближайших сроков нет.</p>}
                </section>
              </div>
              <section className="study-section">
                <div className="section-heading">
                  <h3>Мои дисциплины</h3>
                  <button onClick={() => onNavigate('groups')}>
                    Открыть список <StudyIcon name="next" />
                  </button>
                </div>
                <div className="study-course-grid">
                  {courses.map((c, i) => (
                    <button key={c.id} className="card study-course" onClick={() => onCourse(c.id)}>
                      <span className="course-monogram">
                        <StudyIcon name="course" />
                      </span>
                      <b>{c.title}</b>
                      <small>Лекции · презентации · материалы</small>
                      <span>
                        Продолжить учёбу <StudyIcon name="next" />
                      </span>
                    </button>
                  ))}
                </div>
                {!courses.length && <p>Когда в группе появятся дисциплины, они будут здесь.</p>}
              </section>
              <section className="card bookshelf-card">
                <div className="section-heading">
                  <h3>Моя книжная полка</h3>
                  <button onClick={() => onNavigate('library')}>
                    В библиотеку <StudyIcon name="next" />
                  </button>
                </div>
                {data.books.slice(0, 4).map((b) => (
                  <button key={b.id} className="study-row" onClick={() => onRead(b)}>
                    <span>
                      <b>{b.title}</b>
                      <small>{b.original_name}</small>
                    </span>
                    <span>
                      {b.total_pages ? `Страница ${b.page || 1} из ${b.total_pages}` : 'Открыть'}{' '}
                      <StudyIcon name="next" />
                    </span>
                  </button>
                ))}
                {!busy && !data.books.length && (
                  <p>
                    {data.libraryAllowed
                      ? 'Добавьте книгу в избранное библиотеки — она появится здесь.'
                      : 'Доступ к библиотеке закрыт.'}
                  </p>
                )}
              </section>
            </div>
          </details>
        </>
      )}
      {view === 'tasks' && (
        <>
          <PlanPanel
            api={api}
            snapshot={snapshot}
            onCourse={onCourse}
            onNotes={() => onNavigate('notes')}
          />
          <label className="study-search">
            Найти задание
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Название или дисциплина"
            />
          </label>
          <section className="card">
            {tasks.map(taskCard)}
            {!busy && !tasks.length && (
              <p>{search ? 'По вашему запросу заданий нет.' : 'Доступных заданий пока нет.'}</p>
            )}
          </section>
        </>
      )}
      {view === 'calendar' && (
        <>
          <button
            disabled={busy || !!data.issues.length}
            onClick={() =>
              downloadCalendar(
                calendarFile(
                  data.events,
                  data.tasks,
                  data.personal.filter((t) => t.plan.due?.startsWith(month)),
                ),
              )
            }
          >
            Скачать календарь с напоминаниями
          </button>
          <p className="helper">Напоминания о парах и заданиях — за 30 минут.</p>
          <div className="calendar-grid" role="group" aria-label="Дни месяца">
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => (
              <span className="calendar-weekday" key={d}>
                {d}
              </span>
            ))}
            {Array.from({ length: padding }, (_, i) => (
              <span key={'pad' + i} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const key = month + '-' + String(i + 1).padStart(2, '0'),
                count =
                  data.events.filter(
                    (e) =>
                      !e.cancelled &&
                      e.starts_at &&
                      e.ends_at &&
                      e.starts_at <
                        new Date(
                          Date.parse(boardInstant(key + 'T00:00')) + 86400000,
                        ).toISOString() &&
                      e.ends_at > boardInstant(key + 'T00:00'),
                  ).length +
                  data.tasks.filter((a) => a.due_at && dateKey(a.due_at) === key).length +
                  data.personal.filter((t) => !t.plan.done && t.plan.due === key).length;
              return (
                <button
                  key={key}
                  aria-label={`${dayLabel(key)}${count ? `, событий: ${count}` : ''}`}
                  aria-pressed={date === key}
                  className={date === key ? 'calendar-day selected' : 'calendar-day'}
                  onClick={() => setDate(key)}
                >
                  <b>{i + 1}</b>
                  {count > 0 && <small>{count}</small>}
                </button>
              );
            })}
          </div>
          <PlanPanel
            key={date}
            api={api}
            snapshot={snapshot}
            date={date}
            onCourse={onCourse}
            onNotes={() => onNavigate('notes')}
            onChanged={() => setRevision((n) => n + 1)}
          />
          <section className="card">
            <h3>{dayLabel(date)}</h3>
            {dailyEvents.map(eventCard)}
            {dailyTasks.map(taskCard)}
            {!busy && !dailyEvents.length && !dailyTasks.length && (
              <p>Пар и сроков заданий на этот день нет в загруженных данных.</p>
            )}
            {!data.scheduleAllowed && <p>Доступ к расписанию закрыт.</p>}
          </section>
        </>
      )}
    </section>
  );
}
