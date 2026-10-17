import { WeeklyScheduleEditor } from './WeeklyScheduleEditor';
import { CourseManager } from './CourseManager';
import { MaterialIntake } from './MaterialIntake';
import { GroupRequests } from './GroupRequests';
import { useEffect, useState } from 'react';
import type { Gateway, Snapshot, GroupMember } from './types';
import { leaderGroups } from './leader-context';
import { mayLeaveDrafts } from './drafts';
import { InvitationManager, TeachingManager } from './AccessManagers';
import { BoardPanel } from './BoardPanel';
import { LibraryPanel } from './LibraryPanel';
import { CoursePanel } from './CoursePanel';
type Section = 'group' | 'courses' | 'schedule' | 'announcements' | 'library' | 'invitations';
const sections: Record<Section, string> = {
  group: 'Участники',
  courses: 'Дисциплины и преподаватели',
  schedule: 'Расписание',
  announcements: 'Объявления',
  library: 'Публикации в библиотеке',
  invitations: 'Приглашения',
};
const roleNames = { student: 'Студент', leader: 'Староста · студент', teacher: 'Преподаватель' };
function GroupRoster({ api, group }: { api: Gateway; group: string }) {
  const [items, setItems] = useState<GroupMember[]>([]),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setItems([]);
    setError('');
    api
      .groupMembers(group, offset)
      .then((rows) => {
        if (alive) setItems(rows);
      })
      .catch((e) => {
        if (alive)
          setError(
            (e as { code?: string }).code === 'PGRST202'
              ? 'Список участников станет доступен после обновления базы v0.23.'
              : e instanceof Error
                ? e.message
                : 'Не удалось загрузить участников.',
          );
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [api, group, offset, revision]);
  return (
    <section className="card">
      <h2>Участники группы</h2>
      <p>
        Приглашайте студентов и преподавателей. Староста не блокирует аккаунты, не переносит
        студентов и не видит чужие личные записи или работы.
      </p>
      {busy && <p role="status">Загружаем участников…</p>}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <div className="people-list">
        {items.map((m) => (
          <div key={m.user_id + ':' + m.role}>
            <div>
              <b>{m.full_name}</b>
              <small>
                {roleNames[m.role]}
                {m.active ? '' : ' · участие прекращено'}
              </small>
            </div>
          </div>
        ))}
      </div>
      {!busy && !error && !items.length && <p>Участников пока нет.</p>}
      <div className="card-actions">
        <button disabled={busy} onClick={() => setRevision((n) => n + 1)}>
          Обновить участников
        </button>
        <button
          disabled={busy || offset === 0}
          onClick={() => setOffset((n) => Math.max(0, n - 50))}
        >
          Предыдущие участники
        </button>
        <button disabled={busy || items.length < 50} onClick={() => setOffset((n) => n + 50)}>
          Следующие участники
        </button>
      </div>
    </section>
  );
}
export function LeaderAdminPanel({
  api,
  snapshot,
  onChanged,
  onStudy,
  showStudyLink = true,
}: {
  api: Gateway;
  snapshot: Snapshot;
  onChanged: () => Promise<void>;
  onStudy: () => void;
  showStudyLink?: boolean;
}) {
  const groups = leaderGroups(snapshot),
    [selected, setSelected] = useState(groups[0]?.id || ''),
    [section, setSection] = useState<Section>('group'),
    [courseId, setCourse] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [inviteRole, setRole] = useState<'student' | 'teacher'>('student'),
    [link, setLink] = useState('');
  const group = groups.find((g) => g.id === selected) || groups[0],
    groupId = group?.id || '',
    courses = snapshot.courses.filter((c) => c.group_id === groupId && !c.archived);
  // Management components receive only groups the current account actually leads.
  const scoped: Snapshot = {
    ...snapshot,
    groups,
    courses: snapshot.courses.filter((c) => groups.some((g) => g.id === c.group_id)),
  };
  useEffect(() => {
    setSelected(groupId);
    setCourse('');
    setLink('');
    setError('');
    setMessage('');
  }, [groupId]);
  async function action(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await onChanged();
      setMessage(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Действие не выполнено.');
    } finally {
      setBusy(false);
    }
  }
  function navigate(next: Section) {
    if (!mayLeaveDrafts()) return;
    setSection(next);
    setCourse('');
    setError('');
    setMessage('');
    setLink('');
  }
  return (
    <section className="leader-admin" aria-label="Админ старосты">
      <div className="leader-admin-heading">
        <div>
          <span className="eyebrow">УПРАВЛЕНИЕ СВОЕЙ ГРУППОЙ</span>
          <h2>Управление группой</h2>
        </div>
        {showStudyLink && (
          <button className="primary" disabled={busy} onClick={onStudy}>
            Вернуться к учёбе
          </button>
        )}
      </div>
      <div className="leader-admin-context">
        {groups.length > 1 ? (
          <label>
            Управляемая группа
            <select
              value={groupId}
              disabled={busy}
              onChange={(e) => {
                if (mayLeaveDrafts()) setSelected(e.target.value);
              }}
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        ) : group ? (
          <span className="group-context">
            <span>Управляемая группа</span>
            <b>{group.name}</b>
          </span>
        ) : (
          <p>У вас пока нет группы для управления.</p>
        )}
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      {groups.length > 0 && (
        <>
          <nav className="leader-admin-tabs" aria-label="Разделы админа">
            {Object.entries(sections).map(([id, title]) => (
              <button
                disabled={busy}
                key={id}
                aria-current={section === id ? 'page' : undefined}
                onClick={() => navigate(id as Section)}
              >
                {title}
              </button>
            ))}
          </nav>
          {section === 'group' && (
            <>
              <GroupRequests
                key={'requests' + groupId}
                api={api}
                group={groupId}
                onChanged={onChanged}
              />
              <GroupRoster key={groupId} api={api} group={groupId} />
              <button onClick={() => navigate('invitations')}>Пригласить в группу</button>
            </>
          )}
          {section === 'courses' && (
            <>
              <MaterialIntake
                key={'intake' + groupId}
                api={api}
                initialGroup={groupId}
                onPublished={onChanged}
              />
              {courseId && courses.some((c) => c.id === courseId) ? (
                <CoursePanel
                  key={courseId}
                  api={api}
                  snapshot={scoped}
                  course={courses.find((c) => c.id === courseId)!}
                  userId={snapshot.me.id}
                  groupName={group!.name}
                  onClose={() => setCourse('')}
                />
              ) : (
                <>
                  <section className="card">
                    <h2>Дисциплины группы</h2>
                    <CourseManager
                      key={groupId}
                      api={api}
                      snapshot={snapshot}
                      group={groupId}
                      onOpen={setCourse}
                      onChanged={onChanged}
                    />
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = e.currentTarget,
                          d = new FormData(f);
                        void action(async () => {
                          await api.createCourse(groupId, String(d.get('title')));
                          f.reset();
                        }, 'Дисциплина создана.');
                      }}
                    >
                      <label>
                        Новая дисциплина
                        <input name="title" required maxLength={200} />
                      </label>
                      <button className="primary" disabled={busy}>
                        Добавить дисциплину
                      </button>
                    </form>
                  </section>
                  <TeachingManager
                    key={groupId}
                    api={api}
                    snapshot={scoped}
                    group={groupId}
                    onChanged={onChanged}
                  />
                  <button
                    onClick={() => {
                      setRole('teacher');
                      navigate('invitations');
                    }}
                  >
                    Пригласить преподавателя
                  </button>
                </>
              )}
            </>
          )}
          {section === 'schedule' && (
            <WeeklyScheduleEditor key={groupId} api={api} snapshot={scoped} group={groupId} />
          )}
          {section === 'announcements' && (
            <BoardPanel
              key={groupId}
              api={api}
              snapshot={{ ...scoped, groups: [group!] }}
              initialGroup={groupId}
              kind="announcement"
            />
          )}
          {section === 'library' && (
            <LibraryPanel api={api} snapshot={{ ...scoped, groups: [group!] }} />
          )}
          {section === 'invitations' && (
            <>
              <section className="card">
                <h2>Пригласить участника</h2>
                <p>Группа: {group!.name}. Ссылка действует 72 часа.</p>
                <form
                  key={groupId + inviteRole}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const d = new FormData(e.currentTarget);
                    void action(async () => {
                      const token = await api.invite(
                        inviteRole,
                        groupId,
                        inviteRole === 'teacher' ? d.getAll('courses').map(String) : [],
                        inviteRole === 'student' ? 60 : 1,
                      );
                      const url = new URL(location.href);
                      url.search = '';
                      url.hash = 'invite=' + encodeURIComponent(token);
                      setLink(url.href);
                    }, 'Приглашение создано.');
                  }}
                >
                  <label>
                    Кого приглашаем
                    <select
                      value={inviteRole}
                      onChange={(e) => {
                        setRole(e.target.value as 'student' | 'teacher');
                        setLink('');
                      }}
                    >
                      <option value="student">Студент · до 60 регистраций</option>
                      <option value="teacher">Преподаватель · одноразовая ссылка</option>
                    </select>
                  </label>
                  {inviteRole === 'teacher' && (
                    <fieldset>
                      <legend>Дисциплины преподавателя</legend>
                      {courses
                        .filter((c) => !c.archived)
                        .map((c) => (
                          <label key={c.id} className="check">
                            <input type="checkbox" name="courses" value={c.id} />
                            {c.title}
                          </label>
                        ))}
                    </fieldset>
                  )}
                  <button
                    className="primary"
                    disabled={busy || (inviteRole === 'teacher' && !courses.length)}
                  >
                    Создать ссылку
                  </button>
                </form>
                {link && (
                  <div className="link-box">
                    <label>
                      Пригласительная ссылка
                      <textarea readOnly value={link} />
                    </label>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(
                          () => navigator.clipboard.writeText(link),
                          'Ссылка скопирована.',
                        )
                      }
                    >
                      Копировать
                    </button>
                  </div>
                )}
              </section>
              <InvitationManager api={api} snapshot={scoped} onChanged={onChanged} />
            </>
          )}
        </>
      )}
      {snapshot.availableGroups > 0 && (
        <section className="card leader-new-group">
          <h2>Создание группы</h2>
          <p>Владелец разрешил создать групп: {snapshot.availableGroups}.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.currentTarget,
                d = new FormData(f);
              void action(async () => {
                await api.createGroup(String(d.get('name')));
                f.reset();
              }, 'Группа создана.');
            }}
          >
            <label>
              Название группы
              <input name="name" required maxLength={100} />
            </label>
            <button disabled={busy} className="primary">
              Создать группу
            </button>
          </form>
        </section>
      )}
      {!groups.length && !snapshot.availableGroups && (
        <p>Полномочий для управления нет. Обновите данные или обратитесь к владельцу.</p>
      )}
    </section>
  );
}
