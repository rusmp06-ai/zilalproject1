import type {Gateway,Note} from './types';
export type PlanLink={kind:'course'|'document'|'note';id:string;title:string};
export type PlanValue={studyhub_plan:1;due:string|null;done:boolean;details:string;link:PlanLink|null};
export type PlanTask=Note&{plan:PlanValue};
export function decodePlan(body:string):PlanValue|null{
 try{const p=JSON.parse(body);if(p.studyhub_plan!==1||typeof p.done!=='boolean'||typeof p.details!=='string'||p.details.length>20000)return null;
 if(p.due!==null&&(typeof p.due!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.due)||new Date(p.due+'T12:00:00Z').toISOString().slice(0,10)!==p.due))return null;
 if(p.link!==null&&(!p.link||!['course','document','note'].includes(p.link.kind)||typeof p.link.id!=='string'||!p.link.id||typeof p.link.title!=='string'))return null;
 return p;}catch{return null;}
}
export async function loadPlan(api:Gateway):Promise<{tasks:PlanTask[];notes:Note[]}>{
 const tasks:PlanTask[]=[],notes:Note[]=[];
 // The existing private-note quota is 1000 records. Read every page, including completed tasks.
 for(let offset=0;offset<1000;offset+=50){const rows=await api.notes('',offset);for(const n of rows){const plan=decodePlan(n.body);if(plan)tasks.push({...n,plan});else notes.push(n);}if(rows.length<50)break;}
 tasks.sort((a,b)=>Number(a.plan.done)-Number(b.plan.done)||(a.plan.due||'9999').localeCompare(b.plan.due||'9999')||a.title.localeCompare(b.title));return {tasks,notes};
}
