import { useEffect, useState } from 'react';
import type { Gateway, GroupRequest } from './types';
export function GroupRequests({
  api,
  group,
  onChanged,
  onPending,
  groups = [],
}: {
  api: Gateway;
  group: string | null;
  onChanged: () => Promise<void>;
  onPending?: (pending: boolean) => void;
  groups?: { id: string; name: string }[];
}) {
  const [items, setItems] = useState<GroupRequest[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [offset, setOffset] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    setBusy(true);
    api
      .groupRequests(group, offset)
      .then((r) => {
        if (active) {
          setItems(r);
          onPending?.(r.some((r) => r.status === 'pending'));
        }
      })
      .catch((e) => {
        if (active)
          setError(
            e.code === 'PGRST202'
              ? 'Заявки станут доступны после обновления базы v0.26.'
              : e.message,
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [api, group, offset, revision, onPending]);
  async function resolve(r: GroupRequest, approve: boolean) {
    if (
      !window.confirm((approve ? 'Принять в группу: ' : 'Отклонить заявку: ') + r.full_name + '?')
    )
      return;
    setBusy(true);
    setError('');
    try {
      await api.resolveGroupRequest(r.user_id, r.group_id, approve);
      await onChanged();
      setRevision((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось обработать заявку.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>{group ? 'Заявки в группу' : 'Моя заявка в группу'}</h2>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {busy && <p role="status">Загрузка…</p>}
      {items.map((r) => (
        <article key={r.user_id}>
          {!group && (
            <p>
              Группа: <b>{groups.find((g) => g.id === r.group_id)?.name || 'Выбранная группа'}</b>
            </p>
          )}
          <p>
            <b>{r.full_name}</b> ·{' '}
            {r.status === 'pending'
              ? 'Ожидает одобрения'
              : r.status === 'approved'
                ? 'Одобрена'
                : r.status === 'cancelled'
                  ? 'Отменена'
                  : 'Отклонена'}
          </p>
          {!group && r.status === 'pending' && (
            <button
              disabled={busy}
              onClick={() => {
                if (!window.confirm('Отменить заявку в группу?')) return;
                setBusy(true);
                void api
                  .cancelGroupRequest()
                  .then(() => setRevision((n) => n + 1))
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              Отменить заявку
            </button>
          )}
          {group && (
            <div className="card-actions">
              <button disabled={busy} onClick={() => void resolve(r, true)}>
                Принять студента
              </button>
              <button disabled={busy} onClick={() => void resolve(r, false)}>
                Отклонить заявку
              </button>
            </div>
          )}
        </article>
      ))}
      {!busy && !error && !items.length && <p>Заявок пока нет.</p>}
      <div className="card-actions">
        <button disabled={busy} onClick={() => setRevision((n) => n + 1)}>
          Обновить заявки
        </button>
        {group && (
          <>
            <button
              disabled={busy || !offset}
              onClick={() => setOffset((n) => Math.max(0, n - 50))}
            >
              Назад
            </button>
            <button disabled={busy || items.length < 50} onClick={() => setOffset((n) => n + 50)}>
              Далее
            </button>
          </>
        )}
      </div>
    </section>
  );
}
