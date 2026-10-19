import { FilePicker } from './FilePicker';
import { registerNavigationGuard } from './drafts';
import React, { useEffect, useRef, useState } from 'react';
import { avatarFile, type AccountDetails } from './account';
import type { Gateway, Snapshot } from './types';
export function ProfilePanel({
  api,
  snapshot,
  onSaved,
  onShelf,
}: {
  api: Gateway;
  snapshot: Snapshot;
  onSaved: () => Promise<void>;
  onShelf: () => void;
}) {
  const [tab, setTab] = useState('profile'),
    [details, setDetails] = useState<AccountDetails | null>(null),
    [name, setName] = useState(snapshot.me.full_name),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [baseline, setBaseline] = useState(''),
    [loadError, setLoadError] = useState(false),
    [revision, retry] = useState(0);
  const pending = useRef(false);
  const changed = !!details && !!baseline && JSON.stringify({ name, details }) !== baseline;
  const guardState = useRef({ busy, changed });
  guardState.current = { busy, changed };
  useEffect(() => {
    const guard = () => {
      if (guardState.current.busy) {
        window.alert('Дождитесь завершения изменения профиля.');
        return false;
      }
      return (
        !guardState.current.changed ||
        window.confirm('Изменения профиля не сохранены. Всё равно уйти?')
      );
    };
    return registerNavigationGuard(guard);
  }, []);
  useEffect(() => {
    if (!busy && !changed) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [busy, changed]);
  useEffect(() => {
    let active = true;
    setLoadError(false);
    setError('');
    api
      .account()
      .then((d) => {
        if (active) {
          setDetails(d);
          setName(snapshot.me.full_name);
          setBaseline(JSON.stringify({ name: snapshot.me.full_name, details: d }));
        }
      })
      .catch((e) => {
        if (active) {
          setLoadError(true);
          setError(e instanceof Error ? e.message : 'Не удалось загрузить профиль.');
        }
      });
    return () => {
      active = false;
    };
  }, [api, snapshot.me.id, revision]);
  async function run(work: () => Promise<void>, success: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work();
      setMessage(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const memberships = snapshot.memberships.filter((m) => m.user_id === snapshot.me.id && m.active);
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();
  return (
    <section className="profile-panel" aria-label="Личный профиль">
      <nav className="profile-tabs" aria-label="Разделы профиля">
        {[
          ['profile', 'Профиль'],
          ['settings', 'Настройки'],
          ['security', 'Безопасность'],
        ].map(([id, title]) => (
          <button
            key={id}
            disabled={busy}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => {
              setTab(id);
              setError('');
              setMessage('');
            }}
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
      {tab === 'profile' && (
        <div className="profile-columns">
          <section className="card">
            <h2>Личные данные</h2>
            {!details ? (
              loadError ? (
                <button onClick={() => retry((n) => n + 1)}>Повторить загрузку профиля</button>
              ) : (
                <p role="status">Загрузка профиля…</p>
              )
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await api.saveAccount(name, details);
                    setBaseline(JSON.stringify({ name, details }));
                    await onSaved();
                  }, 'Профиль сохранён.');
                }}
              >
                <div className="profile-photo">
                  {details.avatar ? (
                    <img src={details.avatar} alt="Фото профиля" />
                  ) : (
                    <span aria-label="Инициалы">{initials || 'S'}</span>
                  )}
                  <div>
                    <FilePicker
                      label="Фото профиля"
                      actionLabel="Выбрать фото"
                      emptyLabel={details.avatar ? 'Фото выбрано' : 'Фото не выбрано'}
                      file={null}
                      accept="image/png,image/jpeg,image/webp"
                      disabled={busy}
                      onChange={(file) => {
                        if (file)
                          void run(async () => {
                            const avatar = await avatarFile(file);
                            setDetails((d) => (d ? { ...d, avatar } : d));
                          }, 'Фото подготовлено. Сохраните профиль.');
                      }}
                    />
                    {details.avatar && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setDetails({ ...details, avatar: '' })}
                      >
                        Удалить фото
                      </button>
                    )}
                  </div>
                </div>
                <label>
                  Имя и фамилия
                  <input
                    required
                    maxLength={150}
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                  />
                </label>
                {(
                  [
                    ['university', 'Университет'],
                    ['faculty', 'Факультет'],
                    ['specialty', 'Специальность'],
                    ['year', 'Курс'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      maxLength={150}
                      value={details[key]}
                      disabled={busy}
                      onChange={(e) => setDetails({ ...details, [key]: e.target.value })}
                    />
                  </label>
                ))}
                <p className="helper">
                  Учебные сведения необязательны. Их заполнение не меняет доступ к группам.
                </p>
                <button className="primary" disabled={busy}>
                  {busy ? 'Сохранение…' : 'Сохранить профиль'}
                </button>
              </form>
            )}
          </section>
          <section className="card">
            <h2>Группы и полномочия</h2>
            {snapshot.owner && (
              <p>
                <b>Владелец проекта</b>
              </p>
            )}
            {memberships.map((m) => (
              <p key={m.group_id + m.role}>
                <b>
                  {m.role === 'leader'
                    ? 'Студент · Староста'
                    : m.role === 'teacher'
                      ? 'Преподаватель'
                      : 'Студент'}
                </b>
                <br />
                {snapshot.groups.find((g) => g.id === m.group_id)?.name || 'Группа недоступна'}
              </p>
            ))}
            {!memberships.length && !snapshot.owner && <p>Вы пока не присоединились к группе.</p>}
            <p className="helper">
              Группа и полномочия назначаются через приглашения и администрацию.
            </p>
            <h3>Почта</h3>
            {api.demo ? (
              <p>Демонстрационный аккаунт</p>
            ) : (
              details && (
                <>
                  <p>{details.email || 'Почта не указана'}</p>
                  <p>{details.confirmed ? 'Почта подтверждена' : 'Почта не подтверждена'}</p>
                </>
              )
            )}
          </section>
        </div>
      )}
      {tab === 'settings' && (
        <section className="card">
          <h2>Комфортное чтение и работа без сети</h2>
          <p>
            Размер текста, фон, шрифт и интервал настраиваются в читалке. Голос и скорость — в
            инструментах озвучивания.
          </p>
          <p>
            Настройки чтения сохраняются на этом устройстве. Сохранённые материалы доступны отдельно
            для каждого аккаунта.
          </p>
          <button onClick={onShelf}>Управлять сохранёнными материалами</button>
        </section>
      )}
      {tab === 'security' && (
        <section className="card">
          <h2>Сменить пароль</h2>
          {api.demo ? (
            <p>Смена пароля доступна в настоящем аккаунте.</p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  d = new FormData(form);
                void run(async () => {
                  const next = String(d.get('next'));
                  if (next !== d.get('repeat')) throw Error('Новые пароли не совпадают.');
                  await api.changePassword(String(d.get('current')), next);
                  form.reset();
                }, 'Пароль изменён.');
              }}
            >
              <label>
                Текущий пароль
                <input
                  type="password"
                  name="current"
                  required
                  autoComplete="current-password"
                  disabled={busy}
                />
              </label>
              <label>
                Новый пароль
                <input
                  type="password"
                  name="next"
                  required
                  minLength={10}
                  maxLength={128}
                  autoComplete="new-password"
                  disabled={busy}
                />
              </label>
              <label>
                Повторите новый пароль
                <input
                  type="password"
                  name="repeat"
                  required
                  minLength={10}
                  maxLength={128}
                  autoComplete="new-password"
                  disabled={busy}
                />
              </label>
              <button className="primary" disabled={busy}>
                {busy ? 'Изменение…' : 'Изменить пароль'}
              </button>
            </form>
          )}
        </section>
      )}
    </section>
  );
}
