import { FilePicker } from './FilePicker';
import { CloseButton } from './CloseButton';
import {
  pendingIntake,
  publicationLock,
  publishRecoverable,
  matchesIntake,
  forgetIntake,
  markDeleting,
  type PendingIntake,
} from './intake-recovery';
import { useEffect, useRef, useState, useId } from 'react';
import { IntakePreview } from './IntakePreview';
import { FILE_ACCEPT, sizeLabel, validateFile } from './files';
import { prepareAnalysis } from './material-analysis-input';
import { boardInstant } from './board-time';
import { mayLeaveDrafts, usePendingFileGuard } from './drafts';
import type { Gateway } from './types';
import type {
  IntakeContext,
  IntakeKind,
  MaterialAnalysis,
  IntakePublication,
  MaterialAiQuota,
} from './material-intake-types';
const labels: Record<IntakeKind, string> = {
  lecture: 'Лекция',
  presentation: 'Презентация',
  assignment: 'Задание',
  book: 'Книга',
  material: 'Учебный материал',
};
export function MaterialIntake({
  api,
  initialCourse = '',
  initialGroup = '',
  onPublished,
}: {
  api: Gateway;
  initialCourse?: string;
  initialGroup?: string;
  onPublished?: () => void;
}) {
  const [quota, setQuota] = useState<MaterialAiQuota | null>(null),
    [quotaError, setQuotaError] = useState('');
  const [preview, setPreview] = useState(false),
    [recovery, setRecovery] = useState<PendingIntake | null>(null),
    [user, setUser] = useState('');
  const [open, setOpen] = useState(false),
    [context, setContext] = useState<IntakeContext | null>(null),
    [file, setFile] = useState<File | null>(null),
    [analysis, setAnalysis] = useState<MaterialAnalysis | null>(null),
    [kind, setKind] = useState<IntakeKind | ''>(''),
    [course, setCourse] = useState(''),
    [group, setGroup] = useState(''),
    [title, setTitle] = useState(''),
    [description, setDescription] = useState(''),
    [due, setDue] = useState(''),
    [max, setMax] = useState('100'),
    [late, setLate] = useState(false),
    [consent, setConsent] = useState(false),
    [phase, setPhase] = useState<'idle' | 'loading' | 'analysis' | 'publishing' | 'retry' | 'done'>(
      'idle',
    ),
    [error, setError] = useState(''),
    [status, setStatus] = useState('');
  const controller = useRef<AbortController | null>(null),
    request = useRef<string | null>(null),
    pinned = useRef<{ publication: IntakePublication; file: File } | null>(null),
    generation = useRef(0);
  const guardId = useId();
  usePendingFileGuard(
    guardId,
    open && (!!file || phase === 'publishing') && phase !== 'done',
    phase === 'publishing',
  );
  const busy = phase === 'analysis' || phase === 'loading' || phase === 'publishing',
    locked = busy || phase === 'retry';
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  async function start() {
    if (!mayLeaveDrafts()) return;
    setOpen(true);
    setError('');
    setPhase('loading');
    const run = ++generation.current;
    try {
      const [c, s] = await Promise.all([api.materialIntakeContext(), api.snapshot()]);
      if (run !== generation.current) return;
      setContext(c);
      setUser(s.me.id);
      const pending = pendingIntake(api, s.me.id);
      if (pending) {
        restore(pending);
        setPhase('retry');
        setStatus(
          'Найдена незавершённая публикация. Проверьте её состояние или прикрепите тот же файл для повтора.',
        );
      } else {
        const selected = c.courses.find((x) => x.id === initialCourse);
        setCourse(selected?.id || '');
        setGroup(
          initialGroup || selected?.group_id || (c.groups.length === 1 ? c.groups[0].id : ''),
        );
        setPhase('idle');
      }
      void refreshQuota(run);
    } catch (e) {
      if (run === generation.current) {
        setError((e as Error).message);
        setPhase('idle');
      }
    }
  }
  function restore(p: PendingIntake) {
    if (pinned.current?.publication.request !== p.publication.request) {
      pinned.current = null;
      setFile(null);
    }
    setRecovery(p);
    request.current = p.publication.request;
    setKind(p.publication.kind);
    setCourse(p.publication.course || '');
    setGroup(p.publication.group || '');
    setTitle(p.publication.title);
    setDescription(p.publication.description);
    setMax(String(p.publication.max));
    setLate(p.publication.late);
    setDue(
      p.publication.due
        ? new Date(Date.parse(p.publication.due) + 6 * 3600000).toISOString().slice(0, 16)
        : '',
    );
  }
  async function attach(file: File | null) {
    if (!recovery) return;
    if (!file) {
      setFile(null);
      pinned.current = null;
      return;
    }
    try {
      if (!(await matchesIntake(recovery, file)))
        throw Error(
          'Это другой файл. Выберите исходный документ с тем же содержимым, именем и размером.',
        );
      setFile(file);
      pinned.current = { publication: recovery.publication, file };
      setError('');
    } catch (e) {
      setFile(null);
      pinned.current = null;
      setError((e as Error).message);
    }
  }
  async function completed() {
    if (request.current) forgetIntake(api, user, request.current);
    setRecovery(null);
    setPhase('done');
    setStatus('Материал опубликован. Оригинальный файл сохранён.');
    pinned.current = null;
    setError('');
    try {
      await onPublished?.();
    } catch {
      setError(
        'Публикация подтверждена, но список не обновился. Обновите раздел; повторять загрузку не нужно.',
      );
    }
  }
  async function check() {
    if (!recovery || busy) return;
    setPhase('loading');
    setError('');
    try {
      const s = await api.intakeStatus(recovery.publication.request);
      if (s.status === 'published') {
        await completed();
        return;
      }
      if (s.status === 'cancelled') {
        forgetIntake(api, user, recovery.publication.request);
        resetFile(null);
        setStatus('Незавершённая публикация отменена.');
        return;
      }
      if (s.status === 'deleting') {
        const next = { ...recovery, deleting: true };
        markDeleting(api, user, next);
        setRecovery(next);
      }
      setStatus(
        s.status === 'none'
          ? 'Загрузка ещё не была зарезервирована. Можно повторить с исходным файлом.'
          : s.status === 'deleting'
            ? 'Отмена не завершена. Повторите её, чтобы освободить место.'
            : 'Файл ещё не опубликован. Можно повторить загрузку или отменить её.',
      );
    } catch (e) {
      setError((e as Error).message);
    }
    setPhase('retry');
  }
  async function cancel() {
    if (
      !recovery ||
      busy ||
      !window.confirm(
        'Отменить незавершённую публикацию и удалить её файл? Уже опубликованный материал останется на месте.',
      )
    )
      return;
    setPhase('publishing');
    setError('');
    try {
      const next = { ...recovery, deleting: true };
      markDeleting(api, user, next);
      setRecovery(next);
      const s = await publicationLock(api, user, () =>
        api.cancelIntake(recovery.publication.request),
      );
      if (s.status === 'published') {
        await completed();
        return;
      }
      if (s.status !== 'cancelled') throw Error('Отмена не подтверждена сервером.');
      forgetIntake(api, user, recovery.publication.request);
      resetFile(null);
      setStatus('Незавершённая публикация отменена, резерв места освобождён.');
      try {
        await onPublished?.();
      } catch {
        /* Cancellation itself has completed. */
      }
    } catch (e) {
      if ((e as { notStarted?: boolean }).notStarted) {
        const previous = { ...recovery, deleting: false };
        try {
          markDeleting(api, user, previous);
          setRecovery(previous);
        } catch {
          /* Keep cancellation blocked until storage is usable again. */
        }
      }
      setPhase('retry');
      setError((e as Error).message);
      setStatus('Отмена не подтверждена. Повторите её после восстановления соединения.');
    }
  }
  async function refreshQuota(run = generation.current) {
    try {
      const q = await api.materialAiQuota();
      if (run === generation.current) {
        setQuota(q);
        setQuotaError('');
      }
    } catch (e) {
      if (run === generation.current) setQuotaError((e as Error).message);
    }
  }
  function resetFile(next: File | null) {
    setRecovery(null);
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    setPreview(false);
    setFile(next);
    setAnalysis(null);
    setKind('');
    setTitle('');
    setDescription('');
    setDue('');
    setMax('100');
    setLate(false);
    setConsent(false);
    request.current = null;
    pinned.current = null;
    setError('');
    setStatus('');
    setPhase('idle');
    setCourse(context?.courses.some((c) => c.id === initialCourse) ? initialCourse : '');
    if (next)
      try {
        validateFile(next);
        void refreshQuota();
      } catch (e) {
        setFile(null);
        setError((e as Error).message);
      }
  }
  function close() {
    if (phase === 'publishing') return;
    if (
      (file || phase === 'retry') &&
      !window.confirm(
        phase === 'retry'
          ? 'Публикация не завершена. Данные для повтора сохранятся в этом браузере, но исходный файл потребуется выбрать снова. Закрыть?'
          : 'Закрыть помощника? Подготовленные поля будут сброшены.',
      )
    )
      return;
    generation.current++;
    controller.current?.abort();
    setPreview(false);
    setOpen(false);
    setRecovery(null);
    setQuota(null);
    setQuotaError('');
    setFile(null);
    setAnalysis(null);
    setContext(null);
    setStatus('');
    setError('');
    setPhase('idle');
    request.current = null;
    pinned.current = null;
  }
  async function analyze() {
    if (!file || !context || !consent || busy) return;
    const run = ++generation.current,
      abort = new AbortController();
    controller.current = abort;
    setPhase('analysis');
    setError('');
    setStatus('Читаем документ…');
    try {
      const input = await prepareAnalysis(file, abort.signal);
      if (run !== generation.current) return;
      setStatus('Gemini определяет тип и дисциплину…');
      const result = await api.analyzeMaterial(
        { ...input, scopeCourse: initialCourse || null, scopeGroup: initialGroup || null },
        abort.signal,
      );
      if (run !== generation.current || abort.signal.aborted) return;
      const validCourse = context.courses.find(
        (c) => c.id === result.course_id && (!initialGroup || c.group_id === initialGroup),
      );
      if (result.quota) setQuota(result.quota);
      setAnalysis(result);
      setKind(result.kind === 'unknown' ? '' : result.kind);
      setTitle(result.title);
      setDescription(result.description);
      setCourse(result.confidence === 'low' ? '' : validCourse?.id || '');
      if (validCourse) setGroup(validCourse.group_id);
      setStatus(
        result.cached
          ? 'Использован сохранённый результат. Новый запрос Gemini не потрачен.'
          : 'Проверьте предложенные поля. Ничего ещё не опубликовано.',
      );
      setPhase('idle');
    } catch (e) {
      if (run !== generation.current || abort.signal.aborted) return;
      setError((e as Error).message);
      const q = (e as { quota?: MaterialAiQuota }).quota;
      if (q) setQuota(q);
      setPhase('idle');
      setStatus('Вы можете заполнить поля самостоятельно.');
      void refreshQuota(run);
    } finally {
      if (run === generation.current) controller.current = null;
    }
  }
  async function publish() {
    if (!file || !kind || !title.trim() || !context || busy) return;
    setError('');
    let prepared = pinned.current;
    if (!prepared) {
      const target = context.courses.find((c) => c.id === course);
      if (kind !== 'book' && (!target || !target.kinds.includes(kind))) {
        setError('Выберите дисциплину с правом публикации этого типа.');
        return;
      }
      if (kind === 'book' && !context.groups.some((g) => g.id === group)) {
        setError('Выберите группу автора книги.');
        return;
      }
      if (kind === 'assignment' && !description.trim()) {
        setError('Добавьте условия задания или укажите, что они находятся в оригинале.');
        return;
      }
      let instant: string | null = null;
      try {
        instant = due ? boardInstant(due) : null;
      } catch {
        setError('Проверьте дату и время срока сдачи.');
        return;
      }
      if (kind === 'assignment' && due && !instant) {
        setError('Проверьте срок сдачи.');
        return;
      }
      if (
        kind === 'assignment' &&
        instant &&
        new Date(instant).getTime() < Date.now() &&
        !window.confirm('Срок сдачи уже прошёл. Создать задание с этим сроком?')
      )
        return;
      const destination =
        kind === 'book' ? 'общей библиотеке' : `${target!.title} · ${target!.group_name}`;
      if (
        !window.confirm(
          `Опубликовать «${title.trim()}» в ${destination}? Материал станет доступен студентам.`,
        )
      )
        return;
      request.current ??= crypto.randomUUID();
      prepared = {
        file,
        publication: {
          request: request.current,
          kind,
          course: kind === 'book' ? null : course,
          group: kind === 'book' ? group : target!.group_id,
          title: title.trim(),
          description: kind === 'book' ? '' : description,
          due: kind === 'assignment' ? instant : null,
          max: Number(max),
          late,
        },
      };
      pinned.current = prepared;
    }
    setPhase('publishing');
    setStatus('Загружаем оригинал и подтверждаем публикацию…');
    try {
      await publishRecoverable(api, prepared.publication, prepared.file, user);
      await completed();
    } catch (e) {
      setError((e as Error).message);
      if ((e as { canEdit?: boolean }).canEdit) {
        pinned.current = null;
        request.current = null;
        setPhase('idle');
        setStatus('Публикация не создана. Исправьте данные или настройки.');
      } else {
        try {
          const p = pendingIntake(api, user);
          if (p) restore(p);
        } catch {}
        setPhase('retry');
        setStatus(
          'Данные закреплены для безопасного повтора. Повторная отправка не создаёт вторую публикацию.',
        );
      }
    }
  }
  if (!open)
    return (
      <button type="button" className="intake-open" onClick={() => void start()}>
        Добавить документ с ИИ
      </button>
    );
  const available =
    context?.courses.filter(
      (c) => (!initialGroup || c.group_id === initialGroup) && (!kind || c.kinds.includes(kind)),
    ) || [];
  return (
    <section className="card material-intake" aria-label="Добавление документа с ИИ">
      <div className="section-heading">
        <div>
          <h3>Добавить документ</h3>
        </div>
        <CloseButton label="Закрыть помощника" disabled={phase === 'publishing'} onClick={close} />
      </div>
      <p>Распознайте документ или заполните поля вручную.</p>
      <p className="helper">PDF, DOCX, PPTX, XLSX, EPUB, TXT и изображения — до 10 МБ.</p>
      {context && (
        <div className="intake-budget">
          <div className="intake-budget-line">
            <small>
              {api.demo
                ? 'Деморежим · без запросов Gemini'
                : quota
                  ? `Вам осталось ${quota.user_remaining} из ${quota.user_daily} анализов сегодня`
                  : 'Анализ необязателен'}
            </small>
            <details>
              <summary>Лимиты ИИ</summary>
              {quota && (
                <p>
                  Проект: {quota.project_remaining} из {quota.project_daily} анализов сегодня. До{' '}
                  {quota.rpm} запросов и {quota.tpm.toLocaleString('ru-RU')} токенов в минуту.
                  {quota.retry_after_seconds > 0 ? ' Действует пауза провайдера.' : ''}
                </p>
              )}
              <p>
                Повторный анализ из кеша не расходует квоту. Лимит Gemini может быть ниже лимита
                приложения.
              </p>
              <button type="button" disabled={busy} onClick={() => void refreshQuota()}>
                Обновить лимиты
              </button>
            </details>
          </div>
          {quotaError && <p role="status">{quotaError}</p>}
        </div>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="notice">
          {status}
        </p>
      )}
      {recovery && phase !== 'done' && (
        <section className="notice" aria-label="Незавершённая публикация">
          <h4>{recovery.publication.title}</h4>
          <p>
            {labels[recovery.publication.kind]} · {recovery.name} · {sizeLabel(recovery.size)}
          </p>
          <p>
            Назначение:{' '}
            {recovery.publication.kind === 'book'
              ? 'Общая библиотека'
              : context?.courses.find((c) => c.id === recovery.publication.course)?.title ||
                'Дисциплина сейчас недоступна'}
          </p>
          <p>Для повтора выберите исходный файл.</p>
          {recovery.deleting ? (
            <p>Начата отмена. Повторная публикация заблокирована.</p>
          ) : (
            <FilePicker
              label="Исходный файл для повтора"
              file={file}
              accept={FILE_ACCEPT}
              disabled={busy}
              onChange={(f) => void attach(f)}
            />
          )}
          <div className="card-actions">
            <button type="button" disabled={busy} onClick={() => void check()}>
              Проверить публикацию
            </button>
            <button type="button" disabled={busy} onClick={() => void cancel()}>
              Отменить незавершённую публикацию
            </button>
            {!recovery.deleting && (
              <button type="button" disabled={busy || !file} onClick={() => void publish()}>
                Продолжить загрузку
              </button>
            )}
          </div>
        </section>
      )}
      {context && !recovery && phase !== 'done' && (
        <>
          <FilePicker
            label="Документ для распознавания"
            file={file}
            accept={FILE_ACCEPT}
            disabled={phase === 'publishing' || phase === 'retry'}
            onChange={resetFile}
          />
          {file && (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={locked}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                Разрешаю отправить текст, изображение или первые 3 страницы документа в Gemini для
                анализа.
              </label>
              <div className="card-actions">
                <button
                  type="button"
                  disabled={phase === 'publishing'}
                  onClick={() => setPreview(true)}
                >
                  Посмотреть оригинал
                </button>
                <button type="button" disabled={locked || !consent} onClick={() => void analyze()}>
                  Распознать документ
                </button>
                {phase === 'analysis' && (
                  <button
                    type="button"
                    onClick={() => {
                      generation.current++;
                      controller.current?.abort();
                      controller.current = null;
                      setPhase('idle');
                      setStatus('Анализ отменён. Файл остался у вас.');
                    }}
                  >
                    Отменить анализ
                  </button>
                )}
              </div>
              {analysis && (
                <div className="intake-evidence">
                  <b>
                    {analysis.confidence === 'high'
                      ? 'Уверенное распознавание'
                      : analysis.confidence === 'medium'
                        ? 'Есть предположение'
                        : 'Проверьте результат'}
                  </b>
                  {analysis.topic && <p>{analysis.topic}</p>}
                  {!analysis.course_id && <p>Выберите дисциплину ниже.</p>}
                  <details>
                    <summary>Почему так определено</summary>
                    <p>{analysis.reason}</p>
                    {kind === 'book' && analysis.description && <p>{analysis.description}</p>}
                    {analysis.evidence.map((quote, i) => (
                      <blockquote key={i}>{quote}</blockquote>
                    ))}
                    {analysis.excerpted && <p>Проанализирован начальный фрагмент.</p>}
                  </details>
                </div>
              )}
              {kind === 'assignment' && !available.length && (
                <p className="notice">
                  Назначать задания может преподаватель своей дисциплины или владелец. В текущем
                  контексте такой дисциплины нет.
                </p>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void publish();
                }}
              >
                <fieldset disabled={locked}>
                  <legend>Проверьте перед публикацией</legend>
                  <div className="form-row">
                    <label>
                      Тип документа
                      <select
                        aria-label="Тип документа"
                        required
                        value={kind}
                        onChange={(e) => {
                          setKind(e.target.value as IntakeKind);
                          setError('');
                        }}
                      >
                        <option value="">Выберите тип</option>
                        {Object.entries(labels).map(([id, name]) => (
                          <option value={id} key={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Название документа
                      <input
                        required
                        maxLength={200}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                      />
                    </label>
                  </div>
                  {kind === 'book' ? (
                    <>
                      <p>Книга будет опубликована в общей библиотеке.</p>
                      <label>
                        Группа автора
                        <select
                          aria-label="Группа автора"
                          required
                          value={group}
                          onChange={(e) => setGroup(e.target.value)}
                        >
                          <option value="">Выберите группу</option>
                          {context.groups
                            .filter((g) => !initialGroup || g.id === initialGroup)
                            .map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    </>
                  ) : (
                    <label>
                      Дисциплина для публикации
                      <select
                        aria-label="Дисциплина для публикации"
                        required
                        value={available.some((c) => c.id === course) ? course : ''}
                        onChange={(e) => setCourse(e.target.value)}
                      >
                        <option value="">Выберите дисциплину</option>
                        {available.map((c) => (
                          <option value={c.id} key={c.id}>
                            {c.title} · {c.group_name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {kind !== 'book' && (
                    <label>
                      {kind === 'assignment' ? 'Условия задания' : 'Описание документа'}
                      <textarea
                        aria-label={
                          kind === 'assignment' ? 'Условия задания' : 'Описание документа'
                        }
                        maxLength={50000}
                        required={kind === 'assignment'}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </label>
                  )}
                  {kind === 'assignment' && (
                    <>
                      <div className="form-row">
                        <label>
                          Срок сдачи — необязательно
                          <input
                            type="datetime-local"
                            value={due}
                            onChange={(e) => setDue(e.target.value)}
                          />
                        </label>
                        <label>
                          Максимальный балл
                          <input
                            type="number"
                            min={1}
                            max={1000}
                            required
                            value={max}
                            onChange={(e) => setMax(e.target.value)}
                          />
                        </label>
                      </div>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={late}
                          onChange={(e) => setLate(e.target.checked)}
                        />
                        Разрешить сдачу после срока
                      </label>
                    </>
                  )}
                </fieldset>
                <button className="primary" disabled={busy || !kind || !title.trim()}>
                  {phase === 'publishing'
                    ? 'Публикуем…'
                    : phase === 'retry'
                      ? 'Повторить публикацию'
                      : 'Утвердить и опубликовать'}
                </button>
              </form>
            </>
          )}
        </>
      )}
      {phase === 'done' && (
        <button type="button" onClick={() => resetFile(null)}>
          Добавить следующий документ
        </button>
      )}
      {preview && file && (
        <IntakePreview
          key={file.name + file.size}
          api={api}
          file={file}
          onClose={() => setPreview(false)}
        />
      )}
    </section>
  );
}
