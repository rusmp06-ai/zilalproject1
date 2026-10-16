import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><body></body>',{url:'http://localhost/?demo=1'});
for(const k of ['window','document','localStorage','sessionStorage','location','history','HTMLElement','HTMLInputElement','MutationObserver','DOMParser','FormData'])Object.defineProperty(globalThis,k,{value:(dom.window as any)[k],configurable:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;window.confirm=()=>true;
const React=await import('react');const {render,screen,fireEvent,cleanup,waitFor}=await import('@testing-library/react');
const {demoGateway,resetDemo,selectDemo}=await import('../src/demo');
const {publishRecoverable,pendingIntake,matchesIntake}=await import('../src/intake-recovery');
const {MaterialIntake}=await import('../src/MaterialIntake');
const publication=()=>({request:crypto.randomUUID(),kind:'lecture' as const,course:'g0c0',group:'g0',title:'Лекция восстановления',description:'Оригинал',due:null,max:100,late:false});
const file=()=>new File(['Lecture original'],'lecture.txt',{type:'text/plain'});
test.beforeEach(()=>{localStorage.clear();sessionStorage.clear();resetDemo();selectDemo('teacher');});test.afterEach(()=>cleanup());

test('uncertain delivery retains request and fields; repeated manual upload uses the same request',async()=>{
 const ids:string[]=[];let fail=true;const api={...demoGateway,publishIntake:async(p:any,f:File)=>{ids.push(p.request);if(fail)throw Error('Network');return demoGateway.publishIntake(p,f);}};
 const p=publication();await assert.rejects(()=>publishRecoverable(api,p,file(),'teacher'),/Network/);const receipt=pendingIntake(api,'teacher')!;assert.equal(receipt.publication.request,p.request);assert.equal(await matchesIntake(receipt,new File(['Changed original'],'lecture.txt',{type:'text/plain'})),false);
 fail=false;await publishRecoverable(api,{...p,request:crypto.randomUUID()},file(),'teacher');assert.deepEqual(ids,[p.request,p.request]);assert.equal((await api.courseMaterials('g0c0','lecture',0)).items.length,1);assert.equal(pendingIntake(api,'teacher'),null);
});

test('different content or destination cannot replace an unfinished receipt',async()=>{
 const api={...demoGateway,publishIntake:async()=>{throw Error('Network');}},p=publication();await assert.rejects(()=>publishRecoverable(api,p,file(),'teacher'));
 await assert.rejects(()=>publishRecoverable(api,{...p,course:'g1c0'},file(),'teacher'),/незавершённая публикация/);await assert.rejects(()=>publishRecoverable(api,p,new File(['other document'],'lecture.txt',{type:'text/plain'}),'teacher'),/незавершённая публикация/);assert.equal(pendingIntake(api,'teacher')?.publication.course,'g0c0');assert.equal(pendingIntake(api,'student'),null);assert.equal(pendingIntake({...api,demo:false},'teacher'),null);
});

test('storage failure blocks upload before reservation; malformed receipt is not overwritten',async()=>{
 let calls=0;const api={...demoGateway,publishIntake:async()=>{calls++;return 'id';}},p=publication(),proto=Object.getPrototypeOf(localStorage),set=proto.setItem;
 proto.setItem=function(){throw Error('Quota');};try{await assert.rejects(()=>publishRecoverable(api,p,file(),'teacher'),/загрузка ещё не началась/);}finally{proto.setItem=set;}assert.equal(calls,0);
 localStorage.setItem('studyhub-upload-v1:demo:teacher','{bad');await assert.rejects(()=>publishRecoverable(api,p,file(),'teacher'),/повреждена/);assert.equal(calls,0);
});

async function open(api:typeof demoGateway,onPublished?:()=>Promise<void>){render(<MaterialIntake api={api} initialCourse="g0c0" onPublished={onPublished}/>);fireEvent.click(screen.getByRole('button',{name:'Добавить документ с ИИ'}));await screen.findByRole('region',{name:'Незавершённая публикация'});}
test('remount restores unfinished fields, rejects a substituted original and resumes without Gemini',async()=>{
 let fail=true,analyses=0,uploads=0;const api={...demoGateway,analyzeMaterial:async()=>{analyses++;throw Error('Unused');},publishIntake:async(p:any,f:File)=>{uploads++;if(fail)throw Error('Network');return demoGateway.publishIntake(p,f);}};
 await assert.rejects(()=>publishRecoverable(api,publication(),file(),'teacher'));await open(api);assert.ok(screen.getByText('Лекция восстановления'));fireEvent.change(screen.getByLabelText('Исходный файл для повтора'),{target:{files:[new File(['Wrong'], 'lecture.txt',{type:'text/plain'})]}});await screen.findByText(/Это другой файл/);assert.equal((screen.getByRole('button',{name:'Продолжить загрузку'}) as HTMLButtonElement).disabled,true);
 fireEvent.change(screen.getByLabelText('Исходный файл для повтора'),{target:{files:[file()]}});await waitFor(()=>assert.equal((screen.getByRole('button',{name:'Продолжить загрузку'}) as HTMLButtonElement).disabled,false));fail=false;fireEvent.click(screen.getByRole('button',{name:'Продолжить загрузку'}));await screen.findByText('Материал опубликован. Оригинальный файл сохранён.');assert.equal(uploads,2);assert.equal(analyses,0);selectDemo('student');const material=(await demoGateway.courseMaterials('g0c0','lecture',0)).items[0];assert.equal(await(await demoGateway.downloadMaterial(material)).text(),'Lecture original');
});

test('lost success response is reconciled without uploading again; failing list refresh stays published',async()=>{
 let uploads=0;const api={...demoGateway,publishIntake:async(p:any,f:File)=>{uploads++;await demoGateway.publishIntake(p,f);throw Error('Response lost');}};
 await assert.rejects(()=>publishRecoverable(api,publication(),file(),'teacher'));await open(api,async()=>{throw Error('Refresh');});fireEvent.click(screen.getByRole('button',{name:'Проверить публикацию'}));await screen.findByText('Материал опубликован. Оригинальный файл сохранён.');await screen.findByText(/Публикация подтверждена, но список не обновился/);assert.equal(uploads,1);assert.equal(pendingIntake(api,'teacher'),null);assert.equal((await demoGateway.courseMaterials('g0c0','lecture',0)).items.length,1);
});

test('cancel failure stays in cancellation after remount and successful repeat clears receipt',async()=>{
 let failCancel=true;const api={...demoGateway,publishIntake:async()=>{throw Error('Network');},cancelIntake:async(request:string)=>{if(failCancel)throw Error('Offline cancellation');return demoGateway.cancelIntake(request);}};
 await assert.rejects(()=>publishRecoverable(api,publication(),file(),'teacher'));await open(api);fireEvent.click(screen.getByRole('button',{name:'Отменить незавершённую публикацию'}));await screen.findByText('Offline cancellation');assert.equal(pendingIntake(api,'teacher')?.deleting,true);cleanup();await open(api);assert.equal(screen.queryByRole('button',{name:'Продолжить загрузку'}),null);failCancel=false;fireEvent.click(screen.getByRole('button',{name:'Отменить незавершённую публикацию'}));await screen.findByText(/резерв места освобождён/);assert.equal(pendingIntake(api,'teacher'),null);
});

test('cancel after a lost successful response preserves the published original',async()=>{
 const api={...demoGateway,publishIntake:async(p:any,f:File)=>{await demoGateway.publishIntake(p,f);throw Error('Response lost');}};
 await assert.rejects(()=>publishRecoverable(api,publication(),file(),'teacher'));await open(api);fireEvent.click(screen.getByRole('button',{name:'Отменить незавершённую публикацию'}));await screen.findByText('Материал опубликован. Оригинальный файл сохранён.');assert.equal((await demoGateway.courseMaterials('g0c0','lecture',0)).items.length,1);
});

test('missing cancellation SQL leaves the original retry available instead of trapping it in deletion',async()=>{
 const api={...demoGateway,publishIntake:async()=>{throw Error('Network');},cancelIntake:async()=>{throw Object.assign(Error('Для безопасной отмены требуется SQL v0.35.'),{notStarted:true});}};
 await assert.rejects(()=>publishRecoverable(api,publication(),file(),'teacher'));await open(api);fireEvent.click(screen.getByRole('button',{name:'Отменить незавершённую публикацию'}));await screen.findByText('Для безопасной отмены требуется SQL v0.35.');assert.equal(pendingIntake(api,'teacher')?.deleting,false);assert.ok(screen.getByRole('button',{name:'Продолжить загрузку'}));
});
