import type { Gateway, Snapshot, GroupRequest, ManagedInvitation, LibraryPage } from './types';
export type OwnerOperations = {
  requests: GroupRequest[];
  requestsComplete: boolean;
  invitations: ManagedInvitation[] | null;
  quota: LibraryPage['quota'];
  issues: string[];
};
export async function loadOwnerOperations(
  api: Gateway,
  snapshot: Snapshot,
  includeHealth = true,
): Promise<OwnerOperations> {
  if (!snapshot.owner) throw Error('Доступно только владельцу.');
  const result: OwnerOperations = {
    requests: [],
    requestsComplete: true,
    invitations: null,
    quota: null,
    issues: [],
  };
  const requests = async () => {
    for (let start = 0; start < snapshot.groups.length; start += 3)
      await Promise.all(
        snapshot.groups.slice(start, start + 3).map(async (group) => {
          try {
            const items: GroupRequest[] = [];
            for (let offset = 0; offset < 100000; offset += 50) {
              const rows = await api.groupRequests(group.id, offset);
              items.push(...rows.filter((r) => r.status === 'pending'));
              if (rows.length < 50) {
                result.requests.push(...items);
                return;
              }
            }
            throw Error('Limit');
          } catch {
            result.requestsComplete = false;
            result.issues.push('Не удалось проверить заявки группы «' + group.name + '».');
          }
        }),
      );
    result.requests.sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.user_id.localeCompare(b.user_id),
    );
  };
  if (!includeHealth) {
    await requests();
    return result;
  }
  await Promise.all([
    requests(),
    (async () => {
      try {
        const items: ManagedInvitation[] = [];
        for (let offset = 0; offset < 100000; offset += 50) {
          const rows = await api.invitationCatalog(offset);
          items.push(...rows);
          if (rows.length < 50) {
            result.invitations = items;
            return;
          }
        }
        throw Error('Limit');
      } catch {
        result.issues.push('Приглашения не удалось проверить.');
      }
    })(),
    api
      .library('', 0)
      .then((page) => {
        result.quota = page.quota;
        if (!page.quota) result.issues.push('Данные хранилища недоступны.');
      })
      .catch(() => {
        result.issues.push('Хранилище не удалось проверить.');
      }),
  ]);
  return result;
}
