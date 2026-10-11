import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost:5199/'});
for(const key of ['window','document','localStorage','sessionStorage','location','history','HTMLElement','HTMLInputElement','MutationObserver','DOMParser','FormData'])Object.defineProperty(globalThis,key,{value:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react');
const {render,screen,cleanup,waitFor,act}=await import('@testing-library/react');
const {lessonDay,lessonCountdown,studyDate}=await import('../src/lesson-day');
const {saveSchedule,scheduleCopy,savedSchedules,forgetSchedule}=await import('../src/schedule-cache');
const {boardNotice,encodeBoardNotice}=await import('../src/board-notice');
const {StudyHome}=await import('../src/StudyHome');
const {OfflineDay}=await import('../src/OfflineDay');
const {demoGateway,resetDemo,selectDemo}=await import('../src/demo');
const {boardWindow}=await import('../src/board-time');
import type {BoardItem} from '../src/types';
const event=(id:string,start:string,end:string):BoardItem=>({id,group_id:'g0',course_id:'g0c0',kind:'schedule',title:id,body:'',location:'204',starts_at:start,ends_at:end,author_name:'Teacher',created_at:start,can_manage:false});
test.afterEach(async()=>{cleanup();await new Promise(resolve=>setTimeout(resolve,0));localStorage.clear();sessionStorage.clear();});

test('lesson selection respects exact boundaries, overlaps, missing times and the Bishkek date',()=>{
 const first=event('first','2026-10-15T03:00:00Z','2026-10-15T04:20:00Z'),second=event('next','2026-10-15T04:30:00Z','2026-10-15T05:50:00Z');
 let day=lessonDay([second,{...first,id:'invalid',starts_at:'bad'},first],Date.parse(first.starts_at!));assert.equal(day.current?.id,'first');assert.equal(day.next?.id,'next');assert.equal(lessonCountdown(first,Date.parse(first.starts_at!)),'Пара только началась');
 day=lessonDay([first,second],Date.parse(first.ends_at!));assert.equal(day.current,null);assert.equal(day.past.length,1);assert.equal(lessonCountdown(second,Date.parse(first.ends_at!)),'Начнётся через 10 мин');
 day=lessonDay([first,{...first,id:'overlap'},second],Date.parse('2026-10-15T03:12:00Z'));assert.equal(day.overlap,true);assert.equal(lessonCountdown(first,Date.parse('2026-10-15T03:12:00Z')),'Пара идёт 12 мин');
 assert.equal(studyDate(Date.parse('2026-10-15T18:00:00Z')),'2026-10-16');assert.equal(lessonDay([first],Date.parse(first.ends_at!)).remaining.length,0);
 const overnight=event('night','2026-10-15T17:30:00Z','2026-10-15T18:30:00Z');assert.equal(lessonDay([overnight],Date.parse('2026-10-15T18:05:00Z')).today.length,1);
});

test('schedule copies are isolated, require full day coverage and are removed on known denial',()=>{
 const copy={groupId:'g0',groupName:'Group',from:'2026-10-14T18:00:00Z',to:'2026-10-21T18:00:00Z',savedAt:'2026-10-15T03:00:00Z',events:[event('class','2026-10-15T03:00:00Z','2026-10-15T04:20:00Z')]};
 assert.equal(saveSchedule('live:alice',copy),true);assert.ok(scheduleCopy('live:alice','g0','2026-10-15T18:00:00Z','2026-10-16T18:00:00Z'));assert.equal(scheduleCopy('live:bob','g0',copy.from,copy.to),null);assert.equal(scheduleCopy('live:alice','g0',copy.from,'2026-10-22T18:00:00Z'),null);assert.equal(saveSchedule('live:alice',{...copy,events:[{...copy.events[0],group_id:'other'}]}),false);
 forgetSchedule('live:alice','g0');assert.deepEqual(savedSchedules('live:alice'),[]);localStorage.setItem('studyhub-schedule-v1:live:alice','{broken');assert.deepEqual(savedSchedules('live:alice'),[]);
});

test('important notices require the publisher flag and preserve plain announcements',()=>{
 assert.equal(boardNotice('Пару отменили').important,false);const text='Следующая пара: аудитория 308.\nВозьмите конспект.';assert.deepEqual(boardNotice(encodeBoardNotice(text,true)),{text,important:true});assert.equal(encodeBoardNotice(text,false),text);assert.throws(()=>encodeBoardNotice('"'.repeat(6000),true),/длинное/);
});

test('nearest lesson renders while assignment requests are still pending',async()=>{
 resetDemo();selectDemo('student');const snapshot=await demoGateway.snapshot(),now=Date.now(),e=event('Fast lesson',new Date(now-120000).toISOString(),new Date(now+3600000).toISOString());let release!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve;});const api={...demoGateway,board:async(_g:string,k:string)=>({items:k==='schedule'?[e]:[],canRead:true,writeScopes:[]}),assignments:async()=>{await pending;return {items:[],canSubmit:true,canGrade:false,userId:'student'};}};
 render(<StudyHome api={api} snapshot={snapshot} onCourse={()=>{}} onNavigate={()=>{}} onRead={()=>{}}/>);await screen.findByRole('heading',{name:'Fast lesson',exact:true});assert.ok(screen.getByText('Собираем ваше учебное пространство…'));await act(async()=>{release();await pending;});await waitFor(()=>assert.equal(screen.queryByText('Собираем ваше учебное пространство…'),null));
});

test('offline day shows only the selected account copy and no document actions',async()=>{
 const now=Date.now(),window=boardWindow(studyDate(now)),copy={groupId:'g0',groupName:'Cached group',...window,savedAt:new Date(now-60000).toISOString(),events:[event('Offline lesson',new Date(now-60000).toISOString(),new Date(now+3600000).toISOString())]};assert.equal(saveSchedule('live:alice',copy),true);
 const app=render(<OfflineDay user="live:alice"/>);screen.getByRole('heading',{name:'Offline lesson',exact:true});assert.equal(screen.queryByRole('button',{name:'Материалы пары',exact:true}),null);assert.ok(screen.getByText('Сохранённое расписание · изменения не проверены'));app.rerender(<OfflineDay user="live:bob"/>);assert.equal(screen.queryByRole('heading',{name:'Offline lesson',exact:true}),null);assert.ok(screen.getByText(/На сегодня нет сохранённого расписания/));
});

test('failed load uses a labelled copy but a definitive schedule denial discards it',async()=>{
 resetDemo();selectDemo('student');const snapshot=await demoGateway.snapshot(),now=Date.now(),window=boardWindow(studyDate(now));saveSchedule('demo:student',{groupId:'g0',groupName:'Group',...window,savedAt:new Date(now).toISOString(),events:[event('Saved lesson',new Date(now-60000).toISOString(),new Date(now+3600000).toISOString())]});
 const callbacks={onCourse:()=>{},onRead:()=>{},onNavigate:()=>{}};const failure={...demoGateway,board:async()=>{throw Error('Network');}};
 const app=render(<StudyHome api={failure} snapshot={snapshot} {...callbacks}/>);await screen.findByRole('heading',{name:'Saved lesson',exact:true});assert.ok(screen.getByText('Сохранённое расписание · изменения не проверены'));await waitFor(()=>assert.equal(screen.queryByText('Собираем ваше учебное пространство…'),null));
 const denied={...demoGateway,board:async()=>({items:[],canRead:false,writeScopes:[]})};app.rerender(<StudyHome api={denied} snapshot={snapshot} {...callbacks}/>);await screen.findByRole('heading',{name:'Доступ к расписанию закрыт',exact:true});assert.deepEqual(savedSchedules('demo:student'),[]);assert.equal(screen.queryByRole('heading',{name:'Saved lesson',exact:true}),null);
});

test('schedule week starts Monday across month and year boundaries',async()=>{
 const {weekStart,moveScheduleDate}=await import('../src/SchedulePanel');
 assert.equal(weekStart('2026-11-01'),'2026-10-26');assert.equal(weekStart('2027-01-01'),'2026-12-28');assert.equal(moveScheduleDate('2026-12-31',1),'2027-01-01');
});
test('student schedule opens lesson materials, has no management and renders full week',async()=>{
 const {SchedulePanel}=await import('../src/SchedulePanel');resetDemo();selectDemo('student');const snapshot=await demoGateway.snapshot(),today=studyDate(Date.now()),w=boardWindow(today),e=event('Проверочная пара',new Date(Date.parse(w.from)+9*3600000).toISOString(),new Date(Date.parse(w.from)+10*3600000).toISOString());
 let opened:unknown[]=[];const api={...demoGateway,board:async()=>({items:[e],canRead:true,writeScopes:[]})};
 render(<SchedulePanel api={api} snapshot={snapshot} onCourse={(...args)=>{opened=args;}}/>);
 const button=await screen.findByRole('button',{name:/Проверочная пара/});assert.equal(screen.queryByRole('button',{name:'Управление занятиями'}),null);
 await act(async()=>button.click());await act(async()=>screen.getByRole('button',{name:'Материалы занятия'}).click());assert.deepEqual(opened,['g0c0',undefined,'materials']);
 await act(async()=>screen.getByRole('button',{name:'Неделя',exact:true}).click());await waitFor(()=>assert.equal(document.querySelectorAll('.schedule-day').length,7));
});
