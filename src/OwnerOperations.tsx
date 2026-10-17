import { useEffect, useRef, useState } from 'react';
import { loadOwnerOperations, type OwnerOperations as Data } from './owner-operations';
import { sizeLabel } from './files';
import type { Gateway, Snapshot, GroupRequest } from './types';
import type { OwnerSection } from './OwnerAdminPanel';
export function OwnerOperations({
  api,
  snapshot,
  queue = false,
  onChanged,
  onManage,
}: {
  api: Gateway;
  snapshot: Snapshot;
  queue?: boolean;
  onChanged?: () => Promise<void>;
  onManage?: (section: OwnerSection) => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [refreshWarning, setRefreshWarning] = useState(''),
    [revision, setRevision] = useState(0),
    [group, setGroup] = useState(''),
    [offset, setOffset] = useState(0);
  const writing = useRef(false);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    setData(null);
    loadOwnerOperations(api, snapshot, !queue)
      .then((next) => {
        if (active) setData(next);
      })
      .catch(() => {
        if (active) setError('Не удалось проверить состояние проекта.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [api, snapshot, revision, queue]);
  useEffect(() => setOffset(0), [group]);
  const requests = (data?.requests || []).filter((r) => !group || r.group_id === group),
    visible = requests.slice(offset, offset + 24);
  useEffect(() => {
    setOffset((old) => Math.min(old, Math.max(0, Math.floor((requests.length - 1) / 24) * 24)));
  }, [requests.length]);
  async function resolve(request: GroupRequest, approve: boolean) {
    if (
      writing.current ||
      !window.confirm(
        (approve ? 'Принять в группу' : 'Отклонить заявку') +
          ': ' +
          request.full_name +
          ' · ' +
          (snapshot.groups.find((g) => g.id === request.group_id)?.name || 'Группа') +
          '?',
      )
    )
      return;
    writing.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    setRefreshWarning('');
    try {
      await api.resolveGroupRequest(request.user_id, request.group_id, approve);
      setMessage(approve ? 'Студент принят в группу.' : 'Заявка отклонена.');
      try {
        await onChanged?.();
      } catch {
        setRefreshWarning(
          'Заявка обработана, но список пользователей не обновился. Обновите страницу.',
        );
      }
      setRevision((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Заявка не обработана.');
      setBusy(false);
    } finally {
      writing.current = false;
    }
  }
  if (!snapshot.owner) return null;
  const now = Date.now(),
    activeInvites = data?.invitations?.filter(
      (i) => !i.revoked && Date.parse(i.expires_at) > now && i.used_count < i.max_uses,
    ).length;
  return (
    <section
      className="card owner-operations"
      aria-label={queue ? 'Все заявки в группы' : 'Состояние проекта'}
    >
      <div className="section-heading">
        <h2>{queue ? 'Заявки во все группы' : 'Состояние проекта'}</h2>
        <button disabled={busy} onClick={() => setRevision((n) => n + 1)}>
          Обновить состояние
        </button>
      </div>
      {busy && <p role="status">Проверяем данные…</p>}
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
      {refreshWarning && (
        <p className="notice error" role="alert">
          {refreshWarning}
        </p>
      )}
      {!!data?.issues.length && (
        <div className="notice error" role="alert">
          {data.issues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
        </div>
      )}
      {!queue && data && (
        <div className="owner-health-grid">
          <button onClick={() => onManage?.('requests')}>
            <span>Ожидают вступления</span>
            <b>{data.requestsComplete ? data.requests.length : 'Не все проверены'}</b>
            <small>
              {data.requestsComplete
                ? 'Заявки из всех групп'
                : 'Доступны заявки: ' + data.requests.length}
            </small>
          </button>
          <button onClick={() => onManage?.('invitations')}>
            <span>Действующие приглашения</span>
            <b>{activeInvites ?? 'Нет данных'}</b>
            <small>Не истекли и не исчерпаны</small>
          </button>
          <div className="owner-storage">
            <span>Файловое хранилище</span>
            {data.quota ? (
              <>
                <b>
                  {sizeLabel(Number(data.quota.used_bytes))}{' '}
                  <small>из {sizeLabel(Number(data.quota.budget_bytes))}</small>
                </b>
                <progress
                  aria-label="Использование хранилища"
                  value={Number(data.quota.used_bytes)}
                  max={Number(data.quota.budget_bytes)}
                />
                {Number(data.quota.used_bytes) >= Number(data.quota.budget_bytes) * 0.85 && (
                  <p className="owner-warning">Место заканчивается</p>
                )}
                <button onClick={() => onManage?.('library')}>Управлять публикациями</button>
              </>
            ) : (
              <b>Нет данных</b>
            )}
          </div>
        </div>
      )}
      {queue && (
        <>
          <label className="owner-queue-filter">
            Группа заявки
            <select value={group} onChange={(e) => setGroup(e.target.value)} disabled={busy}>
              <option value="">Все группы</option>
              {snapshot.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          {data && (
            <p>
              {data.requestsComplete ? 'Ожидают решения: ' : 'Загружено заявок: '}
              {requests.length}
            </p>
          )}
          <div className="owner-request-list">
            {visible.map((request) => {
              const target = snapshot.groups.find((g) => g.id === request.group_id),
                profile = snapshot.profiles.find((p) => p.id === request.user_id);
              return (
                <article key={request.user_id + request.group_id}>
                  <div>
                    <h3>{request.full_name}</h3>
                    <p>
                      {target?.name || 'Группа недоступна'} ·{' '}
                      {new Date(request.created_at).toLocaleDateString('ru-RU', {
                        timeZone: 'Asia/Bishkek',
                      })}
                    </p>
                    {target?.blocked && <p className="owner-warning">Доступ к группе закрыт</p>}
                    {profile?.blocked && <p className="owner-warning">Аккаунт заблокирован</p>}
                  </div>
                  <div className="card-actions">
                    <button
                      className="primary"
                      disabled={busy || !!target?.blocked || !!profile?.blocked}
                      onClick={() => void resolve(request, true)}
                    >
                      Принять студента
                    </button>
                    <button disabled={busy} onClick={() => void resolve(request, false)}>
                      Отклонить заявку
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {data?.requestsComplete && !requests.length && <p>Ожидающих заявок нет.</p>}
          {requests.length > 24 && (
            <div className="pagination">
              <button
                disabled={busy || !offset}
                onClick={() => setOffset((n) => Math.max(0, n - 24))}
              >
                Предыдущие заявки
              </button>
              <span>Страница {offset / 24 + 1}</span>
              <button
                disabled={busy || offset + 24 >= requests.length}
                onClick={() => setOffset((n) => n + 24)}
              >
                Следующие заявки
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
