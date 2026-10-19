import { CourseScenery, courseTheme } from './CourseScenery';
import { PageBoundary } from './PageBoundary';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';
import { useAppRoute } from './navigation';
import { type TeacherSection } from './TeacherWorkbench';
import { NotificationBell, useNotifications } from './notifications';
import { AuthPanel } from './AuthPanel';
import { GroupRequests } from './GroupRequests';
import { type OwnerSection } from './OwnerAdminPanel';
import { isLeaderStudent } from './leader-context';
import { OfflineDay } from './OfflineDay';
import { forgetSchedule } from './schedule-cache';
import { mayLeaveDrafts } from './drafts';
import { StudyIcon } from './StudyIcon';
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { groupContext } from './group-context';
import { liveGateway, configured, client } from './api';
import { demoGateway, selectDemo, resetDemo } from './demo';
import type { Gateway, Snapshot } from './types';

const TeacherWorkbench = lazy(() =>
  import('./TeacherWorkbench').then((module) => ({ default: module.TeacherWorkbench })),
);
const ProfilePanel = lazy(() =>
  import('./ProfilePanel').then((module) => ({ default: module.ProfilePanel })),
);
const OwnerOverview = lazy(() =>
  import('./OwnerOverview').then((module) => ({ default: module.OwnerOverview })),
);
const OwnerAdminPanel = lazy(() =>
  import('./OwnerAdminPanel').then((module) => ({ default: module.OwnerAdminPanel })),
);
const LeaderAdminPanel = lazy(() =>
  import('./LeaderAdminPanel').then((module) => ({ default: module.LeaderAdminPanel })),
);
const OfflineShelf = lazy(() =>
  import('./OfflineShelf').then((module) => ({ default: module.OfflineShelf })),
);
const StudySearch = lazy(() =>
  import('./StudySearch').then((module) => ({ default: module.StudySearch })),
);
const StudyHome = lazy(() =>
  import('./StudyHome').then((module) => ({ default: module.StudyHome })),
);
const NotesPanel = lazy(() =>
  import('./NotesPanel').then((module) => ({ default: module.NotesPanel })),
);
const BoardPanel = lazy(() =>
  import('./BoardPanel').then((module) => ({ default: module.BoardPanel })),
);
const SchedulePanel = lazy(() =>
  import('./SchedulePanel').then((module) => ({ default: module.SchedulePanel })),
);
const CoursePanel = lazy(() =>
  import('./CoursePanel').then((module) => ({ default: module.CoursePanel })),
);
const LibraryPanel = lazy(() =>
  import('./LibraryPanel').then((module) => ({ default: module.LibraryPanel })),
);
const labels: Record<string, string> = {
  student: 'Студент',
  leader: 'Староста',
  teacher: 'Преподаватель',
  library: 'Библиотека',
  lectures: 'Лекции',
  presentations: 'Презентации',
  materials: 'Материалы',
  assignments: 'Задания',
  course: 'Дисциплина',
  schedule: 'Расписание',
  announcements: 'Объявления',
};
export function App() {
  const [demo, setDemo] = useState(new URLSearchParams(location.search).get('demo') === '1'),
    [snap, setSnap] = useState<Snapshot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [group, setGroup] = useState(''),
    [directory, setDirectory] = useState<{ id: string; name: string }[]>([]);
  const [pendingRequest, setPendingRequest] = useState<boolean | null>(null);
  useEffect(() => setPendingRequest(null), [snap?.me.id, demo]);
  const [recovery, setRecovery] = useState(false);
  const [ownerSection, setOwnerSection] = useState<OwnerSection>('groups'),
    [ownerGroup, setOwnerGroup] = useState('');
  const { route, go } = useAppRoute();
  const tab = route.tab,
    courseId = route.course || null,
    courseStart = route.section || 'overview',
    taskId = route.task || '';
  const [offlineUser, setOfflineUser] = useState(() => {
    try {
      return sessionStorage.getItem('studyhub-offline-user') || '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    if (demo || !client) {
      setOfflineUser('');
      return;
    }
    if (!navigator.onLine) return;
    let active = true;
    void client.auth
      .getSession()
      .then((r) => {
        if (!active) return;
        const id = r.data.session ? 'live:' + r.data.session.user.id : '';
        setOfflineUser(id);
        try {
          if (id) sessionStorage.setItem('studyhub-offline-user', id);
          else sessionStorage.removeItem('studyhub-offline-user');
        } catch {
          /* Offline fallback stays in memory. */
        }
      })
      .catch(() => {
        /* Keep the last known account when connectivity changes. */
      });
    return () => {
      active = false;
    };
  }, [demo, snap]);
  const [token, setToken] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get('invite') || '',
  );
  const api: Gateway = demo ? demoGateway : liveGateway;
  const activeApi = useRef(api);
  activeApi.current = api;
  const refreshVersion = useRef(0);
  useEffect(() => {
    const url = new URL(location.href);
    if (demo) url.searchParams.set('demo', '1');
    else url.searchParams.delete('demo');
    history.replaceState(history.state, '', url);
    go(route, true);
  }, [demo]);
  const notifications = useNotifications(api, snap && !snap.owner ? snap.me.id : null, tab);
  const announcementCount = notifications.counts?.announcements || 0,
    overdueCount = notifications.counts?.overdue || 0;
  const notificationDescription = (id: string) =>
    id === 'announcements' && announcementCount
      ? 'announcement-notification-description'
      : id === 'tasks' && overdueCount
        ? 'task-notification-description'
        : undefined;
  async function refresh() {
    if (activeApi.current !== api) return;
    const version = ++refreshVersion.current;
    const current = () => activeApi.current === api && version === refreshVersion.current;
    try {
      const directory = await api.groups();
      if (!current()) return;
      setDirectory(directory);
      if (await api.session()) {
        const s = await api.snapshot();
        if (!current()) return;
        setSnap(s);
        setGroup((old) => groupContext(s, old).id);
      } else if (current()) setSnap(null);
    } catch (e) {
      if (!current()) return;
      if (e instanceof Error && e.message.startsWith('Доступ к аккаунту закрыт')) {
        forgetSchedule(offlineUser);
        setOfflineUser('');
        try {
          sessionStorage.removeItem('studyhub-offline-user');
        } catch {
          /* Optional device storage. */
        }
      }
      setSnap(null);
      throw e;
    }
  }
  async function run(work: () => Promise<void>, ok = '') {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work();
      if (activeApi.current !== api) return;
      await refresh();
      if (activeApi.current !== api) return;
      setError('');
      setMessage(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось выполнить действие.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let current = true;
    setSnap(null);
    setGroup('');
    api
      .groups()
      .then((d) => {
        if (current) setDirectory(d);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    refresh().catch((e) => {
      if (current) setError(e.message);
    });
    return () => {
      current = false;
    };
  }, [demo]);
  useEffect(() => {
    if (demo || !client) return;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setTimeout(() => refresh().catch((e) => setError(e.message)), 0);
    });
    return () => subscription.unsubscribe();
  }, [demo]);
  function switchDemo(id: string) {
    if (!mayLeaveDrafts()) return;
    activeApi.current = demoGateway;
    const version = ++refreshVersion.current;
    setDemo(true);
    go({ tab: 'overview' }, true);
    selectDemo(id);
    setError('');
    setMessage('');
    demoGateway
      .snapshot()
      .then((s) => {
        if (activeApi.current !== demoGateway || version !== refreshVersion.current) return;
        setSnap(s);
        setGroup(groupContext(s).id);
      })
      .catch((e) => {
        if (activeApi.current !== demoGateway || version !== refreshVersion.current) return;
        setSnap(null);
        setError(e.message);
      });
  }
  const leaderStudy = !!snap && isLeaderStudent(snap);
  const hasTeaching =
    !!snap &&
    !snap.owner &&
    snap.memberships.some((m) => m.user_id === snap.me.id && m.active && m.role === 'teacher');
  const teacherOnly =
    hasTeaching &&
    !leaderStudy &&
    !snap!.memberships.some((m) => m.user_id === snap!.me.id && m.active && m.role === 'student');
  const teacherSections: Record<string, TeacherSection> = {
    overview: 'overview',
    groups: 'courses',
    tasks: 'review',
    journal: 'journal',
    schedule: 'schedule',
    announcements: 'announcements',
  };
  const teacherRoutes: Record<TeacherSection, string> = {
    overview: 'overview',
    courses: 'groups',
    review: 'tasks',
    journal: 'journal',
    schedule: 'schedule',
    announcements: 'announcements',
  };
  const hasLeaderAdmin = !!snap && !snap.owner && (leaderStudy || snap.availableGroups > 0);
  const context = snap ? groupContext(snap, group) : null;
  const studySnap =
    snap && leaderStudy
      ? {
          ...snap,
          groups: context!.groups,
          courses: snap.courses.filter((c) => c.group_id === context!.id),
          profiles: [snap.me],
        }
      : snap;
  const roles = snap
    ? [
        ...new Set(
          snap.memberships
            .filter((m) => m.user_id === snap.me.id && m.active)
            .map((m) => labels[m.role]),
        ),
      ]
    : [];
  function openCourse(id: string, task?: string, start?: 'materials' | 'notes') {
    if (!mayLeaveDrafts()) return;
    const c = snap?.courses.find((c) => c.id === id);
    if (c) setGroup(c.group_id);
    go({ tab: 'groups', course: id, section: task ? 'assignment' : start || 'overview', task });
  }
  function navigate(id: string) {
    if (!mayLeaveDrafts()) return;
    go({ tab: id });
  }
  useEffect(() => {
    if (!snap || snap.owner || teacherOnly) return;
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (tab === 'search') document.getElementById('global-study-search')?.focus();
        else navigate('search');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [snap, teacherOnly, tab]);
  const allowed = snap
    ? snap.owner
      ? ['overview', 'admin', 'library', 'offline', 'notes', 'profile']
      : teacherOnly
        ? [
            'overview',
            'groups',
            'tasks',
            'journal',
            'schedule',
            'announcements',
            'library',
            'offline',
            'notes',
            'profile',
          ]
        : [
            'overview',
            'groups',
            'library',
            'schedule',
            'calendar',
            'search',
            'offline',
            'tasks',
            'announcements',
            'notes',
            'profile',
            ...(hasTeaching ? ['teaching'] : []),
            ...(hasLeaderAdmin ? ['admin'] : []),
          ]
    : [];
  const routeUnavailable =
    !!snap &&
    (route.invalid ||
      !allowed.includes(tab) ||
      (!!courseId && !snap.courses.some((c) => c.id === courseId && !c.archived)) ||
      (!!courseId && teacherOnly));
  function form(fn: (d: FormData) => Promise<void>, ok = '') {
    return (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const d = new FormData(e.currentTarget);
      void run(() => fn(d), ok);
    };
  }
  return (
    <>
      <div className="mode">
        <span>
          {demo
            ? 'ДЕМОНСТРАЦИЯ · данные только в этом браузере'
            : 'STUDYHUB · учебное пространство'}
        </span>
        {demo && (
          <div className="demo-roles">
            {[
              ['owner', 'Владелец'],
              ['leader', 'Староста'],
              ['teacher', 'Преподаватель'],
              ['student', 'Студент'],
            ].map(([id, name]) => (
              <button disabled={busy} key={id} onClick={() => switchDemo(id)}>
                {name}
              </button>
            ))}
            {configured && (
              <button
                onClick={() => {
                  if (mayLeaveDrafts()) setDemo(false);
                }}
              >
                Мой проект
              </button>
            )}
          </div>
        )}
      </div>
      {!snap || recovery ? (
        <main className="entry">
          <section className="intro">
            <div className="brand">
              <b className="logo">S</b> StudyHub<span>2.0</span>
            </div>
            <div className="eyebrow">ВАШЕ УЧЕБНОЕ ПРОСТРАНСТВО</div>
            <h1>
              Учиться вместе.
              <br />
              <em>Двигаться вперёд.</em>
            </h1>
            <p>
              Группа, дисциплины и преподаватели — в одном месте. Всё начинается с вашего аккаунта.
            </p>
            <div className="intro-cards">
              <span>
                01
                <br />
                <b>Своя группа</b>
              </span>
              <span>
                02
                <br />
                <b>Единый кабинет</b>
              </span>
              <span>
                03
                <br />
                <b>Общие знания</b>
              </span>
            </div>
          </section>
          <div>
            <AuthPanel
              api={api}
              groups={directory}
              invite={!!token}
              recovery={recovery}
              onDone={async () => {
                setRecovery(false);
                await refresh();
              }}
              onDemo={() => {
                activeApi.current = demoGateway;
                ++refreshVersion.current;
                setDemo(true);
                setError('');
              }}
            />
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            {!configured && !demo && (
              <p className="helper">
                Для настоящих аккаунтов подключите Supabase. Демоверсия доступна отдельно.
              </p>
            )}
            {offlineUser && (
              <details>
                <summary>Расписание без интернета</summary>
                <OfflineDay user={offlineUser} />
              </details>
            )}
            {offlineUser && (
              <details>
                <summary>Сохранённые материалы</summary>
                <OfflineShelf key={offlineUser} api={api} user={offlineUser} />
              </details>
            )}
          </div>
        </main>
      ) : (
        <div
          className={
            'shell' +
            (tab === 'overview' && !snap.owner ? ' home-shell' : '') +
            (tab === 'groups' && courseId ? ' course-shell' : '')
          }
        >
          <AppSidebar
            snapshot={snap}
            teacherOnly={teacherOnly}
            hasTeaching={hasTeaching}
            hasLeaderAdmin={hasLeaderAdmin}
            tab={tab}
            navigate={navigate}
            notificationDescription={notificationDescription}
            announcementCount={announcementCount}
            overdueCount={overdueCount}
          />
          <main className="workspace">
            <AppHeader
              snapshot={snap}
              tab={tab}
              teacherOnly={teacherOnly}
              leaderStudy={leaderStudy}
              roles={roles}
              hasLeaderAdmin={hasLeaderAdmin}
              busy={busy}
              navigate={navigate}
              onLogout={() =>
                void run(async () => {
                  if (!mayLeaveDrafts()) return;
                  await api.logout();
                  setSnap(null);
                  go({ tab: 'overview' }, true);
                })
              }
            />
            <span id="announcement-notification-description" className="visually-hidden">
              Непрочитанных объявлений: {announcementCount}
            </span>
            <span id="task-notification-description" className="visually-hidden">
              Просроченных несданных заданий: {overdueCount}
            </span>
            {(announcementCount > 0 || overdueCount > 0) && (
              <nav className="mobile-section-alerts" aria-label="Уведомления разделов">
                {announcementCount > 0 && (
                  <button
                    aria-label={'Новые объявления: ' + announcementCount}
                    onClick={() => navigate('announcements')}
                  >
                    Объявления{' '}
                    <NotificationBell count={announcementCount} title="Новые объявления" />
                  </button>
                )}
                {overdueCount > 0 && (
                  <button
                    aria-label={'Просроченные задания: ' + overdueCount}
                    onClick={() => navigate('tasks')}
                  >
                    Задания{' '}
                    <NotificationBell count={overdueCount} title="Просроченные несданные задания" />
                  </button>
                )}
              </nav>
            )}
            {notifications.error && (
              <p className="helper notification-status" role="status">
                {notifications.error}
              </p>
            )}
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
            {token && (
              <section className="card invitation-banner">
                <div>
                  <h3>Получено приглашение</h3>
                  <p>Принятие добавит права к вашему текущему аккаунту.</p>
                </div>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.redeem(token);
                      setToken('');
                      history.replaceState(history.state, '', location.pathname + location.search);
                      go({ tab: 'overview' }, true);
                    }, 'Приглашение принято.')
                  }
                >
                  Принять приглашение
                </button>
              </section>
            )}
            {!snap.owner &&
              !token &&
              snap.availableGroups === 0 &&
              !snap.memberships.some((m) => m.user_id === snap.me.id && m.active) && (
                <section className="card">
                  <h2>Доступ к учебной группе</h2>
                  <p>
                    Отправьте заявку старосте или примите приглашение. Личные заметки и общая
                    библиотека уже доступны.
                  </p>
                  <GroupRequests
                    key={String(demo) + snap.me.id}
                    api={api}
                    group={null}
                    onChanged={refresh}
                    onPending={setPendingRequest}
                    groups={directory}
                  />
                  {pendingRequest === false && (
                    <>
                      <form
                        onSubmit={form(
                          async (d) => api.joinGroup(String(d.get('group'))),
                          'Заявка отправлена. Дождитесь одобрения старосты.',
                        )}
                      >
                        <label>
                          Группа
                          <select name="group" required defaultValue="">
                            <option value="" disabled>
                              Выберите группу
                            </option>
                            {directory.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button className="primary" disabled={busy || !directory.length}>
                          Отправить заявку
                        </button>
                      </form>
                    </>
                  )}
                </section>
              )}
            <PageBoundary key={tab + (courseId || '')}>
              <Suspense fallback={<p role="status">Открываем раздел…</p>}>
                {routeUnavailable ? (
                  <section className="card empty" role="alert">
                    <h2>Страница недоступна</h2>
                    <p>Ссылка неверна, материал удалён или у вашего аккаунта нет доступа.</p>
                    <button onClick={() => navigate('overview')}>На главную</button>
                    {allowed.includes('groups') && (
                      <button onClick={() => navigate('groups')}>К дисциплинам</button>
                    )}
                  </section>
                ) : (
                  <>
                    {' '}
                    {!teacherOnly &&
                      (tab === 'calendar' ||
                        tab === 'tasks' ||
                        (tab === 'overview' && !snap.owner)) && (
                        <StudyHome
                          key={snap.me.id + tab + String(demo)}
                          api={api}
                          snapshot={studySnap!}
                          view={
                            tab === 'calendar' ? 'calendar' : tab === 'tasks' ? 'tasks' : 'home'
                          }
                          onNavigate={navigate}
                          onCourse={openCourse}
                          onRead={(item) => {
                            if (mayLeaveDrafts()) go({ tab: 'library', book: item.id });
                          }}
                        />
                      )}
                    {teacherOnly && teacherSections[tab] && (
                      <TeacherWorkbench
                        key={snap.me.id + String(demo)}
                        api={api}
                        snapshot={snap}
                        initialSection={teacherSections[tab]}
                        onSection={(s) => navigate(teacherRoutes[s])}
                      />
                    )}
                    {tab === 'teaching' && hasTeaching && !teacherOnly && (
                      <TeacherWorkbench key={snap.me.id + String(demo)} api={api} snapshot={snap} />
                    )}
                    {tab === 'overview' && snap.owner && (
                      <OwnerOverview
                        api={api}
                        snapshot={snap}
                        onManage={(section, id) => {
                          if (!mayLeaveDrafts()) return;
                          setOwnerSection(section);
                          setOwnerGroup(id || '');
                          navigate('admin');
                        }}
                      />
                    )}
                    {tab === 'admin' && snap.owner && (
                      <OwnerAdminPanel
                        key={snap.me.id + String(demo) + ownerSection + ownerGroup}
                        api={api}
                        snapshot={snap}
                        initialSection={ownerSection}
                        initialGroup={ownerGroup}
                        onChanged={refresh}
                        onOverview={() => navigate('overview')}
                      />
                    )}
                    {tab === 'admin' && hasLeaderAdmin && (
                      <LeaderAdminPanel
                        showStudyLink={false}
                        key={snap.me.id + String(demo)}
                        api={api}
                        snapshot={snap}
                        onChanged={refresh}
                        onStudy={() => navigate('overview')}
                      />
                    )}
                    {!teacherOnly &&
                    tab === 'groups' &&
                    courseId &&
                    snap.courses.find((c) => c.id === courseId) ? (
                      <CoursePanel
                        allowManagement={!leaderStudy && !snap.owner}
                        initialTab={courseStart}
                        initialMaterial={route.material}
                        onLocation={(section, task, material) =>
                          go({ tab: 'groups', course: courseId!, section, task, material })
                        }
                        initialKind={courseStart === 'assignment' ? 'assignment' : undefined}
                        initialAssignment={taskId}
                        userId={snap.me.id}
                        groupName={snap.groups.find((g) => g.id === group)?.name || ''}
                        snapshot={studySnap!}
                        key={courseId + taskId + courseStart + String(demo)}
                        api={api}
                        course={snap.courses.find((c) => c.id === courseId)!}
                        onClose={() => go({ tab: 'groups' })}
                      />
                    ) : (
                      !teacherOnly &&
                      tab === 'groups' && (
                        <>
                          <div className="toolbar">
                            {context?.canChoose ? (
                              <label>
                                Текущая группа
                                <select value={group} onChange={(e) => setGroup(e.target.value)}>
                                  <option value="">Выберите группу</option>
                                  {snap.groups.map((g) => (
                                    <option key={g.id} value={g.id}>
                                      {g.name}
                                      {g.blocked ? ' · закрыта' : ''}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : (
                              context?.name && (
                                <span className="group-context">
                                  <span>Моя группа</span>
                                  <b>{context.name}</b>
                                </span>
                              )
                            )}
                          </div>
                          <section className="discipline-catalog" aria-label="Дисциплины группы">
                            <div className="discipline-catalog-heading">
                              <h2>Дисциплины</h2>
                              {context?.name && <p>Учебные материалы группы {context.name}</p>}
                            </div>
                            <div className="course-list discipline-grid">
                              {snap.courses
                                .filter((c) => c.group_id === group && !c.archived)
                                .map((c) => (
                                  <article
                                    key={c.id}
                                    className={'discipline-card cover-' + courseTheme(c.id)}
                                  >
                                    <button
                                      onClick={() => openCourse(c.id)}
                                      aria-label="Открыть дисциплину"
                                      aria-describedby={'discipline-' + c.id}
                                    >
                                      <span className="discipline-card-cover">
                                        <CourseScenery />
                                        <strong id={'discipline-' + c.id}>{c.title}</strong>
                                        <span>{context?.name}</span>
                                      </span>
                                      <span className="discipline-card-sections">
                                        <span>Лекции</span>
                                        <span>Задания</span>
                                        <span>Доп. материалы</span>
                                      </span>
                                      <span className="discipline-card-footer">
                                        <span>Всё по предмету</span>
                                        <b>
                                          Открыть <span aria-hidden="true">→</span>
                                        </b>
                                      </span>
                                    </button>
                                  </article>
                                ))}
                            </div>
                            {!snap.courses.some((c) => c.group_id === group && !c.archived) && (
                              <p className="card empty">В вашей группе пока нет дисциплин.</p>
                            )}
                          </section>
                        </>
                      )
                    )}
                    {tab === 'library' && (
                      <LibraryPanel
                        allowManagement={!leaderStudy && !snap.owner}
                        initialBook={route.book}
                        onLocation={(book) => go({ tab: 'library', book })}
                        key={snap.me.id + String(demo)}
                        api={api}
                        snapshot={studySnap!}
                      />
                    )}
                    {!teacherOnly && tab === 'schedule' && (
                      <SchedulePanel
                        allowManagement={!leaderStudy && !snap.owner}
                        key={snap.me.id + String(demo)}
                        api={api}
                        snapshot={studySnap!}
                        onCourse={openCourse}
                      />
                    )}
                    {!teacherOnly && tab === 'announcements' && (
                      <BoardPanel
                        key={snap.me.id + String(demo)}
                        api={api}
                        snapshot={snap}
                        kind="announcement"
                        allowManagement={!leaderStudy && !snap.owner}
                      />
                    )}
                    {tab === 'profile' && (
                      <ProfilePanel
                        key={String(demo) + snap.me.id}
                        api={api}
                        snapshot={snap}
                        onSaved={refresh}
                        onShelf={() => navigate('offline')}
                      />
                    )}
                    {tab === 'offline' && (
                      <OfflineShelf
                        key={String(demo) + snap.me.id}
                        api={api}
                        user={(demo ? 'demo:' : 'live:') + snap.me.id}
                      />
                    )}
                    {tab === 'search' && (
                      <StudySearch
                        key={String(api.demo) + snap.me.id}
                        api={api}
                        snapshot={studySnap!}
                        onCourse={openCourse}
                        onTasks={() => navigate('tasks')}
                        onOpen={(r) => {
                          if (r.kind === 'course') openCourse(r.id);
                          else if (r.kind === 'assignment' && r.courseId)
                            openCourse(r.courseId, r.id);
                          else if (r.kind === 'material' && r.courseId) {
                            if (mayLeaveDrafts())
                              go({
                                tab: 'groups',
                                course: r.courseId,
                                section: 'materials',
                                material: r.id,
                              });
                          } else if (r.kind === 'book') {
                            if (mayLeaveDrafts()) go({ tab: 'library', book: r.id });
                          } else if (r.kind === 'plan') navigate('tasks');
                        }}
                      />
                    )}
                    {tab === 'notes' && (
                      <NotesPanel userId={snap.me.id} key={snap.me.id + String(demo)} api={api} />
                    )}
                  </>
                )}
              </Suspense>
            </PageBoundary>
            {!snap.owner && (
              <nav className="mobile-study-nav" aria-label="Быстрые переходы">
                {(teacherOnly
                  ? [
                      ['overview', 'Главная'],
                      ['groups', 'Дисциплины'],
                      ['tasks', 'Проверка'],
                      ['journal', 'Журнал'],
                    ]
                  : [
                      ['overview', 'Главная'],
                      ['groups', 'Учёба'],
                      ['library', 'Читать'],
                      ['calendar', 'План'],
                    ]
                ).map(([id, name]) => (
                  <button
                    key={id}
                    aria-label={'Быстрый переход: ' + name}
                    aria-current={tab === id ? 'page' : undefined}
                    onClick={() => navigate(id)}
                  >
                    <StudyIcon
                      name={
                        id === 'overview'
                          ? 'sun'
                          : id === 'library'
                            ? 'book'
                            : id === 'calendar' || id === 'schedule'
                              ? 'calendar'
                              : id === 'admin'
                                ? 'settings'
                                : id === 'groups'
                                  ? 'course'
                                  : 'note'
                      }
                    />
                    {name}
                  </button>
                ))}
              </nav>
            )}
            <footer>
              StudyHub 2.0 · {demo ? 'Демонстрационный режим' : 'Ваше учебное пространство'}
              <button disabled={busy} onClick={() => void run(async () => {}, 'Данные обновлены.')}>
                Обновить данные
              </button>
              {demo && (
                <button
                  onClick={() => {
                    if (!mayLeaveDrafts()) return;
                    go({ tab: 'overview' }, true);
                    resetDemo();
                    setSnap(null);
                    setMessage('Демонстрация сброшена.');
                  }}
                >
                  Сбросить демонстрацию
                </button>
              )}
            </footer>
          </main>
        </div>
      )}
    </>
  );
}
