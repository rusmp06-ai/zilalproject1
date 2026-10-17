import { CloseButton } from './CloseButton';
import { publishRecoverable } from './intake-recovery';
import { MaterialIntake } from './MaterialIntake';
import { PdfOptimization } from './PdfOptimization';
import { StudyIcon } from './StudyIcon';
import { CourseReader } from './CourseReader';
import { canReadDocument } from './reader-tools';
import { AssignmentsPanel } from './AssignmentsPanel';
import { useEffect, useState } from 'react';
import type { Gateway, Course, CourseMaterial, MaterialKind } from './types';
import { FILE_ACCEPT, sizeLabel } from './files';
const labels = { lecture: 'Лекции', presentation: 'Презентации', material: 'Материалы' };
export function CourseMaterialsPanel({
  api,
  course,
  onClose,
  initialKind = 'lecture',
  initialAssignment = '',
  onChanged,
}: {
  api: Gateway;
  course: Course;
  onClose: () => void;
  initialKind?: MaterialKind | 'assignment';
  initialAssignment?: string;
  onChanged?: () => void;
}) {
  const [optimizing, setOptimizing] = useState(false);
  const [kind, setKind] = useState<MaterialKind | 'assignment'>(initialKind),
    [offset, setOffset] = useState(0),
    [items, setItems] = useState<CourseMaterial[]>([]),
    [canManage, setCanManage] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [file, setFile] = useState<File | null>(null),
    [fileKey, setFileKey] = useState(0),
    [editing, setEditing] = useState<string | null>(null),
    [confirm, setConfirm] = useState<string | null>(null),
    [preview, setPreview] = useState<{ item: CourseMaterial; url?: string; text?: string } | null>(
      null,
    );
  async function load() {
    if (kind === 'assignment') return;
    const p = await api.courseMaterials(course.id, kind, offset);
    setItems(p.items);
    setCanManage(p.canManage);
  }
  useEffect(() => {
    if (kind === 'assignment') {
      setCanManage(false);
      setBusy(false);
      return;
    }
    let alive = true;
    setBusy(true);
    setItems([]);
    setCanManage(false);
    setError('');
    setPreview(null);
    api
      .courseMaterials(course.id, kind, offset)
      .then((p) => {
        if (alive) {
          setItems(p.items);
          setCanManage(p.canManage);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [api, course.id, kind, offset]);
  useEffect(
    () => () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  async function action(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await load();
      setMessage(ok);
      if (ok) onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Действие не выполнено.');
      try {
        await load();
      } catch {
        setItems([]);
        setCanManage(false);
      }
    } finally {
      setBusy(false);
    }
  }
  async function open(item: CourseMaterial, download: boolean) {
    await action(async () => {
      if (!download && canReadDocument(item.mime_type || '')) {
        setPreview({ item });
        return;
      }
      const blob = await api.downloadMaterial(item);
      if (download) {
        const url = URL.createObjectURL(blob),
          a = document.createElement('a');
        a.href = url;
        a.download = item.original_name || 'document';
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else if (item.mime_type === 'text/plain') setPreview({ item, text: await blob.text() });
      else setPreview({ item, url: URL.createObjectURL(blob) });
    }, '');
  }
  function clear() {
    setTitle('');
    setBody('');
    setFile(null);
    setFileKey((k) => k + 1);
    setEditing(null);
  }
  if (kind === 'assignment')
    return (
      <section>
        <div className="card-actions" style={{ marginBottom: 22 }}>
          <button onClick={() => setKind('lecture')}>
            <StudyIcon name="back" /> К материалам курса
          </button>
          <button onClick={onClose}>Закрыть публикацию</button>
        </div>
        <AssignmentsPanel api={api} course={course} initialAssignment={initialAssignment} />
      </section>
    );
  return (
    <section>
      <div className="library-heading">
        <div>
          <button onClick={onClose}>
            <StudyIcon name="back" /> Закрыть публикацию
          </button>
          <h2 style={{ marginTop: 18 }}>Публикация и управление материалами</h2>
          <p>Материалы доступны участникам этой дисциплины.</p>
        </div>
        <button disabled={busy} onClick={() => void action(async () => {}, 'Список обновлён.')}>
          Обновить материалы
        </button>
      </div>
      <div className="card-actions" style={{ marginBottom: 22 }}>
        {Object.entries({ ...labels, assignment: 'Задания' }).map(([id, name]) => (
          <button
            key={id}
            disabled={busy}
            className={kind === id ? 'primary' : ''}
            onClick={() => {
              setKind(id as MaterialKind | 'assignment');
              setOffset(0);
              clear();
              setMessage('');
            }}
          >
            {name}
          </button>
        ))}
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="notice success" role="status">
          {message}
        </div>
      )}
      {canManage && (
        <MaterialIntake
          api={api}
          initialCourse={course.id}
          onPublished={() => void load().catch((e) => setError(e.message))}
        />
      )}
      {canManage && (
        <section className="card upload-panel">
          <h3>{editing ? 'Изменить материал' : 'Новый материал'}</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                if (optimizing) throw Error('Дождитесь завершения оптимизации.');
                if (file && !editing)
                  await publishRecoverable(
                    api,
                    {
                      request: crypto.randomUUID(),
                      kind,
                      course: course.id,
                      group: course.group_id,
                      title: title.trim(),
                      description: body,
                      due: null,
                      max: 100,
                      late: false,
                    },
                    file,
                  );
                else await api.saveMaterial(course.id, kind, title, body, file, editing);
                clear();
              }, 'Материал сохранён.');
            }}
          >
            <label>
              Название
              <input
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Текст или описание
              <textarea maxLength={50000} value={body} onChange={(e) => setBody(e.target.value)} />
            </label>
            {!editing && (
              <label>
                Файл — необязательно
                <input
                  key={fileKey}
                  type="file"
                  accept={FILE_ACCEPT}
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </label>
            )}
            {!editing && (
              <PdfOptimization
                file={file}
                onChange={setFile}
                onBusy={setOptimizing}
                disabled={busy}
              />
            )}
            <p className="helper">
              Можно опубликовать текст или приложить файл до 10 МБ. Замена файла выполняется
              созданием нового материала.
            </p>
            <div className="card-actions">
              <button className="primary" disabled={busy || optimizing}>
                {editing ? 'Сохранить изменения' : 'Опубликовать'}
              </button>
              {editing && (
                <button type="button" onClick={clear}>
                  Отмена
                </button>
              )}
            </div>
          </form>
        </section>
      )}
      <div className="library-grid">
        {items.map((i) => (
          <article className="card library-card" key={i.id}>
            <h3>{i.title}</h3>
            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{i.body}</p>
            <div className="library-author">
              <span>{i.author_name}</span>
              <span>{new Date(i.created_at).toLocaleDateString('ru-RU')}</span>
            </div>
            {i.file_id && (
              <p className="filename">
                {i.original_name} · {sizeLabel(Number(i.size_bytes))}
              </p>
            )}
            {i.status !== 'published' && (
              <div className="notice error">
                Загрузка или удаление не завершены. Удалите материал перед повторной попыткой.
              </div>
            )}
            <div className="card-actions">
              {i.file_id && i.status === 'published' && (
                <>
                  {(canReadDocument(i.mime_type || '') || i.mime_type?.startsWith('image/')) && (
                    <button disabled={busy} onClick={() => void open(i, false)}>
                      Открыть файл
                    </button>
                  )}
                  <button disabled={busy} onClick={() => void open(i, true)}>
                    Скачать файл
                  </button>
                </>
              )}
              {i.can_manage && (
                <>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setEditing(i.id);
                      setTitle(i.title);
                      setBody(i.body);
                      setFile(null);
                    }}
                  >
                    Изменить
                  </button>
                  <button className="danger" disabled={busy} onClick={() => setConfirm(i.id)}>
                    Удалить
                  </button>
                </>
              )}
            </div>
            {confirm === i.id && (
              <div className="delete-confirm">
                <p>Удалить «{i.title}»?</p>
                <button
                  disabled={busy}
                  className="danger"
                  onClick={() =>
                    void action(async () => {
                      await api.deleteMaterial(i.id);
                      setConfirm(null);
                      if (editing === i.id) clear();
                      if (preview?.item.id === i.id) setPreview(null);
                    }, 'Материал удалён.')
                  }
                >
                  Подтвердить удаление
                </button>
                <button disabled={busy} onClick={() => setConfirm(null)}>
                  Отмена
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {!busy && !error && !items.length && (
        <div className="card empty">В этом разделе пока нет материалов.</div>
      )}
      <div className="pagination">
        <button
          disabled={busy || offset === 0}
          onClick={() => setOffset((n) => Math.max(0, n - 50))}
        >
          Назад
        </button>
        <span>Страница {offset / 50 + 1}</span>
        <button disabled={busy || items.length < 50} onClick={() => setOffset((n) => n + 50)}>
          Далее
        </button>
      </div>
      {preview && canReadDocument(preview.item.mime_type || '') ? (
        <CourseReader
          key={preview.item.id}
          api={api}
          material={preview.item}
          onClose={() => setPreview(null)}
        />
      ) : (
        preview && (
          <section className="card" style={{ marginTop: 25 }}>
            <div className="library-heading">
              <h3>{preview.item.title}</h3>
              <CloseButton label="Закрыть просмотр" onClick={() => setPreview(null)} />
            </div>
            {preview.text !== undefined ? (
              <pre style={{ whiteSpace: 'pre-wrap' }}>{preview.text}</pre>
            ) : preview.item.mime_type === 'application/pdf' ? (
              <iframe
                title={preview.item.title}
                src={preview.url}
                style={{ width: '100%', height: '60vh', border: 0 }}
              />
            ) : (
              <img alt={preview.item.title} src={preview.url} style={{ maxWidth: '100%' }} />
            )}
          </section>
        )
      )}
    </section>
  );
}
