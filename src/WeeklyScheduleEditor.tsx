import { useEffect, useRef, useState } from 'react';
import { useDraft, mayLeaveDrafts } from './drafts';
import {
  weekdays,
  weekdayShort,
  validateSlots,
  type WeeklyDay,
  type WeeklySlot,
} from './weekly-schedule';
import { scheduleChanged } from './useSchedule';
import { boardInstant, bishkekInput } from './board-time';
import { studyDate } from './lesson-day';
import { weekStart, moveScheduleDate } from './SchedulePanel';
import { CloseButton } from './CloseButton';
import type { Gateway, Snapshot, BoardItem } from './types';
function DayForm({
  api,
  snapshot,
  group,
  day,
  initial,
  onSaved,
  onReload,
}: {
  api: Gateway;
  snapshot: Snapshot;
  group: string;
  day: number;
  initial: WeeklyDay;
  onSaved: () => Promise<void>;
  onReload: () => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const key = (api.demo ? 'demo:' : 'live:') + snapshot.me.id + ':weekly:' + group + ':' + day,
    draft = useDraft(key, {
      items: initial.items,
      version: initial.version,
      request: requestId,
      submitted: '',
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    lock = useRef(false);
  const courses = snapshot.courses.filter((c) => c.group_id === group && !c.archived);
  function update(id: string, values: Partial<WeeklySlot>) {
    draft.setValue((v) => ({
      ...v,
      items: v.items.map((s) => (s.id === id ? { ...s, ...values } : s)),
    }));
  }
  async function save() {
    if (lock.current) return;
    setError('');
    try {
      const items = validateSlots(draft.value.items),
        payload = JSON.stringify(items),
        request =
          draft.value.submitted && draft.value.submitted !== payload
            ? crypto.randomUUID()
            : draft.value.request;
      draft.setValue((v) => ({ ...v, request, submitted: payload }));
      lock.current = true;
      setBusy(true);
      await api.saveWeeklyDay(group, day, items, draft.value.version, request);
      draft.clear();
      try {
        sessionStorage.removeItem('studyhub-draft-v1:' + key);
      } catch {}
      scheduleChanged();
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить. Повторите отправку.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className="weekly-day-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="section-heading">
        <h3>{weekdays[day - 1]}</h3>
        <small>Повторяется каждую неделю</small>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
          {error.includes('изменилось') && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Обновить день и убрать несохранённые изменения?')) {
                  draft.clear();
                  try {
                    sessionStorage.removeItem('studyhub-draft-v1:' + key);
                  } catch {}
                  onReload();
                }
              }}
            >
              Обновить день
            </button>
          )}
        </p>
      )}
      {draft.storageError && (
        <p role="alert">
          Черновик не сохраняется на устройстве. Не закрывайте страницу до сохранения.
        </p>
      )}
      <div className="weekly-rows">
        {draft.value.items.map((s, index) => (
          <fieldset className="weekly-row" disabled={busy} key={s.id}>
            <legend>Пара {index + 1}</legend>
            <label>
              Дисциплина
              <select
                required
                aria-label={'Дисциплина пары ' + (index + 1)}
                value={s.course_id}
                onChange={(e) => update(s.id, { course_id: e.target.value })}
              >
                <option value="">Выберите дисциплину</option>
                {!courses.some((c) => c.id === s.course_id) && s.course_id && (
                  <option value={s.course_id} disabled>
                    Недоступная дисциплина — замените или удалите
                  </option>
                )}
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Начало
              <input
                aria-label={'Начало пары ' + (index + 1)}
                required
                type="time"
                value={s.start_time}
                onChange={(e) => update(s.id, { start_time: e.target.value })}
              />
            </label>
            <label>
              Конец
              <input
                aria-label={'Конец пары ' + (index + 1)}
                required
                type="time"
                value={s.end_time}
                onChange={(e) => update(s.id, { end_time: e.target.value })}
              />
            </label>
            <label>
              Аудитория
              <input
                aria-label={'Аудитория пары ' + (index + 1)}
                maxLength={200}
                value={s.location}
                placeholder="Необязательно"
                onChange={(e) => update(s.id, { location: e.target.value })}
              />
            </label>
            <CloseButton
              label={'Убрать пару ' + (index + 1)}
              onClick={() =>
                draft.setValue((v) => ({ ...v, items: v.items.filter((i) => i.id !== s.id) }))
              }
            />
          </fieldset>
        ))}
      </div>
      {!draft.value.items.length && <p className="muted">Пар нет. Добавьте первую пару.</p>}
      <div className="card-actions">
        <button
          type="button"
          disabled={busy || !courses.length || draft.value.items.length >= 24}
          onClick={() =>
            draft.setValue((v) => ({
              ...v,
              items: [
                ...v.items,
                {
                  id: crypto.randomUUID(),
                  course_id: '',
                  start_time: '',
                  end_time: '',
                  location: '',
                },
              ],
            }))
          }
        >
          Добавить пару
        </button>
        <button className="primary" disabled={busy || !draft.changed}>
          {busy ? 'Сохраняем…' : 'Сохранить расписание'}
        </button>
      </div>
      {!courses.length && <p>Сначала добавьте дисциплины этой группы.</p>}
    </form>
  );
}
export function WeeklyScheduleEditor({
  api,
  snapshot,
  group,
}: {
  api: Gateway;
  snapshot: Snapshot;
  group: string;
}) {
  const [day, setDay] = useState(1),
    [data, setData] = useState<WeeklyDay | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [revision, setRevision] = useState(0),
    [date, setDate] = useState(weekStart(studyDate(Date.now()))),
    [events, setEvents] = useState<BoardItem[]>([]),
    [eventsError, setEventsError] = useState(''),
    [editing, setEditing] = useState<BoardItem | null>(null),
    [saving, setSaving] = useState(false),
    [eventBusy, setEventBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    setData(null);
    api
      .weeklyDay(group, day)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Не удалось открыть расписание.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [api, group, day, revision]);
  useEffect(() => {
    let active = true;
    setEventBusy(true);
    setEvents([]);
    setEventsError('');
    void (async () => {
      const rows: BoardItem[] = [],
        from = boardInstant(date + 'T00:00'),
        to = boardInstant(moveScheduleDate(date, 1) + 'T00:00');
      for (let offset = 0; offset <= 100000; offset += 50) {
        const p = await api.board(group, 'schedule', from, to, offset);
        if (!p.canRead) throw Error('Расписание недоступно.');
        rows.push(...p.items);
        if (p.items.length < 50) {
          if (active) setEvents(rows);
          return;
        }
      }
      throw Error('Слишком много занятий.');
    })()
      .catch(() => {
        if (active) setEventsError('Не удалось проверить занятия на выбранную дату.');
      })
      .finally(() => {
        if (active) setEventBusy(false);
      });
    return () => {
      active = false;
    };
  }, [api, group, date, revision]);
  async function saved() {
    setMessage('Расписание сохранено.');
    setData(null);
    setRevision((v) => v + 1);
  }
  return (
    <section className="weekly-editor" aria-label="Недельное расписание">
      <h2>Расписание группы</h2>
      <p className="helper">Выберите день недели и добавьте пары. Время — Бишкек.</p>
      <nav className="weekday-strip" aria-label="Дни недели для заполнения">
        {weekdayShort.map((label, i) => (
          <button
            key={label}
            aria-label={weekdays[i]}
            aria-pressed={day === i + 1}
            onClick={() => {
              if (mayLeaveDrafts()) {
                setDay(i + 1);
                setMessage('');
                setEditing(null);
                setDate(moveScheduleDate(weekStart(studyDate(Date.now())), i));
              }
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {busy && <p role="status">Загружаем…</p>}
      {error && (
        <p className="notice error" role="alert">
          {error} <button onClick={() => setRevision((v) => v + 1)}>Повторить</button>
        </p>
      )}
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      {data && (
        <DayForm
          key={group + day + revision}
          api={api}
          snapshot={snapshot}
          group={group}
          day={day}
          initial={data}
          onSaved={saved}
          onReload={() => {
            setData(null);
            setMessage('');
            setRevision((v) => v + 1);
          }}
        />
      )}
      <details className="schedule-date-changes">
        <summary>Изменения на отдельную дату</summary>
        <label>
          Дата изменения
          <input
            type="date"
            value={date}
            disabled={saving}
            onChange={(e) => {
              if (e.target.value && mayLeaveDrafts()) {
                setDate(e.target.value);
                setEditing(null);
              }
            }}
          />
        </label>
        {eventsError && (
          <p role="alert">
            {eventsError}
            <button onClick={() => setRevision((v) => v + 1)}>Повторить</button>
          </p>
        )}
        {eventBusy && <p role="status">Проверяем занятия…</p>}
        {!eventBusy && !eventsError && !events.length && <p>На эту дату пар нет.</p>}
        {events.map((e) => (
          <article className="schedule-date-row" key={e.id}>
            <div>
              <b>{e.title}</b>
              <p>
                {bishkekInput(e.starts_at!).slice(11)}–{bishkekInput(e.ends_at!).slice(11)}
                {e.location ? ' · ' + e.location : ''}
                {e.cancelled ? ' · Отменено' : ''}
              </p>
              <small>
                {e.template_id ? 'Еженедельная пара' : 'Ранее добавленное занятие на дату'}
              </small>
            </div>
            {e.can_manage && (
              <button
                disabled={saving}
                onClick={() => {
                  if (mayLeaveDrafts()) setEditing(e);
                }}
              >
                Изменить на эту дату
              </button>
            )}
          </article>
        ))}
      </details>
      {editing && (
        <DateChange
          key={editing.id}
          api={api}
          event={editing}
          snapshot={snapshot}
          group={group}
          onBusy={setSaving}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setData(null);
            scheduleChanged();
            setRevision((v) => v + 1);
            setMessage('Изменение сохранено только на выбранную дату.');
          }}
        />
      )}
    </section>
  );
}
function DateChange({
  api,
  event,
  snapshot,
  group,
  onBusy,
  onClose,
  onSaved,
}: {
  api: Gateway;
  event: BoardItem;
  snapshot: Snapshot;
  group: string;
  onBusy: (b: boolean) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const draftKey =
      (api.demo ? 'demo:' : 'live:') + snapshot.me.id + ':schedule-exception:' + event.id,
    draft = useDraft(draftKey, {
      course: event.course_id || '',
      start: bishkekInput(event.starts_at!).slice(11),
      end: bishkekInput(event.ends_at!).slice(11),
      location: event.location,
      cancelled: event.cancelled || false,
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    lock = useRef(false);
  async function save(reset = false) {
    if (lock.current) return;
    setError('');
    try {
      const v = draft.value;
      validateSlots([
        {
          id: event.id,
          course_id: v.course,
          start_time: v.start,
          end_time: v.end,
          location: v.location,
        },
      ]);
      lock.current = true;
      setBusy(true);
      onBusy(true);
      if (event.template_id)
        await api.saveScheduleException(
          {
            slot: event.template_id,
            date: event.occurrence_date!,
            ...v,
            version: event.version || 0,
          },
          reset,
        );
      else if (v.cancelled) {
        if (!window.confirm('Удалить это занятие на выбранную дату?')) return;
        await api.deleteBoard(event.id);
      } else
        await api.saveBoard({
          id: event.id,
          group,
          course: event.course_id,
          kind: 'schedule',
          title: event.title,
          body: event.body,
          location: v.location,
          start: boardInstant(bishkekInput(event.starts_at!).slice(0, 10) + 'T' + v.start),
          end: boardInstant(bishkekInput(event.ends_at!).slice(0, 10) + 'T' + v.end),
        });
      draft.clear();
      try {
        sessionStorage.removeItem('studyhub-draft-v1:' + draftKey);
      } catch {}
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить изменение.');
    } finally {
      lock.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section className="card schedule-exception" aria-label="Изменение занятия на дату">
      <div className="section-heading">
        <h3>Только {event.occurrence_date || bishkekInput(event.starts_at!).slice(0, 10)}</h3>
        <CloseButton
          disabled={busy}
          onClick={() => {
            if (mayLeaveDrafts()) onClose();
          }}
        />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          Дисциплина
          <select
            required
            disabled={busy || !event.template_id}
            value={draft.value.course}
            onChange={(e) => draft.setValue((v) => ({ ...v, course: e.target.value }))}
          >
            {snapshot.courses
              .filter((c) => c.group_id === group && !c.archived)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            Начало
            <input
              required
              type="time"
              value={draft.value.start}
              onChange={(e) => draft.setValue((v) => ({ ...v, start: e.target.value }))}
            />
          </label>
          <label>
            Конец
            <input
              required
              type="time"
              value={draft.value.end}
              onChange={(e) => draft.setValue((v) => ({ ...v, end: e.target.value }))}
            />
          </label>
          <label>
            Аудитория
            <input
              maxLength={200}
              value={draft.value.location}
              onChange={(e) => draft.setValue((v) => ({ ...v, location: e.target.value }))}
            />
          </label>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.value.cancelled}
            onChange={(e) => draft.setValue((v) => ({ ...v, cancelled: e.target.checked }))}
          />
          Отменить занятие на эту дату
        </label>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <div className="card-actions">
          <button className="primary" disabled={busy}>
            Сохранить изменение
          </button>
          {event.template_id && !!event.version && (
            <button type="button" disabled={busy} onClick={() => void save(true)}>
              Вернуть обычное расписание
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
