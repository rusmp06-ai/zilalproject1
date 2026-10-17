import { OwnerOperations } from './OwnerOperations';
import type { Gateway, Snapshot } from './types';
import type { OwnerSection } from './OwnerAdminPanel';
export function ownerSummary(s: Snapshot) {
  const active = s.memberships.filter((m) => m.active),
    distinct = (role: string) =>
      new Set(active.filter((m) => m.role === role).map((m) => m.user_id)).size;
  return {
    groups: s.groups.length,
    blockedGroups: s.groups.filter((g) => g.blocked).length,
    accounts: s.profiles.length,
    blockedAccounts: s.profiles.filter((p) => p.blocked).length,
    courses: s.courses.filter((c) => !c.archived).length,
    students: new Set(
      active.filter((m) => m.role === 'student' || m.role === 'leader').map((m) => m.user_id),
    ).size,
    leaders: distinct('leader'),
    teachers: distinct('teacher'),
    restrictions: s.denials.length,
    withoutLeader: s.groups.filter(
      (g) =>
        !g.blocked &&
        !active.some(
          (m) =>
            m.group_id === g.id &&
            m.role === 'leader' &&
            !s.profiles.find((p) => p.id === m.user_id)?.blocked,
        ),
    ),
    withoutCourses: s.groups.filter(
      (g) => !g.blocked && !s.courses.some((c) => c.group_id === g.id && !c.archived),
    ),
  };
}
export function OwnerOverview({
  snapshot,
  onManage,
  api,
}: {
  snapshot: Snapshot;
  api?: Gateway;
  onManage: (section: OwnerSection, group?: string) => void;
}) {
  const s = ownerSummary(snapshot);
  return (
    <section className="owner-overview" aria-label="Обзор проекта">
      <div className="owner-intro">
        <span className="eyebrow">STUDYHUB · ВЛАДЕЛЕЦ</span>
        <h2>Ваш проект под контролем</h2>
        <p>Пользователи, заявки и состояние учебных групп.</p>
        <div className="card-actions">
          <button className="primary" onClick={() => onManage('accounts')}>
            Пользователи проекта
          </button>
          <button onClick={() => onManage('groups')}>Открыть управление проектом</button>
        </div>
      </div>
      <div className="owner-stats">
        {[
          ['Группы', s.groups, s.blockedGroups + ' с закрытым доступом'],
          ['Аккаунты', s.accounts, s.blockedAccounts + ' заблокировано'],
          ['Дисциплины', s.courses, 'Неархивные дисциплины'],
          ['Ограничения разделов', s.restrictions, 'Дополнительные правила доступа'],
        ].map(([label, value, detail]) => (
          <button
            className="card owner-stat-button"
            key={label}
            onClick={() =>
              onManage(
                label === 'Аккаунты'
                  ? 'accounts'
                  : label === 'Дисциплины'
                    ? 'courses'
                    : label === 'Ограничения разделов'
                      ? 'access'
                      : 'groups',
              )
            }
          >
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
          </button>
        ))}
      </div>
      {api && <OwnerOperations api={api} snapshot={snapshot} onManage={onManage} />}
      <section className="card">
        <h3>Участники и роли</h3>
        <div className="owner-role-counts">
          <span>
            Студенты и старосты: <b>{s.students}</b>
          </span>
          <span>
            Старосты: <b>{s.leaders}</b>
          </span>
          <span>
            Преподаватели: <b>{s.teachers}</b>
          </span>
        </div>
        <p className="helper">
          Староста входит в число учащихся. У одного аккаунта может быть несколько ролей.
        </p>
        <button onClick={() => onManage('accounts')}>Участники и роли</button>
      </section>
      <div className="owner-shortcuts">
        <button onClick={() => onManage('invitations')}>Создать приглашение</button>
        <button onClick={() => onManage('access')}>Ограничения доступа</button>
        <button onClick={() => onManage('history')}>История действий</button>
      </div>
      <section className="card owner-attention">
        <h3>Стоит проверить</h3>
        {s.withoutLeader.length > 0 && (
          <>
            <p>Группы без действующего старосты: {s.withoutLeader.length}.</p>
            <div className="card-actions">
              {s.withoutLeader.slice(0, 5).map((g) => (
                <button key={g.id} onClick={() => onManage('groups', g.id)}>
                  {g.name}
                </button>
              ))}
            </div>
          </>
        )}
        {s.withoutCourses.length > 0 && <p>Группы без дисциплин: {s.withoutCourses.length}.</p>}
        {s.blockedAccounts > 0 && (
          <button onClick={() => onManage('accounts')}>
            Проверить заблокированные аккаунты ({s.blockedAccounts})
          </button>
        )}
        {!s.withoutLeader.length && !s.withoutCourses.length && !s.blockedAccounts && (
          <p>По данным групп и аккаунтов замечаний нет.</p>
        )}
      </section>
    </section>
  );
}
