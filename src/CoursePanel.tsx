import { CourseCover } from './CourseCover';
import { useViewState, shortText } from './view-state';
import type { CourseSection } from './navigation';
import { TeacherAssignments } from './TeacherAssignments';
import type { TeacherCourse } from './teacher-types';
import { useEffect, useRef, useState } from 'react';
import { CourseMaterialsPanel } from './CourseMaterialsPanel';
import { AssignmentsPanel } from './AssignmentsPanel';
import { CourseReader } from './CourseReader';
import { NotesPanel } from './NotesPanel';
import { BoardPanel } from './BoardPanel';
import { BookCover } from './BookCover';
import { StudyIcon } from './StudyIcon';
import { canReadDocument } from './reader-tools';
import { mayLeaveDrafts, useDraft } from './drafts';
import {
  loadCourseData,
  assignmentStatus,
  courseStatusLabels,
  type CourseData,
} from './course-workspace';
import type { Gateway, Course, CourseMaterial, MaterialKind, LibraryItem, Snapshot } from './types';
type Tab = CourseSection;
const tabs: Record<Tab, string> = {
  overview: 'Обзор',
  lectures: 'Лекции',
  assignment: 'Задания',
  resources: 'Дополнительные материалы',
  notes: 'Мои заметки',
  topics: 'Темы',
  materials: 'Материалы',
  announcements: 'Объявления',
};
const kindLabels = { lecture: 'Лекция', presentation: 'Презентация', material: 'Материал' };
const when = (date: string) =>
  new Date(date).toLocaleString('ru-RU', {
    timeZone: 'Asia/Bishkek',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
export function CoursePanel({
  api,
  course,
  onClose,
  initialKind,
  initialAssignment = '',
  userId = 'test',
  groupName = '',
  snapshot,
  initialTab,
  allowManagement = true,
  teacherCourse,
  onLocation,
  initialMaterial,
}: {
  api: Gateway;
  course: Course;
  onClose: () => void;
  initialKind?: MaterialKind | 'assignment';
  initialAssignment?: string;
  userId?: string;
  groupName?: string;
  snapshot?: Snapshot;
  initialTab?: CourseSection;
  initialMaterial?: string;
  onLocation?: (section: CourseSection, task?: string, material?: string) => void;
  allowManagement?: boolean;
  teacherCourse?: TeacherCourse;
}) {
  const [tab, setTab] = useState<Tab>(
      initialKind === 'assignment'
        ? 'assignment'
        : !teacherCourse && (!initialTab || initialTab === 'overview')
          ? initialKind
            ? 'materials'
            : 'lectures'
          : initialTab || (initialKind ? 'materials' : 'overview'),
    ),
    [data, setData] = useState<CourseData | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [revision, setRevision] = useState(0),
    [selectedTask, setSelectedTask] = useState(initialAssignment),
    [reader, setReader] = useState<CourseMaterial | null>(null),
    [textMaterial, setTextMaterial] = useState<CourseMaterial | null>(null),
    [query, setQuery] = useViewState<string>('groups', 'query', '', shortText),
    [selectedTopic, setSelectedTopic] = useViewState<string>('groups', 'topic', '', (v) =>
      /^[a-zA-Z0-9_-]{0,128}$/.test(v),
    ),
    [offset, setOffset] = useState(0),
    [manage, setManage] = useState(false),
    [deleting, setDeleting] = useState(''),
    [editingMaterials, setEditingMaterials] = useState(false);
  useEffect(() => {
    if (!onLocation) return;
    setReader(null);
    setTextMaterial(null);
    if (!initialMaterial || !data) return;
    const m = data.materials.find((m) => m.id === initialMaterial && m.status === 'published');
    if (m) {
      if (m.file_id && canReadDocument(m.mime_type || '')) setReader(m);
      else setTextMaterial(m);
    }
  }, [data, initialMaterial]);
  const tabsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = tabsRef.current,
      active = nav?.querySelector<HTMLElement>('[aria-current=page]');
    if (nav && active)
      nav.scrollLeft = Math.max(0, active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2);
  }, [tab]);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const draft = useDraft<{
    id: string | null;
    version: number | null;
    title: string;
    description: string;
    position: number;
  }>((api.demo ? 'demo:' : 'live:') + userId + ':course-topic:' + course.id, {
    id: null,
    version: null,
    title: '',
    description: '',
    position: 1,
  });
  useEffect(() => {
    let alive = true;
    setBusy(true);
    loadCourseData(api, course)
      .then((d) => {
        if (alive) {
          if (!allowManagement) d.materials = d.materials.filter((m) => m.status === 'published');
          setData(d);
          setSelectedTopic((current) =>
            d.workspace?.topics.some((t) => t.id === current) ? current : '',
          );
        }
      })
      .catch(() => {
        if (alive) {
          setData(null);
          setError('Не удалось открыть дисциплину. Попробуйте обновить.');
        }
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [api, course.id, revision, allowManagement]);
  async function action(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      if (active.current) {
        setMessage(ok);
        setRevision((n) => n + 1);
      }
    } catch (e) {
      if (active.current) {
        setError(e instanceof Error ? e.message : 'Действие не выполнено.');
        setRevision((n) => n + 1);
      }
    } finally {
      if (active.current) setBusy(false);
    }
  }
  function navigate(next: Tab) {
    if (!mayLeaveDrafts()) return;
    if (onLocation) {
      onLocation(next);
      return;
    }
    setRevision((n) => n + 1);
    setTab(next);
    setMessage('');
    setQuery('');
    setOffset(0);
    setEditingMaterials(false);
  }
  function openMaterial(m: CourseMaterial) {
    if (!mayLeaveDrafts()) return;
    if (onLocation) {
      onLocation(tab, undefined, m.id);
      return;
    }
    if (m.file_id && canReadDocument(m.mime_type || '')) setReader(m);
    else setTextMaterial(m);
  }
  function openTask(id: string) {
    if (!mayLeaveDrafts()) return;
    if (onLocation) {
      onLocation('assignment', id);
      return;
    }
    setSelectedTask(id);
    setTab('assignment');
  }
  const topics = data?.workspace?.topics || [],
    links = data?.workspace?.links || [],
    completed = data?.workspace?.completed || [];
  const matches = (value: string) =>
    value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const topicFor = (id: string, kind: 'material' | 'assignment') =>
    links.find((l) => l.source_id === id && l.source_kind === kind)?.topic_id || '';
  const filteredMaterials = (data?.materials || []).filter(
    (m) =>
      (tab !== 'lectures' || m.kind === 'lecture') &&
      (tab !== 'resources' || m.kind !== 'lecture') &&
      matches(m.title + ' ' + m.body + ' ' + (m.original_name || '')) &&
      (!selectedTopic || topicFor(m.id, 'material') === selectedTopic),
  );
  const visibleTopics = topics.filter((t) => !selectedTopic || t.id === selectedTopic);
  async function download(m: CourseMaterial) {
    await action(async () => {
      const blob = await api.downloadMaterial(m),
        url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = m.original_name || m.title;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'Файл передан браузеру.');
  }
  function materialRow(m: CourseMaterial) {
    return (
      <article className="course-resource" key={m.id}>
        <div>
          <span className="eyebrow">{kindLabels[m.kind]}</span>
          <h4>{m.title}</h4>
          {m.body && <p className="course-resource-body">{m.body}</p>}
          {m.original_name && <small>{m.original_name}</small>}
        </div>
        <div className="card-actions">
          {m.file_id && m.status === 'published' && (
            <>
              {canReadDocument(m.mime_type || '') && (
                <button onClick={() => openMaterial(m)} disabled={busy}>
                  Открыть файл
                </button>
              )}
              <button disabled={busy} onClick={() => void download(m)}>
                Скачать файл
              </button>
            </>
          )}
          {m.status !== 'published' && <span className="helper">Публикация не завершена</span>}
        </div>
        {allowManagement && data?.workspace?.canManage && m.can_manage && (
          <label className="course-link-control">
            Тема материала
            <select
              disabled={busy}
              value={topicFor(m.id, 'material')}
              onChange={(e) =>
                void action(
                  () => api.linkCourseTopic(course.id, m.id, 'material', e.target.value || null),
                  'Привязка сохранена.',
                )
              }
            >
              <option value="">Без темы</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </article>
    );
  }
  function taskRow(a: NonNullable<CourseData['assignments']>[number]) {
    const status = data ? assignmentStatus(data, a.id) : '',
      late =
        !!a.due_at &&
        Date.parse(a.due_at) < Date.now() &&
        ['not_submitted', 'returned'].includes(status);
    return (
      <article className="course-resource" key={a.id}>
        <div>
          <span className="eyebrow">Задание</span>
          <h4>{a.title}</h4>
          <p>{a.due_at ? 'Сдать до ' + when(a.due_at) : 'Без срока сдачи'}</p>
          {status && (
            <span className={'badge' + (late ? ' course-overdue' : '')}>
              {late ? 'Срок прошёл · ' : ''}
              {courseStatusLabels[status] || status}
            </span>
          )}
        </div>
        <button disabled={busy} onClick={() => openTask(a.id)}>
          Открыть задание
        </button>
        {allowManagement && data?.workspace?.canManage && data.canGrade && (
          <label className="course-link-control">
            Тема задания
            <select
              disabled={busy}
              value={topicFor(a.id, 'assignment')}
              onChange={(e) =>
                void action(
                  () => api.linkCourseTopic(course.id, a.id, 'assignment', e.target.value || null),
                  'Привязка сохранена.',
                )
              }
            >
              <option value="">Без темы</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </article>
    );
  }
  const sourceIds = data?.materials.map((m) => m.id) || [];
  return (
    <section className="course-workspace">
      <button
        onClick={() => {
          if (mayLeaveDrafts()) onClose();
        }}
      >
        <StudyIcon name="back" /> {teacherCourse ? 'К кабинету преподавателя' : 'К дисциплинам'}
      </button>
      <CourseCover
        course={course}
        groupName={groupName}
        teacher={!!teacherCourse}
        busy={busy}
        onRefresh={() => {
          if (mayLeaveDrafts()) setRevision((n) => n + 1);
        }}
      />
      <nav ref={tabsRef} className="course-tabs" aria-label="Разделы дисциплины">
        {Object.entries(tabs)
          .filter(([id]) => teacherCourse || id !== 'overview')
          .map(([id, title]) => (
            <button
              key={id}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => navigate(id as Tab)}
            >
              {title}
            </button>
          ))}
      </nav>
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
      {busy && <p role="status">Обновляем дисциплину…</p>}
      {data?.issues.length ? (
        <details className="course-issues">
          <summary>Некоторые разделы не загрузились ({data.issues.length})</summary>
          {data.issues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
          {data.needsUpdate && <p>Для сохранения тем требуется обновление базы v0.20.</p>}
        </details>
      ) : null}
      {tab === 'overview' && data && teacherCourse && (
        <section className="card teacher-course-start">
          <h3>Подготовка и проведение занятий</h3>
          <p>
            {teacherCourse.group_name} ·{' '}
            {teacherCourse.can_grade
              ? teacherCourse.pending + ' работ на проверке'
              : 'Доступ к заданиям закрыт'}
          </p>
          <div className="card-actions">
            <button className="primary" onClick={() => navigate('materials')}>
              Лекции и материалы
            </button>
            <button onClick={() => navigate('topics')}>Учебные темы</button>
            {teacherCourse.can_grade && (
              <button onClick={() => navigate('assignment')}>Задания и журнал</button>
            )}
            <button onClick={() => navigate('announcements')}>Объявление студентам</button>
          </div>
        </section>
      )}
      {['topics', 'materials', 'lectures', 'resources'].includes(tab) && data && (
        <>
          <div className="library-heading">
            <div>
              <h3>
                {tab === 'topics'
                  ? 'Учебные темы'
                  : tab === 'lectures'
                    ? 'Лекции'
                    : tab === 'resources'
                      ? 'Дополнительные материалы'
                      : 'Книги и материалы'}
              </h3>
              <p>
                {tab === 'topics'
                  ? 'Лекции, чтение и задания собраны по темам.'
                  : tab === 'lectures'
                    ? 'Учебные лекции и конспекты.'
                    : tab === 'resources'
                      ? 'Презентации, книги и дополнительные файлы.'
                      : 'Все доступные файлы и тексты этой дисциплины.'}
              </p>
            </div>
            <div className="card-actions">
              {allowManagement && data.workspace?.canManage && tab === 'topics' && (
                <button onClick={() => setManage(!manage)}>
                  {manage ? 'Скрыть управление темами' : 'Управлять темами'}
                </button>
              )}
              {allowManagement &&
              (data.materials.some((m) => m.can_manage) || data.workspace?.canManage) ? (
                <button
                  onClick={() => {
                    if (mayLeaveDrafts()) {
                      setEditingMaterials(!editingMaterials);
                      setRevision((n) => n + 1);
                    }
                  }}
                >
                  {editingMaterials ? 'Закрыть публикацию' : 'Опубликовать материал'}
                </button>
              ) : null}
            </div>
          </div>
          {editingMaterials && (
            <CourseMaterialsPanel
              api={api}
              course={course}
              onChanged={() => setRevision((n) => n + 1)}
              initialKind={
                tab === 'lectures'
                  ? 'lecture'
                  : tab === 'resources'
                    ? 'material'
                    : initialKind === 'assignment'
                      ? undefined
                      : initialKind
              }
              onClose={() => {
                setEditingMaterials(false);
                setRevision((n) => n + 1);
              }}
            />
          )}
          {manage && tab === 'topics' && allowManagement && data.workspace?.canManage && (
            <section className="card course-topic-editor">
              <h3>{draft.value.id ? 'Редактирование темы' : 'Новая тема'}</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(async () => {
                    const d = draft.value;
                    await api.saveCourseTopic(
                      course.id,
                      d.title,
                      d.description,
                      d.position,
                      d.id,
                      d.version,
                    );
                    draft.clear();
                  }, 'Тема сохранена.');
                }}
              >
                <label>
                  Название темы
                  <input
                    required
                    maxLength={200}
                    value={draft.value.title}
                    onChange={(e) => draft.setValue((v) => ({ ...v, title: e.target.value }))}
                  />
                </label>
                <label>
                  Описание темы
                  <textarea
                    maxLength={5000}
                    value={draft.value.description}
                    onChange={(e) => draft.setValue((v) => ({ ...v, description: e.target.value }))}
                  />
                </label>
                <label>
                  Порядок темы
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    required
                    value={draft.value.position}
                    onChange={(e) =>
                      draft.setValue((v) => ({ ...v, position: Number(e.target.value) }))
                    }
                  />
                </label>
                <div className="card-actions">
                  <button className="primary" disabled={busy}>
                    Сохранить тему
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      draft.clear();
                      setManage(false);
                    }}
                  >
                    Отмена
                  </button>
                </div>
              </form>
              <p className="helper">
                Материалы и задания привязываются к теме в списке ниже. Черновик сохраняется в этой
                вкладке.
              </p>
            </section>
          )}
          <div className="course-filters">
            <label>
              Поиск в дисциплине
              <input
                type="search"
                maxLength={200}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOffset(0);
                }}
                placeholder="Название, текст или имя файла"
              />
            </label>
            <label>
              Тема
              <select
                value={selectedTopic}
                onChange={(e) => {
                  setSelectedTopic(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">Все темы</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {tab === 'topics' && !editingMaterials && (
            <>
              {!topics.length && (
                <p className="card empty">
                  Темы пока не созданы. Все опубликованные материалы доступны ниже.
                </p>
              )}
              {visibleTopics.map((t) => {
                const materials = filteredMaterials.filter(
                    (m) => topicFor(m.id, 'material') === t.id,
                  ),
                  tasks = data.assignments.filter(
                    (a) =>
                      topicFor(a.id, 'assignment') === t.id &&
                      matches(a.title + ' ' + a.description),
                  );
                if (
                  query &&
                  !materials.length &&
                  !tasks.length &&
                  !matches(t.title + ' ' + t.description)
                )
                  return null;
                return (
                  <section className="card course-topic" key={t.id}>
                    <div className="course-topic-heading">
                      <div>
                        <span className="eyebrow">ТЕМА {t.position}</span>
                        <h3>{t.title}</h3>
                        {t.description && <p>{t.description}</p>}
                      </div>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={completed.includes(t.id)}
                          disabled={busy}
                          onChange={(e) =>
                            void action(
                              () => api.completeCourseTopic(t.id, e.target.checked),
                              'Личная отметка сохранена.',
                            )
                          }
                        />
                        Изучено
                      </label>
                    </div>
                    {materials.map(materialRow)}
                    {tasks.map(taskRow)}
                    {!materials.length && !tasks.length && (
                      <p className="helper">
                        {query
                          ? 'Нет совпадений внутри темы.'
                          : 'Материалы и задания появятся после публикации.'}
                      </p>
                    )}
                    {manage && allowManagement && data.workspace?.canManage && (
                      <div className="card-actions">
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (!draft.changed || mayLeaveDrafts())
                              draft.setValue({
                                id: t.id,
                                version: t.version,
                                title: t.title,
                                description: t.description,
                                position: t.position,
                              });
                          }}
                        >
                          Изменить тему
                        </button>
                        <button disabled={busy} onClick={() => setDeleting(t.id)}>
                          Удалить тему
                        </button>
                        {deleting === t.id && (
                          <>
                            <span>Материалы и задания останутся без темы.</span>
                            <button
                              className="danger"
                              disabled={busy}
                              onClick={() =>
                                void action(async () => {
                                  await api.deleteCourseTopic(t.id, t.version);
                                  setDeleting('');
                                  if (draft.value.id === t.id) draft.clear();
                                }, 'Тема удалена. Материалы сохранены.')
                              }
                            >
                              Подтвердить удаление темы
                            </button>
                            <button onClick={() => setDeleting('')}>Отмена удаления</button>
                          </>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
              {!selectedTopic && (
                <section className="card course-topic">
                  <h3>Без темы</h3>
                  {filteredMaterials
                    .filter((m) => !topicFor(m.id, 'material'))
                    .slice(offset, offset + 24)
                    .map(materialRow)}
                  {data.assignments
                    .filter(
                      (a) =>
                        !topicFor(a.id, 'assignment') && matches(a.title + ' ' + a.description),
                    )
                    .map(taskRow)}
                  {!filteredMaterials.some((m) => !topicFor(m.id, 'material')) &&
                    !data.assignments.some(
                      (a) =>
                        !topicFor(a.id, 'assignment') && matches(a.title + ' ' + a.description),
                    ) && <p className="helper">Все материалы распределены по темам.</p>}
                  {filteredMaterials.filter((m) => !topicFor(m.id, 'material')).length > 24 && (
                    <div className="pagination">
                      <button
                        disabled={!offset}
                        onClick={() => setOffset((n) => Math.max(0, n - 24))}
                      >
                        Назад
                      </button>
                      <span>Страница {offset / 24 + 1}</span>
                      <button
                        disabled={
                          offset + 24 >=
                          filteredMaterials.filter((m) => !topicFor(m.id, 'material')).length
                        }
                        onClick={() => setOffset((n) => n + 24)}
                      >
                        Далее
                      </button>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
          {['materials', 'lectures', 'resources'].includes(tab) && !editingMaterials && (
            <>
              <div className="course-book-grid">
                {filteredMaterials.slice(offset, offset + 24).map((m) => {
                  const item: LibraryItem = {
                    ...m,
                    author_id: '',
                    source_group_id: course.group_id,
                    group_name: groupName,
                    status: m.status === 'published' ? 'published' : 'pending',
                    storage_path: m.storage_path || '',
                    original_name: m.original_name || '',
                    mime_type: m.mime_type || 'text/plain',
                    size_bytes: m.size_bytes || 0,
                    can_manage: m.can_manage,
                  };
                  return (
                    <article className="card course-book" key={m.id}>
                      <BookCover item={item} onOpen={() => openMaterial(m)} disabled={busy} />
                      <span className="eyebrow">{kindLabels[m.kind]}</span>
                      <h4>{m.title}</h4>
                      <small>
                        {m.author_name}
                        {topicFor(m.id, 'material')
                          ? ' · ' + topics.find((t) => t.id === topicFor(m.id, 'material'))?.title
                          : ''}
                      </small>
                      <button disabled={busy} onClick={() => openMaterial(m)}>
                        {m.file_id && canReadDocument(m.mime_type || '')
                          ? 'Открыть файл'
                          : 'Читать материал'}
                      </button>
                    </article>
                  );
                })}
              </div>
              {!filteredMaterials.length && (
                <p className="card empty">
                  {query || selectedTopic ? 'Материалы не найдены.' : 'Материалов пока нет.'}
                </p>
              )}
              {filteredMaterials.length > 24 && (
                <div className="pagination">
                  <button disabled={!offset} onClick={() => setOffset((n) => Math.max(0, n - 24))}>
                    Назад
                  </button>
                  <span>Страница {offset / 24 + 1}</span>
                  <button
                    disabled={offset + 24 >= filteredMaterials.length}
                    onClick={() => setOffset((n) => n + 24)}
                  >
                    Далее
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
      {tab === 'assignment' &&
        (teacherCourse ? (
          <TeacherAssignments
            key={selectedTask}
            api={api}
            courses={[teacherCourse]}
            user={userId}
            initialCourse={course.id}
            initialAssignment={selectedTask}
          />
        ) : (
          <>
            {data && (
              <div className="course-task-list">{data.assignments.slice(0, 24).map(taskRow)}</div>
            )}
            <AssignmentsPanel
              key={selectedTask}
              api={api}
              course={course}
              initialAssignment={selectedTask}
              onSelection={
                onLocation ? (id) => onLocation('assignment', id || undefined) : undefined
              }
              studyOnly={!allowManagement}
            />
          </>
        ))}
      {tab === 'notes' && (
        <NotesPanel
          key={course.id + userId}
          api={api}
          userId={userId}
          course={course}
          topics={topics}
          sourceIds={sourceIds}
        />
      )}
      {tab === 'announcements' && snapshot && (
        <BoardPanel
          api={api}
          snapshot={snapshot}
          kind="announcement"
          courseFilter={course.id}
          allowManagement={allowManagement}
        />
      )}
      {textMaterial && (
        <article
          className="card"
          tabIndex={-1}
          ref={(node) => {
            node?.focus();
          }}
        >
          <h3>{textMaterial.title}</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{textMaterial.body}</p>
          <div className="card-actions">
            {textMaterial.file_id && (
              <button disabled={busy} onClick={() => void download(textMaterial)}>
                Скачать файл
              </button>
            )}
            <button onClick={() => (onLocation ? onLocation(tab) : setTextMaterial(null))}>
              Закрыть
            </button>
          </div>
        </article>
      )}
      {initialMaterial && data && !reader && !textMaterial && !busy && (
        <p className="notice error" role="alert">
          Файл недоступен: он удалён или у вас нет доступа.
          <button onClick={() => onLocation?.(tab)}>Закрыть просмотр</button>
        </p>
      )}
      {reader && (
        <CourseReader
          api={api}
          material={reader}
          onClose={() => {
            if (onLocation) onLocation(tab);
            else setReader(null);
            setRevision((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}
