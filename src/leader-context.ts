import type { Snapshot } from './types';
/** Administration never uses the broader list of groups visible for studying or teaching. */
export function leaderGroups(snapshot: Snapshot) {
  return snapshot.groups.filter(
    (g) =>
      !g.blocked &&
      snapshot.memberships.some(
        (m) =>
          m.user_id === snapshot.me.id && m.active && m.role === 'leader' && m.group_id === g.id,
      ),
  );
}
export function isLeaderStudent(snapshot: Snapshot) {
  return (
    !snapshot.owner &&
    snapshot.memberships.some(
      (m) => m.user_id === snapshot.me.id && m.active && m.role === 'leader',
    )
  );
}
