import type { Gateway, Note } from './types';
export type PlanLink = { kind: 'course' | 'document' | 'note'; id: string; title: string };
export type PlanValue = {
  studyhub_plan: 1;
  due: string | null;
  done: boolean;
  details: string;
  link: PlanLink | null;
};
export type PlanTask = Note & { plan: PlanValue };
export function decodePlan(body: string): PlanValue | null {
  try {
    const p = JSON.parse(body);
    if (
      p.studyhub_plan !== 1 ||
      typeof p.done !== 'boolean' ||
      typeof p.details !== 'string' ||
      p.details.length > 20000
    )
      return null;
    if (
      p.due !== null &&
      (typeof p.due !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(p.due) ||
        new Date(p.due + 'T12:00:00Z').toISOString().slice(0, 10) !== p.due)
    )
      return null;
    if (
      p.link !== null &&
      (!p.link ||
        !['course', 'document', 'note'].includes(p.link.kind) ||
        typeof p.link.id !== 'string' ||
        !p.link.id ||
        typeof p.link.title !== 'string')
    )
      return null;
    return p;
  } catch {
    return null;
  }
}
export async function loadPersonalNotes(api: Gateway): Promise<Note[]> {
  const notes: Note[] = [];
  // Filter legacy task records before pagination; the private-note quota is 1000 records.
  for (let offset = 0; offset < 1000; offset += 50) {
    const rows = await api.notes('', offset);
    notes.push(...rows.filter((n) => !decodePlan(n.body)));
    if (rows.length < 50) break;
  }
  return notes;
}
export async function loadPlan(api: Gateway): Promise<{ tasks: PlanTask[]; notes: Note[] }> {
  const [tasks, notes] = await Promise.all([loadTasks(api), loadPersonalNotes(api)]);
  return { tasks, notes };
}

export async function loadTasks(api: Gateway) {
  const tasks: PlanTask[] = [];
  for (let offset = 0; offset < 1000; offset += 50) {
    const rows = await api.taskRecords(offset);
    for (const n of rows) {
      const plan = decodePlan(n.body);
      if (plan) tasks.push({ ...n, plan });
    }
    if (rows.length < 50) break;
  }
  return tasks.sort(
    (a, b) =>
      Number(a.plan.done) - Number(b.plan.done) ||
      (a.plan.due || '9999').localeCompare(b.plan.due || '9999') ||
      a.title.localeCompare(b.title),
  );
}
