import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost:5204/?demo=1'});
for(const key of ['window','document','localStorage','sessionStorage','location','history','HTMLElement','HTMLInputElement','MutationObserver','DOMParser','FormData'])Object.defineProperty(globalThis,key,{value:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react');
const {render,screen,cleanup,waitFor,fireEvent,within}=await import('@testing-library/react');
const {App}=await import('../src/App');
const {OwnerAdminPanel}=await import('../src/OwnerAdminPanel');
const {ownerSummary}=await import('../src/OwnerOverview');
const {catalogPages}=await import('../src/catalog-pages');
const {demoGateway,resetDemo,selectDemo}=await import('../src/demo');
// Each test starts as a fresh visit; remounts inside a test retain their URL.
test.beforeEach(()=>history.replaceState(null,'','/?demo=1'));
test.afterEach(async()=>{cleanup();await new Promise(r=>setTimeout(r,0));localStorage.clear();sessionStorage.clear();});
async function openAdmin(section:string){fireEvent.click(screen.getByRole('button',{name:'Открыть админ',exact:true}));fireEvent.click(within(screen.getByRole('navigation',{name:'Разделы владельца'})).getByRole('button',{name:section,exact:true}));}
test('owner summary counts unique people and includes leaders among students',async()=>{
 resetDemo();selectDemo('owner');const s=await demoGateway.snapshot();s.memberships.push({user_id:'leader',group_id:'g0',role:'student',active:true});s.courses[0].archived=true;const summary=ownerSummary(s);assert.equal(summary.students,2);assert.equal(summary.leaders,1);assert.equal(summary.teachers,1);assert.equal(summary.courses,7);assert.equal(summary.withoutLeader.length,3);
});
test('full catalog reaches accounts beyond a single server page and never returns partial totals',async()=>{
 const accounts=Array.from({length:1001},(_,id)=>({id}));assert.deepEqual(await catalogPages(async(offset,limit)=>accounts.slice(offset,offset+limit)),accounts);
 await assert.rejects(()=>catalogPages(async(offset,limit)=>{if(offset>=500)throw Error('Connection lost');return accounts.slice(offset,offset+limit);}),/Connection lost/);
});
test('owner overview separates project administration from personal reading',async()=>{
 resetDemo();selectDemo('owner');render(<App/>);await screen.findByRole('heading',{name:'Обзор проекта',exact:true});const nav=screen.getByRole('button',{name:'Админ',exact:true});assert.ok(nav);assert.equal(screen.queryByRole('button',{name:'Управление доступом',exact:true})===null,true);assert.equal(screen.queryByRole('button',{name:'Группы и дисциплины',exact:true})===null,true);assert.equal(screen.queryByLabelText('Название группы')===null,true);
 fireEvent.click(screen.getByRole('button',{name:'Библиотека',exact:true}));await screen.findByText('Как пользоваться общей библиотекой');assert.equal(screen.queryByLabelText('Название материала')===null,true);assert.equal(screen.queryByRole('button',{name:'Удалить',exact:true})===null,true);
 await openAdmin('Публикации в библиотеке');await screen.findByLabelText('Название материала');assert.ok(screen.getByRole('button',{name:'Удалить',exact:true}));
});
test('blocking requires explicit confirmation, can be cancelled and records no private data',async()=>{
 resetDemo();selectDemo('owner');render(<App/>);await screen.findByRole('heading',{name:'Обзор проекта',exact:true});await openAdmin('Участники и роли');const article=screen.getByRole('heading',{name:'Студент',exact:true}).closest('article')!;
 fireEvent.click(within(article).getByRole('button',{name:'Заблокировать'}));assert.equal((await demoGateway.snapshot()).profiles.find(p=>p.id==='student')!.blocked,false);fireEvent.click(within(article).getByRole('button',{name:'Отмена',exact:true}));assert.equal((await demoGateway.auditEvents(0)).length,0);
 fireEvent.click(within(article).getByRole('button',{name:'Заблокировать'}));fireEvent.click(within(article).getByRole('button',{name:'Подтвердить блокировку'}));await screen.findByText('Статус аккаунта изменён.');assert.equal((await demoGateway.snapshot()).profiles.find(p=>p.id==='student')!.blocked,true);const events=await demoGateway.auditEvents(0);assert.equal(events[0].actor_id,'owner');assert.equal(events[0].entity_id,'student');assert.deepEqual(events[0].details,{blocked:true});
 const me=screen.getByRole('heading',{name:'Владелец платформы',exact:true}).closest('article')!;assert.equal(within(me).queryByRole('button',{name:'Заблокировать'})===null,true);
});
test('role filters include leader in students and show a teacher once across groups',async()=>{
 resetDemo();selectDemo('owner');render(<App/>);await screen.findByRole('heading',{name:'Обзор проекта',exact:true});await openAdmin('Участники и роли');fireEvent.change(screen.getByLabelText('Роль участника'),{target:{value:'student'}});assert.equal(document.querySelectorAll('.owner-account-list article').length,2);
 fireEvent.change(screen.getByLabelText('Роль участника'),{target:{value:'teacher'}});assert.equal(document.querySelectorAll('.owner-account-list article').length,1);assert.equal(document.querySelectorAll('.owner-memberships li').length,2);
 fireEvent.change(screen.getByLabelText('Группа участника'),{target:{value:'g3'}});assert.equal(document.querySelectorAll('.owner-account-list article').length,0);
});
test('owner invitation and history are scoped to owner; tokens never enter the audit',async()=>{
 resetDemo();selectDemo('owner');const token=await demoGateway.invite('leader',null,[],1);assert.equal((await demoGateway.auditEvents(0))[0].action,'invitation.created');assert.equal(JSON.stringify(await demoGateway.auditEvents(0)).includes(token),false);
 selectDemo('leader');await assert.rejects(()=>demoGateway.auditEvents(0));const s=await demoGateway.snapshot();render(<OwnerAdminPanel api={demoGateway} snapshot={s} onChanged={async()=>{}} onOverview={()=>{}}/>);await screen.findByRole('alert');assert.equal(screen.queryByRole('navigation',{name:'Разделы владельца'})===null,true);assert.equal(screen.queryByLabelText('Название группы')===null,true);
});
test('owner can manage a different group without changing their personal account',async()=>{
 resetDemo();selectDemo('owner');render(<App/>);await screen.findByRole('heading',{name:'Обзор проекта',exact:true});await openAdmin('Дисциплины и преподаватели');fireEvent.change(screen.getByLabelText('Рабочая группа'),{target:{value:'g2'}});fireEvent.change(screen.getByLabelText('Новая дисциплина'),{target:{value:'Управление финансами'}});fireEvent.click(screen.getByRole('button',{name:'Добавить дисциплину'}));await screen.findByText('Дисциплина создана.');assert.ok((await demoGateway.snapshot()).courses.some(c=>c.title==='Управление финансами'&&c.group_id==='g2'));fireEvent.click(screen.getByRole('button',{name:'К обзору проекта'}));await screen.findByRole('heading',{name:'Обзор проекта',exact:true});assert.equal((await demoGateway.snapshot()).me.id,'owner');
});
