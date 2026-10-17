import type { BoardItem, Assignment } from './types';
import type { PlanTask } from './personal-plan';
const escape = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
const stamp = (s: string) =>
  new Date(s)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z/, 'Z');
export function calendarFile(events: BoardItem[], assignments: Assignment[], tasks: PlanTask[]) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//StudyHub//Student calendar//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  const item = (
    id: string,
    title: string,
    start: string,
    end: string | null,
    date = false,
    details = '',
    location = '',
  ) => {
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + escape(id) + '@studyhub',
      'DTSTAMP:' + stamp(new Date().toISOString()),
      'SUMMARY:' + escape(title),
      date ? 'DTSTART;VALUE=DATE:' + start.replace(/-/g, '') : 'DTSTART:' + stamp(start),
    );
    if (end) lines.push('DTEND:' + stamp(end));
    if (details) lines.push('DESCRIPTION:' + escape(details));
    if (location) lines.push('LOCATION:' + escape(location));
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:' + escape(title),
      'TRIGGER:' + (date ? '-PT0S' : '-PT30M'),
      'END:VALARM',
      'END:VEVENT',
    );
  };
  for (const e of events)
    if (!e.cancelled && e.starts_at && e.ends_at)
      item(e.id, e.title, e.starts_at, e.ends_at, false, e.body, e.location);
  for (const a of assignments)
    if (a.due_at) item(a.id, 'Сдать: ' + a.title, a.due_at, null, false, a.description);
  for (const t of tasks)
    if (t.plan.due && !t.plan.done) item(t.id, t.title, t.plan.due, null, true, t.plan.details);
  lines.push('END:VCALENDAR');
  // RFC 5545 folds lines at 75 UTF-8 octets, never splitting a code point.
  const folded = lines.map((line) => {
    let out = '',
      part = '',
      bytes = 0;
    for (const c of line) {
      const n = new TextEncoder().encode(c).length;
      if (bytes + n > 75) {
        out += part + '\r\n';
        part = ' ';
        bytes = 1;
      }
      part += c;
      bytes += n;
    }
    return out + part;
  });
  return folded.join('\r\n') + '\r\n';
}
export function downloadCalendar(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' })),
    a = document.createElement('a');
  a.href = url;
  a.download = 'studyhub-calendar.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
