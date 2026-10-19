import { lessonDay, lessonCountdown, lessonTime, studyDate } from './lesson-day';
import type { BoardItem } from './types';
export type ScheduleStatus = 'loading' | 'fresh' | 'saved' | 'denied' | 'error';
export function LessonNow({
  events,
  now,
  status,
  savedAt,
  stored = false,
  onMaterials,
  onNotes,
  onToday,
  onRefresh,
}: {
  events: BoardItem[];
  now: number;
  status: ScheduleStatus;
  savedAt: string | null;
  stored?: boolean;
  onMaterials?: (e: BoardItem) => void;
  onNotes?: (e: BoardItem) => void;
  onToday?: () => void;
  onRefresh?: () => void;
}) {
  const day = lessonDay(events, now),
    focus = day.current || day.next;
  const valid = status === 'fresh' || status === 'saved';
  const card = (e: BoardItem, kind: 'current' | 'next') => (
    <div className={'lesson-slot lesson-' + kind}>
      <span className="lesson-kicker">
        {kind === 'current' ? 'СЕЙЧАС' : day.current ? 'СЛЕДУЮЩАЯ ПАРА' : 'БЛИЖАЙШАЯ ПАРА'}
        {studyDate(Date.parse(e.starts_at!)) !== studyDate(now)
          ? ' · ' +
            new Date(e.starts_at!).toLocaleDateString('ru-RU', {
              timeZone: 'Asia/Bishkek',
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })
          : ''}
      </span>
      <h3>{e.title}</h3>
      <div className="lesson-details">
        <strong className="lesson-time">
          {lessonTime(e.starts_at!)}–{lessonTime(e.ends_at!)}
        </strong>
        <strong className="lesson-room">{e.location || 'Аудитория не указана'}</strong>
      </div>
      <p className="lesson-countdown" aria-live="off">
        {lessonCountdown(e, now)}
      </p>
    </div>
  );
  return (
    <section className="lesson-now" aria-label="Сейчас и следующая пара" data-state={status}>
      {!valid ? (
        <div className="lesson-empty">
          <h3>
            {status === 'loading'
              ? 'Загружаем ближайшую пару…'
              : status === 'denied'
                ? 'Доступ к расписанию закрыт'
                : 'Не удалось узнать ближайшую пару'}
          </h3>
          <p>
            {status === 'loading'
              ? 'Проверяем расписание вашей группы.'
              : status === 'denied'
                ? 'Обратитесь к владельцу группы.'
                : 'Проверьте подключение и обновите расписание.'}
          </p>
          {status === 'error' && onRefresh && (
            <button onClick={onRefresh}>Повторить загрузку расписания</button>
          )}
        </div>
      ) : (
        <>
          {status === 'saved' && (
            <p className="lesson-stale" role="status">
              Сохранённое расписание · изменения не проверены
            </p>
          )}
          <div className="lesson-slots">
            {day.current && card(day.current, 'current')}
            {day.next && card(day.next, 'next')}
            {!day.current && !day.next && (
              <div className="lesson-empty">
                <h3>{day.today.length ? 'На сегодня пары закончились' : 'Сегодня занятий нет'}</h3>
                <p>
                  {status === 'saved'
                    ? 'В сохранённой копии нет следующих занятий.'
                    : 'В загруженном расписании на ближайшие семь дней нет следующих занятий.'}
                </p>
              </div>
            )}
            {day.current && !day.next && (
              <div className="lesson-empty">
                <span className="lesson-kicker">ПОСЛЕ ЭТОЙ ПАРЫ</span>
                <h3>Больше занятий не запланировано</h3>
                <p>
                  {status === 'saved'
                    ? 'В сохранённой копии расписания.'
                    : 'В загруженном расписании на ближайшие семь дней.'}
                </p>
              </div>
            )}
          </div>
          {day.overlap && (
            <p className="lesson-stale">
              Время нескольких занятий совпадает. Проверьте расписание сегодня.
            </p>
          )}
          {(onMaterials || onNotes || onToday) && (
            <div className="lesson-actions">
              {onMaterials && (
                <button
                  className="primary"
                  aria-label="Материалы пары"
                  disabled={!focus?.course_id || status === 'saved'}
                  onClick={() => focus && onMaterials?.(focus)}
                >
                  Материалы
                </button>
              )}
              {onNotes && (
                <button
                  aria-label="Открыть конспект"
                  disabled={!focus?.course_id || status === 'saved'}
                  onClick={() => focus && onNotes?.(focus)}
                >
                  Конспект
                </button>
              )}
              {onToday && (
                <button aria-label="Расписание сегодня" onClick={onToday}>
                  Расписание
                </button>
              )}
            </div>
          )}
          {focus && !focus.course_id && onMaterials && (
            <small>К занятию не привязана дисциплина.</small>
          )}
          {savedAt && (
            <small className="lesson-updated">
              {status === 'saved' ? 'Копия от' : 'Обновлено'}{' '}
              {new Date(savedAt).toLocaleString('ru-RU', {
                timeZone: 'Asia/Bishkek',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              · Бишкек
              {status === 'fresh'
                ? stored
                  ? ' · доступно без сети'
                  : ' · копия без сети не сохранена'
                : ''}
            </small>
          )}
        </>
      )}
    </section>
  );
}
