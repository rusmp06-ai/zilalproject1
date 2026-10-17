import type { Snapshot } from './types';
import { StudyIcon } from './StudyIcon';
export function AppHeader({
  snapshot: snap,
  tab,
  teacherOnly,
  leaderStudy,
  roles,
  hasLeaderAdmin,
  busy,
  navigate,
  onLogout,
}: {
  snapshot: Snapshot;
  tab: string;
  teacherOnly: boolean;
  leaderStudy: boolean;
  roles: string[];
  hasLeaderAdmin: boolean;
  busy: boolean;
  navigate: (id: string) => void;
  onLogout: () => void;
}) {
  return (
    <header>
      <div>
        <div className="eyebrow">
          {snap.owner
            ? 'КАБИНЕТ ВЛАДЕЛЬЦА'
            : leaderStudy && tab !== 'admin'
              ? 'СТУДЕНТ · СТАРОСТА'
              : roles.join(' · ') || 'НОВЫЙ УЧАСТНИК'}
        </div>
        <h1>
          {tab === 'profile'
            ? 'Профиль'
            : tab === 'admin'
              ? 'Админ'
              : tab === 'overview'
                ? snap.owner
                  ? 'Обзор проекта'
                  : teacherOnly
                    ? 'Кабинет преподавателя'
                    : 'Ваше пространство'
                : tab === 'teaching'
                  ? 'Преподавание'
                  : tab === 'journal'
                    ? 'Задания и журнал'
                    : tab === 'groups'
                      ? teacherOnly
                        ? 'Мои дисциплины'
                        : 'Группы и дисциплины'
                      : tab === 'invitations'
                        ? 'Приглашения'
                        : tab === 'library'
                          ? 'Библиотека'
                          : tab === 'schedule'
                            ? 'Расписание'
                            : tab === 'calendar'
                              ? 'Календарь'
                              : tab === 'tasks'
                                ? teacherOnly
                                  ? 'Работы на проверку'
                                  : 'Все задания'
                                : tab === 'announcements'
                                  ? 'Объявления'
                                  : tab === 'notes'
                                    ? 'Мои заметки'
                                    : tab === 'search'
                                      ? 'Поиск'
                                      : tab === 'offline'
                                        ? 'Сохранённые материалы'
                                        : 'Управление доступом'}
        </h1>
      </div>
      <div className="account">
        {!snap.owner && !teacherOnly && (
          <button
            className="header-search"
            aria-label="Открыть поиск"
            title="Поиск (Ctrl+K)"
            onClick={() => navigate('search')}
          >
            <StudyIcon name="search" />
          </button>
        )}
        <button
          className="account-profile"
          aria-label="Открыть профиль"
          onClick={() => navigate('profile')}
        >
          {snap.me.full_name}
        </button>
        {(hasLeaderAdmin || snap.owner) && (
          <button
            className="account-admin"
            aria-label={
              tab === 'admin'
                ? snap.owner
                  ? 'Открыть обзор проекта'
                  : 'К учебному пространству'
                : 'Открыть админ'
            }
            onClick={() => navigate(tab === 'admin' ? 'overview' : 'admin')}
          >
            {tab === 'admin' ? (snap.owner ? 'К обзору' : 'К учёбе') : 'Админ'}
          </button>
        )}
        <button disabled={busy} onClick={onLogout}>
          Выйти
        </button>
      </div>
    </header>
  );
}
