import type { BoardItem } from './types';
export type ScheduleCopy = {
  groupId: string;
  groupName: string;
  from: string;
  to: string;
  savedAt: string;
  events: BoardItem[];
};
const prefix = 'studyhub-schedule-v1:';
function valid(value: unknown): value is ScheduleCopy {
  if (!value || typeof value !== 'object') return false;
  const c = value as ScheduleCopy;
  return (
    typeof c.groupId === 'string' &&
    typeof c.groupName === 'string' &&
    [c.from, c.to, c.savedAt].every(
      (v) => typeof v === 'string' && Number.isFinite(Date.parse(v)),
    ) &&
    Date.parse(c.to) > Date.parse(c.from) &&
    Array.isArray(c.events) &&
    c.events.length <= 500 &&
    c.events.every(
      (e) =>
        e &&
        e.group_id === c.groupId &&
        e.kind === 'schedule' &&
        typeof e.id === 'string' &&
        typeof e.title === 'string' &&
        typeof e.location === 'string' &&
        typeof e.body === 'string' &&
        typeof e.starts_at === 'string' &&
        typeof e.ends_at === 'string' &&
        Number.isFinite(Date.parse(e.starts_at)) &&
        Date.parse(e.ends_at) > Date.parse(e.starts_at),
    )
  );
}
export function savedSchedules(user: string): ScheduleCopy[] {
  try {
    if (!user) return [];
    const list = JSON.parse(localStorage.getItem(prefix + user) || '[]');
    return Array.isArray(list) ? list.filter(valid).slice(0, 8) : [];
  } catch {
    return [];
  }
}
export function scheduleCopy(user: string, group: string, from: string, to: string) {
  return (
    savedSchedules(user)
      .filter(
        (c) =>
          c.groupId === group &&
          Date.parse(c.from) <= Date.parse(from) &&
          Date.parse(c.to) >= Date.parse(to),
      )
      .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))[0] || null
  );
}
export function saveSchedule(user: string, copy: ScheduleCopy) {
  if (!user || !valid(copy)) return false;
  try {
    const copies = [copy, ...savedSchedules(user).filter((c) => c.groupId !== copy.groupId)].slice(
        0,
        8,
      ),
      text = JSON.stringify(copies);
    if (new TextEncoder().encode(text).length > 1024 * 1024) return false;
    localStorage.setItem(prefix + user, text);
    return true;
  } catch {
    return false;
  }
}
export function forgetSchedule(user: string, group?: string) {
  try {
    if (!group) localStorage.removeItem(prefix + user);
    else
      localStorage.setItem(
        prefix + user,
        JSON.stringify(savedSchedules(user).filter((c) => c.groupId !== group)),
      );
  } catch {
    /* Cache is optional. */
  }
}
