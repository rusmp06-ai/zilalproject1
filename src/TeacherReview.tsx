import { notificationEvent } from './notifications';
import { TeacherWorkReader } from './TeacherWorkReader';
import { canReadDocument } from './reader-tools';
import { useEffect, useState, useRef } from 'react';
import { useDraft, mayLeaveDrafts } from './drafts';
import { boardDate } from './board-time';
import { sizeLabel } from './files';
import type { Gateway, ReadingState } from './types';
import {
  teacherStatus,
  type TeacherDetail,
  type TeacherCourse,
  type ReviewRow,
  type ReviewStatus,
  type ReviewEvent,
} from './teacher-types';
export function ReviewEditor({
  api,
  detail,
  user,
  onSaved,
}: {
  api: Gateway;
  detail: TeacherDetail;
  user: string;
  onSaved: (action: 'draft' | 'publish' | 'return') => Promise<void>;
}) {
  const w = detail.work,
    key = (api.demo ? 'demo:' : 'live:') + user + ':review:' + w.id;
  const draft = useDraft(key, {
      score: w.score === null ? '' : String(w.score),
      feedback: w.feedback || '',
      returnFeedback: '',
      version: w.review_version,
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [committed, setCommitted] = useState(false);
  const stale = draft.value.version !== w.review_version;
  async function save(action: 'draft' | 'publish' | 'return') {
    let score: number | null = null;
    setError('');
    setMessage('');
    if (stale) {
      setError('Сначала сравните черновик с текущей версией работы.');
      return;
    }
    if (action !== 'return') {
      score = Number(draft.value.score);
      if (
        !draft.value.score.trim() ||
        !Number.isFinite(score) ||
        score < 0 ||
        score > detail.assignment.max_score
      ) {
        setError('Укажите балл от 0 до ' + detail.assignment.max_score + '.');
        return;
      }
    }
    const feedback = action === 'return' ? draft.value.returnFeedback.trim() : draft.value.feedback;
    if (action === 'return' && !feedback) {
      setError('Объясните студенту, что нужно доработать.');
      return;
    }
    if (
      action === 'publish' &&
      !window.confirm(
        'Опубликовать ' +
          score +
          ' / ' +
          detail.assignment.max_score +
          ' для ' +
          w.student_name +
          (detail.group_name ? ' · ' + detail.group_name : '') +
          '? Студент увидит оценку и комментарий.',
      )
    )
      return;
    if (
      action === 'return' &&
      !window.confirm('Вернуть работу ' + w.student_name + ' на доработку с вашим комментарием?')
    )
      return;
    setBusy(true);
    try {
      await api.teacherReview(w.id, draft.value.version, action, score, feedback);
      setCommitted(true);
      draft.clear();
      try {
        sessionStorage.removeItem('studyhub-draft-v1:' + key);
      } catch {
        /* Keep working without device storage. */
      }
      setMessage(
        action === 'draft'
          ? 'Черновик сохранён. Студент его не видит.'
          : action === 'publish'
            ? 'Оценка опубликована.'
            : 'Работа возвращена на доработку.',
      );
      try {
        await onSaved(action);
      } catch {
        setError('Решение сохранено в аккаунте, но экран не обновился. Нажмите «Обновить работу».');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="teacher-review-editor">
      <h3>Решение преподавателя</h3>
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
      {draft.storageError && (
        <p role="alert">
          Черновик не удалось сохранить на устройстве. Не закрывайте страницу до сохранения в
          аккаунте.
        </p>
      )}
      {stale && (
        <div className="notice error">
          <p>
            Работа или оценка обновилась. Ваш черновик сохранён, но относится к предыдущей версии.
            Сравните его с опубликованными данными выше.
          </p>
          <button onClick={() => draft.setValue({ ...draft.value, version: w.review_version })}>
            Перенести мой черновик в текущую версию
          </button>
          <button
            onClick={() => {
              if (window.confirm('Заменить мой черновик данными сервера?')) draft.clear();
            }}
          >
            Принять данные сервера
          </button>
        </div>
      )}
      {detail.can_review ? (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save('publish');
            }}
          >
            <div className="teacher-score">
              <label>
                Балл
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={detail.assignment.max_score}
                  step="0.01"
                  required
                  disabled={busy || stale || committed}
                  value={draft.value.score}
                  onChange={(e) => draft.setValue({ ...draft.value, score: e.target.value })}
                />
              </label>
              <span>из {detail.assignment.max_score}</span>
            </div>
            <label>
              Комментарий студенту
              <textarea
                maxLength={50000}
                disabled={busy || committed}
                value={draft.value.feedback}
                onChange={(e) => draft.setValue({ ...draft.value, feedback: e.target.value })}
              />
            </label>
            <p className="helper">
              {w.status === 'graded'
                ? 'Изменение опубликованной оценки снова будет видно студенту.'
                : 'Черновик виден только преподавателям этой дисциплины. Публикация открывает оценку студенту.'}
            </p>
            <div className="card-actions">
              {w.status !== 'graded' && (
                <button
                  type="button"
                  disabled={busy || stale || committed}
                  onClick={() => void save('draft')}
                >
                  Сохранить черновик
                </button>
              )}
              <button className="primary" disabled={busy || stale || committed}>
                Опубликовать оценку
              </button>
            </div>
          </form>
          {w.status === 'submitted' && (
            <details className="teacher-return">
              <summary>Вернуть на доработку</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save('return');
                }}
              >
                <label>
                  Что нужно доработать
                  <textarea
                    required
                    maxLength={50000}
                    disabled={busy || committed}
                    value={draft.value.returnFeedback}
                    onChange={(e) =>
                      draft.setValue({ ...draft.value, returnFeedback: e.target.value })
                    }
                  />
                </label>
                <button disabled={busy || stale || committed}>Вернуть работу студенту</button>
              </form>
            </details>
          )}
        </>
      ) : (
        <p>
          {w.student_id === user
            ? 'Это ваша работа. Оценку должен выставить другой преподаватель.'
            : w.id !== detail.latest_id
              ? 'Это предыдущая попытка. Для оценки откройте актуальную сданную работу.'
              : w.status === 'returned'
                ? 'Работа на доработке. Ожидайте повторной сдачи.'
                : 'Работа ещё не отправлена на проверку.'}
        </p>
      )}
    </section>
  );
}
function AttemptHistory({
  api,
  detail,
  current,
  onSelect,
}: {
  api: Gateway;
  detail: TeacherDetail;
  current: string;
  onSelect: (id: string) => void;
}) {
  const [offset, setOffset] = useState(0),
    [rows, setRows] = useState(detail.history),
    [total, setTotal] = useState(detail.history.length),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    api
      .teacherHistory(current, offset)
      .then((p) => {
        if (active) {
          setRows(p.items);
          setTotal(p.total);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [api, current, offset]);
  return (
    <details className="card">
      <summary>История попыток ({total})</summary>
      {error && <p role="alert">{error}</p>}
      {rows.map((h) => (
        <button
          key={h.id}
          className="teacher-history-row"
          disabled={h.id === current || !['submitted', 'graded', 'returned'].includes(h.status)}
          onClick={() => {
            if (mayLeaveDrafts()) onSelect(h.id);
          }}
        >
          Попытка {h.attempt_no} · {teacherStatus[h.status]}
        </button>
      ))}
      <div className="pagination">
        <button disabled={busy || !offset} onClick={() => setOffset((n) => Math.max(0, n - 20))}>
          Новые попытки
        </button>
        <button
          disabled={busy || offset + rows.length >= total}
          onClick={() => setOffset((n) => n + 20)}
        >
          Предыдущие попытки
        </button>
      </div>
      <p className="helper">Старые ответы доступны для сравнения, без повторного оценивания.</p>
    </details>
  );
}
function DecisionHistory({ api, id, version }: { api: Gateway; id: string; version: number }) {
  const [open, setOpen] = useState(false),
    [offset, setOffset] = useState(0),
    [rows, setRows] = useState<ReviewEvent[]>([]),
    [total, setTotal] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (!open) return;
    setBusy(true);
    setError('');
    api
      .teacherReviewHistory(id, offset)
      .then((p) => {
        if (active) {
          setRows(p.items);
          setTotal(p.total);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [api, id, version, open, offset]);
  return (
    <details className="card" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>История оценивания</summary>
      {error && <p role="alert">{error}</p>}
      {rows.map((r) => (
        <article className="teacher-decision-event" key={r.id}>
          <b>
            {r.action === 'draft'
              ? 'Сохранён черновик'
              : r.action === 'publish'
                ? 'Оценка опубликована'
                : 'Возвращено на доработку'}
            {r.score !== null ? ' · ' + r.score : ''}
          </b>
          <p>
            {r.actor_name} · {boardDate(r.created_at)}
          </p>
          {r.previous_score !== null && r.action === 'publish' && (
            <small>Предыдущий балл: {r.previous_score}</small>
          )}
        </article>
      ))}
      {!busy && !error && open && !rows.length && (
        <p>
          История появится после проверки через этот кабинет. Ранее выставленные оценки сохранены,
          но старые действия не восстанавливаются задним числом.
        </p>
      )}
      <div className="pagination">
        <button disabled={busy || !offset} onClick={() => setOffset((n) => Math.max(0, n - 20))}>
          Новые решения
        </button>
        <button
          disabled={busy || offset + rows.length >= total}
          onClick={() => setOffset((n) => n + 20)}
        >
          Предыдущие решения
        </button>
      </div>
    </details>
  );
}
export function TeacherWorkDetail({
  api,
  id,
  user,
  onClose,
  onChanged,
  onSelect,
  onNext,
}: {
  api: Gateway;
  id: string;
  user: string;
  onClose: () => void;
  onChanged: () => void;
  onSelect: (id: string) => void;
  onNext?: () => Promise<void>;
}) {
  const positions = useRef(new Map<string, ReadingState>());
  const [detail, setDetail] = useState<TeacherDetail | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(true),
    [revision, setRevision] = useState(0),
    [message, setMessage] = useState(''),
    [reader, setReader] = useState(false);
  useEffect(() => {
    setMessage('');
    setReader(false);
  }, [id]);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    api
      .teacherDetail(id)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setDetail(null);
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [api, id, revision]);
  async function reload(action: 'draft' | 'publish' | 'return') {
    const d = await api.teacherDetail(id);
    setDetail(d);
    setMessage(
      action === 'draft'
        ? 'Черновик сохранён. Студент его не видит.'
        : action === 'publish'
          ? 'Оценка опубликована.'
          : 'Работа возвращена на доработку.',
    );
    onChanged();
  }
  async function download() {
    if (!detail) return;
    setError('');
    try {
      const blob = await api.downloadWork(detail.work),
        url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = detail.work.original_name || 'work';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось скачать файл.');
    }
  }
  return (
    <section className="teacher-detail" aria-label="Проверка работы">
      <div className="section-heading">
        <button
          onClick={() => {
            if (mayLeaveDrafts()) onClose();
          }}
        >
          К списку работ
        </button>
        <div className="card-actions">
          {onNext && (
            <button
              disabled={busy}
              onClick={() => {
                if (!mayLeaveDrafts()) return;
                setBusy(true);
                void onNext()
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              Следующая работа
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => {
              setMessage('');
              setRevision((n) => n + 1);
            }}
          >
            Обновить работу
          </button>
        </div>
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
      {busy && <p role="status">Загрузка работы…</p>}
      {detail && !busy && (
        <>
          <header className="teacher-detail-heading">
            <div>
              <span className="eyebrow">
                {detail.course_title}
                {detail.group_name ? ' · ' + detail.group_name : ''} · {detail.assignment.title}
              </span>
              <h2>{detail.work.student_name}</h2>
              {detail.work.current_member === false && (
                <p className="helper">
                  Студент сейчас вне активного состава группы. Это сохранённая работа по вашей
                  дисциплине.
                </p>
              )}
              <p>
                Попытка {detail.work.attempt_no} · {teacherStatus[detail.work.status]}
                {detail.work.is_late ? ' · с опозданием' : ''}
              </p>
            </div>
            <span>
              {detail.work.submitted_at ? boardDate(detail.work.submitted_at) : 'Не отправлена'}
            </span>
          </header>
          <div className="teacher-detail-columns">
            <div>
              <section className="card">
                <h3>Ответ студента</h3>
                {detail.work.text_answer ? (
                  <p className="teacher-answer">{detail.work.text_answer}</p>
                ) : (
                  <p>Текстового ответа нет.</p>
                )}
                {detail.work.storage_path && (
                  <div className="teacher-work-file">
                    <b>{detail.work.original_name}</b>
                    <small>{sizeLabel(detail.work.size_bytes || 0)}</small>
                    {canReadDocument(detail.work.mime_type || '') && (
                      <button className="primary" onClick={() => setReader(true)}>
                        Открыть файл работы
                      </button>
                    )}
                    <button onClick={() => void download()}>Скачать файл работы</button>
                  </div>
                )}
                {detail.work.return_feedback && (
                  <div className="notice">
                    <b>Предыдущий комментарий к доработке</b>
                    <p>{detail.work.return_feedback}</p>
                  </div>
                )}
                {detail.work.score !== null && (
                  <div className="notice success">
                    <b>
                      {detail.work.released_at ? 'Опубликованная оценка' : 'Сохранённый черновик'}:{' '}
                      {detail.work.score} / {detail.assignment.max_score}
                    </b>
                    {detail.work.feedback && (
                      <p className="teacher-answer">{detail.work.feedback}</p>
                    )}
                  </div>
                )}
              </section>
              <details className="card">
                <summary>
                  {detail.assignment_snapshot
                    ? 'Условия задания на момент сдачи'
                    : 'Текущие условия задания'}
                </summary>
                <p className="teacher-answer">{detail.assignment.description}</p>
                <p>
                  Срок:{' '}
                  {detail.assignment.due_at ? boardDate(detail.assignment.due_at) : 'Без срока'}
                </p>
              </details>
              <AttemptHistory api={api} detail={detail} current={id} onSelect={onSelect} />
              <DecisionHistory api={api} id={id} version={detail.work.review_version} />
            </div>
            <section className="card">
              <ReviewEditor
                key={detail.work.id + ':' + detail.work.review_version}
                api={api}
                detail={detail}
                user={user}
                onSaved={reload}
              />
              {detail.latest_id !== id && (
                <button
                  disabled={
                    !detail.history.some(
                      (h) =>
                        h.id === detail.latest_id &&
                        ['submitted', 'graded', 'returned'].includes(h.status),
                    )
                  }
                  onClick={() => onSelect(detail.latest_id)}
                >
                  Открыть актуальную попытку
                </button>
              )}
            </section>
          </div>
          {reader && (
            <TeacherWorkReader
              api={api}
              work={detail.work}
              initialReading={positions.current.get(detail.work.id)}
              onReadingChange={(s) => positions.current.set(detail.work.id, s)}
              onClose={() => setReader(false)}
            />
          )}
        </>
      )}
    </section>
  );
}
export function TeacherReviewQueue({
  api,
  courses,
  user,
  initialCourse = '',
  initialAssignment = '',
  onCourse,
}: {
  api: Gateway;
  courses: TeacherCourse[];
  user: string;
  initialCourse?: string;
  initialAssignment?: string;
  onCourse: (course: string, assignment?: string) => void;
}) {
  const [course, setCourse] = useState(initialCourse),
    [status, setStatus] = useState<ReviewStatus>('pending'),
    [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0),
    [rows, setRows] = useState<ReviewRow[]>([]),
    [total, setTotal] = useState(0),
    [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'hidden') setRevision((n) => n + 1);
    };
    const timer = window.setInterval(() => {
      if (!selected) refresh();
    }, 60000);
    window.addEventListener('focus', refresh);
    window.addEventListener(notificationEvent, refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(notificationEvent, refresh);
    };
  }, [selected]);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    api
      .teacherQueue(course || null, initialAssignment || null, status, search.trim(), offset)
      .then((p) => {
        if (active) {
          setRows(p.items);
          setTotal(p.total);
        }
      })
      .catch((e) => {
        if (active) {
          setRows([]);
          setTotal(0);
          setError(e.message);
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [api, course, initialAssignment, status, search, offset, revision]);
  if (selected)
    return (
      <TeacherWorkDetail
        api={api}
        id={selected}
        user={user}
        onSelect={setSelected}
        onClose={() => {
          setSelected('');
          setOffset(0);
          setRevision((n) => n + 1);
        }}
        onNext={
          status === 'pending'
            ? async () => {
                const p = await api.teacherQueue(
                  course || null,
                  initialAssignment || null,
                  status,
                  search.trim(),
                  0,
                );
                const next = p.items.find((w) => w.id !== selected);
                setSelected(next?.id || '');
                setOffset(0);
                setRevision((n) => n + 1);
              }
            : undefined
        }
        onChanged={() => setRevision((n) => n + 1)}
      />
    );
  return (
    <section className="teacher-queue">
      <div className="section-heading">
        <div>
          <h2>Работы на проверку</h2>
          <p>
            Одна строка — последняя попытка студента по заданию. Первыми показаны работы, которые
            дольше ждут проверки.
          </p>
        </div>
        <button disabled={busy} onClick={() => setRevision((n) => n + 1)}>
          Обновить очередь
        </button>
      </div>
      <div className="teacher-filters">
        <label>
          Дисциплина для проверки
          <select
            aria-label="Дисциплина для проверки"
            value={course}
            onChange={(e) => {
              setCourse(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Все мои дисциплины</option>
            {courses
              .filter((c) => c.can_grade)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} · {c.group_name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Состояние работ
          <select
            aria-label="Состояние работ"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ReviewStatus);
              setOffset(0);
            }}
          >
            {[
              ['pending', 'На проверке'],
              ['draft', 'С черновиком оценки'],
              ['graded', 'Опубликованные оценки'],
              ['returned', 'На доработке'],
              ['all', 'Все состояния'],
            ].map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Поиск студента или задания
          <input
            value={search}
            maxLength={200}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </label>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">Загрузка очереди…</p>}
      {!error && <p className="helper">Найдено работ: {total}</p>}
      <div className="teacher-queue-list">
        {rows.map((w) => (
          <article key={w.id} className="card">
            <div>
              <span className="eyebrow">
                {w.course_title} · {w.group_name}
              </span>
              <h3>{w.student_name}</h3>
              {w.current_member === false && <small>Сейчас вне активного состава группы</small>}
              <p>{w.assignment_title}</p>
              <small>
                {w.submitted_at ? boardDate(w.submitted_at) : 'Без времени сдачи'} · попытка{' '}
                {w.attempt_no}
                {w.is_late ? ' · с опозданием' : ''}
              </small>
            </div>
            <div>
              <span className="badge">
                {w.status === 'submitted' && w.score !== null && !w.released_at
                  ? 'Есть черновик оценки'
                  : teacherStatus[w.status]}
              </span>
              <div className="card-actions">
                <button className="primary" disabled={busy} onClick={() => setSelected(w.id)}>
                  {w.status === 'submitted' ? 'Проверить работу' : 'Открыть работу'}
                </button>
                <button disabled={busy} onClick={() => onCourse(w.course_id, w.assignment_id)}>
                  К заданию
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!busy && !error && !rows.length && (
        <section className="card empty">
          <h3>
            {status === 'pending'
              ? search.trim() || course || initialAssignment
                ? 'Работ на проверку с этими условиями нет'
                : 'Все доступные сданные работы проверены'
              : 'Работ с такими условиями нет'}
          </h3>
          <p>
            Измените фильтры или откройте журнал, чтобы увидеть студентов, которые ещё не сдали
            задание.
          </p>
        </section>
      )}
      <div className="pagination">
        <button
          disabled={busy || offset === 0}
          onClick={() => setOffset((n) => Math.max(0, n - 30))}
        >
          Предыдущие работы
        </button>
        <span>Страница {offset / 30 + 1}</span>
        <button
          disabled={busy || offset + rows.length >= total}
          onClick={() => setOffset((n) => n + 30)}
        >
          Следующие работы
        </button>
      </div>
    </section>
  );
}
