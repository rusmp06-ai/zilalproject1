import type { Snapshot } from './types';
// A student's registered membership determines their study context.
// A leader studies in their registered group; administration has its own context.
export function groupContext(snapshot: Snapshot, preferred = '') {
  const own = snapshot.memberships.filter((m) => m.user_id === snapshot.me.id && m.active);
  const leader = !snapshot.owner && own.some((m) => m.role === 'leader');
  const student = leader || (!snapshot.owner && own.some((m) => m.role === 'student'));
  const registered = student
    ? snapshot.groups.find((g) => own.some((m) => m.role === 'student' && m.group_id === g.id)) ||
      snapshot.groups.find((g) => own.some((m) => m.role === 'leader' && m.group_id === g.id))
    : undefined;
  const groups = student ? (registered ? [registered] : []) : snapshot.groups;
  const id = student
    ? registered?.id || ''
    : groups.find((g) => g.id === preferred)?.id || groups[0]?.id || '';
  return {
    id,
    groups,
    canChoose: !student && groups.length > 1,
    name: groups.find((g) => g.id === id)?.name || '',
  };
}
