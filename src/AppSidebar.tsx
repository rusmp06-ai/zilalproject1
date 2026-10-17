import type { Snapshot } from './types';
import { StudyIcon } from './StudyIcon';
import { NotificationBell } from './notifications';
export function AppSidebar({
  snapshot: snap,
  teacherOnly,
  hasTeaching,
  hasLeaderAdmin,
  tab,
  navigate,
  notificationDescription,
  announcementCount,
  overdueCount,
}: {
  snapshot: Snapshot;
  teacherOnly: boolean;
  hasTeaching: boolean;
  hasLeaderAdmin: boolean;
  tab: string;
  navigate: (id: string) => void;
  notificationDescription: (id: string) => string | undefined;
  announcementCount: number;
  overdueCount: number;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <b className="logo">S</b> StudyHub
      </div>
      <div className="eyebrow">{snap.owner ? 'ВАШ ПРОЕКТ' : 'УЧЕБНОЕ ПРОСТРАНСТВО'}</div>
      <nav>
        {(snap.owner
          ? [
              ['overview', 'Обзор проекта'],
              ['admin', 'Админ'],
              ['library', 'Библиотека'],
              ['offline', 'Сохранённые материалы'],
              ['notes', 'Мои заметки'],
              ['profile', 'Профиль'],
            ]
          : teacherOnly
            ? [
                ['overview', 'Главная'],
                ['groups', 'Мои дисциплины'],
                ['tasks', 'На проверку'],
                ['journal', 'Задания и журнал'],
                ['schedule', 'Расписание'],
                ['announcements', 'Объявления'],
                ['library', 'Библиотека'],
                ['offline', 'Сохранённые материалы'],
                ['notes', 'Мои заметки'],
                ['profile', 'Профиль'],
              ]
            : [
                ['overview', 'Главная'],
                ['groups', 'Группы и дисциплины'],
                ['library', 'Библиотека'],
                ['schedule', 'Расписание'],
                ['calendar', 'Календарь'],
                ['search', 'Поиск'],
                ['offline', 'Сохранённые материалы'],
                ['tasks', 'Все задания'],
                ['announcements', 'Объявления'],
                ['notes', 'Мои заметки'],
                ['profile', 'Профиль'],
                ...(hasTeaching ? [['teaching', 'Преподавание']] : []),
                ...(hasLeaderAdmin ? [['admin', 'Админ']] : []),
              ]
        ).map(([id, name]) => (
          <button
            key={id}
            aria-describedby={notificationDescription(id)}
            data-section={id}
            className={tab === id ? 'selected' : ''}
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
            {id === 'announcements' && (
              <NotificationBell
                count={announcementCount}
                title={'Непрочитанных объявлений: ' + announcementCount}
              />
            )}{' '}
            {id === 'tasks' && (
              <NotificationBell
                count={overdueCount}
                title={'Просроченных несданных заданий: ' + overdueCount}
              />
            )}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <p>{teacherOnly ? 'StudyHub · работа преподавателя' : 'StudyHub · учиться каждый день'}</p>
        <small>
          {teacherOnly
            ? 'Материалы, занятия, проверка и результаты ваших групп.'
            : 'Материалы, задания, расписание и объявления вашей группы.'}
        </small>
      </div>
    </aside>
  );
}
