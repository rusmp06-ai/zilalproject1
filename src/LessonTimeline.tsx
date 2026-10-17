import { lessonDay, lessonTime } from './lesson-day';
import type { BoardItem } from './types';
export function LessonTimeline({
  events,
  now,
  onOpen,
}: {
  events: BoardItem[];
  now: number;
  onOpen?: (e: BoardItem) => void;
}) {
  const day = lessonDay(events, now);
  function row(e: BoardItem) {
    const current = e.starts_at && Date.parse(e.starts_at) <= now && Date.parse(e.ends_at!) > now;
    const content = (
      <>
        <span className="timeline-time">
          {lessonTime(e.starts_at!)}
          <small>{lessonTime(e.ends_at!)}</small>
        </span>
        <span className="timeline-title">
          <b>{e.title}</b>
          <small>{e.location || 'Аудитория не указана'}</small>
        </span>
        {current && <span className="timeline-label">Сейчас</span>}
        {day.next?.id === e.id && <span className="timeline-label">Далее</span>}
      </>
    );
    return onOpen ? (
      <button
        key={e.id}
        className={'lesson-timeline-row' + (current ? ' is-current' : '')}
        onClick={() => onOpen(e)}
      >
        {content}
      </button>
    ) : (
      <div key={e.id} className={'lesson-timeline-row' + (current ? ' is-current' : '')}>
        {content}
      </div>
    );
  }
  return (
    <div className="lesson-timeline">
      {day.past.length > 0 && (
        <details className="timeline-past">
          <summary>Прошедшие пары ({day.past.length})</summary>
          {day.past.map(row)}
        </details>
      )}
      {day.remaining.map((e, i) => {
        const previous = day.remaining[i - 1],
          gap = previous ? Date.parse(e.starts_at!) - Date.parse(previous.ends_at!) : 0;
        return (
          <div key={e.id}>
            {gap > 0 && <p className="timeline-break">Перерыв · {Math.round(gap / 60000)} мин</p>}
            {row(e)}
          </div>
        );
      })}
      {!day.today.length && <p>Сегодня занятий нет в загруженном расписании.</p>}
      {day.today.length > 0 && !day.remaining.length && <p>Все пары на сегодня завершились.</p>}
    </div>
  );
}
