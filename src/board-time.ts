// Bishkek uses UTC+06:00; all board date inputs and labels use this timezone.
export function bishkekInput(iso: string) {
  return new Date(Date.parse(iso) + 6 * 3600000).toISOString().slice(0, 16);
}
export function boardInstant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw Error('Укажите дату и время.');
  const d = new Date(value + ':00+06:00');
  if (!Number.isFinite(d.getTime()) || bishkekInput(d.toISOString()) !== value)
    throw Error('Некорректная дата.');
  return d.toISOString();
}
export function boardWindow(date: string) {
  const from = boardInstant(date + 'T00:00');
  return { from, to: new Date(Date.parse(from) + 7 * 86400000).toISOString() };
}
export function boardDate(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Asia/Bishkek',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}
