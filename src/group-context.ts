import type {Snapshot} from './types';
// A student's registered membership determines their study context.
// Staff can switch between the groups they manage or teach in.
export function groupContext(snapshot:Snapshot,preferred=''){
 const own=snapshot.memberships.filter(m=>m.user_id===snapshot.me.id&&m.active);
 const student=!snapshot.owner&&own.some(m=>m.role==='student')&&!own.some(m=>m.role==='leader'||m.role==='teacher');
 const registered=student?snapshot.groups.find(g=>own.some(m=>m.role==='student'&&m.group_id===g.id)):undefined;
 const groups=student?(registered?[registered]:[]):snapshot.groups;
 const id=student?registered?.id||'':groups.find(g=>g.id===preferred)?.id||groups[0]?.id||'';
 return {id,groups,canChoose:!student&&groups.length>1,name:groups.find(g=>g.id===id)?.name||''};
}
