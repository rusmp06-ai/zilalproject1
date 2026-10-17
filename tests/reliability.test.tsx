import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><body></body>',{url:'http://localhost/?demo=1'});
for(const k of ['window','document','localStorage','sessionStorage','location','history','HTMLElement','HTMLInputElement','MutationObserver','DOMParser','FormData'])Object.defineProperty(globalThis,k,{value:(dom.window as any)[k],configurable:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;window.confirm=()=>true;window.alert=()=>{};
const React=await import('react');const {render,screen,fireEvent,cleanup,act}=await import('@testing-library/react');
const {demoGateway,resetDemo,selectDemo}=await import('../src/demo');
const {NotesPanel}=await import('../src/NotesPanel');
const {StudentSubmission}=await import('../src/StudentSubmission');
const {mayLeaveDrafts}=await import('../src/drafts');
const {publicationLock}=await import('../src/intake-recovery');
test.beforeEach(()=>{localStorage.clear();sessionStorage.clear();resetDemo();selectDemo('student');});test.afterEach(()=>cleanup());
async function noteForm(api=demoGateway){const r=render(<NotesPanel api={api} userId="student"/>);await screen.findByText('Личных заметок пока нет.');fireEvent.change(screen.getByLabelText('Название заметки'),{target:{value:'Надёжная заметка'}});fireEvent.change(screen.getByLabelText('Текст заметки'),{target:{value:'Не потерять этот текст'}});return r;}

test('lost note acknowledgement is verified once, without a duplicate or retained false error',async()=>{
 let writes=0;const api={...demoGateway,saveNote:async(...args:Parameters<typeof demoGateway.saveNote>)=>{writes++;await demoGateway.saveNote(...args);throw Error('Lost response');}};
 await noteForm(api);fireEvent.click(screen.getByRole('button',{name:'Сохранить заметку'}));await screen.findByText('Заметка сохранена.');assert.equal(writes,1);assert.equal((await demoGateway.notes('',0)).length,1);assert.equal((screen.getByLabelText('Текст заметки') as HTMLTextAreaElement).value,'');
});

test('uncertain note survives remount; checking cannot send another write while reads fail',async()=>{
 let writes=0,unavailable=false;const api={...demoGateway,notes:async(q:string,n:number)=>{if(unavailable)throw Error('Offline');return demoGateway.notes(q,n);},saveNote:async(...args:Parameters<typeof demoGateway.saveNote>)=>{writes++;await demoGateway.saveNote(...args);unavailable=true;throw Error('Lost response');}};
 const r=await noteForm(api);fireEvent.click(screen.getByRole('button',{name:'Сохранить заметку'}));await screen.findByText(/Не удалось проверить сохранение заметки/);assert.equal((screen.getByLabelText('Текст заметки') as HTMLTextAreaElement).value,'Не потерять этот текст');r.unmount();render(<NotesPanel api={api} userId="student"/>);await screen.findByText('Offline');fireEvent.click(screen.getByRole('button',{name:'Проверить сохранение'}));await act(async()=>{});assert.equal(writes,1);unavailable=false;fireEvent.click(screen.getByRole('button',{name:'Проверить сохранение'}));await screen.findByText('Заметка сохранена.');assert.equal(writes,1);assert.equal((await demoGateway.notes('',0)).length,1);
});

test('rejected save keeps note text and permits a deliberate retry',async()=>{
 let fail=true;const api={...demoGateway,saveNote:async(...args:Parameters<typeof demoGateway.saveNote>)=>{if(fail)throw Error('Rejected save');return demoGateway.saveNote(...args);}};
 await noteForm(api);fireEvent.click(screen.getByRole('button',{name:'Сохранить заметку'}));await screen.findByText('Rejected save');assert.equal((screen.getByLabelText('Текст заметки') as HTMLTextAreaElement).value,'Не потерять этот текст');assert.equal(screen.queryByText('Заметка сохранена.'),null);fail=false;fireEvent.click(screen.getByRole('button',{name:'Сохранить заметку'}));await screen.findByText('Заметка сохранена.');
});

test('same-tick note submits are locked and navigation cannot unmount the in-flight save',async()=>{
 let writes=0;let release!:()=>void;const wait=new Promise<void>(r=>release=r);const api={...demoGateway,saveNote:async(...args:Parameters<typeof demoGateway.saveNote>)=>{writes++;await wait;return demoGateway.saveNote(...args);}};
 await noteForm(api);const form=screen.getByRole('button',{name:'Сохранить заметку'}).closest('form')!;await act(async()=>{fireEvent.submit(form);fireEvent.submit(form);});assert.equal(writes,1);assert.equal(mayLeaveDrafts(),false);await act(async()=>release());await screen.findByText('Заметка сохранена.');assert.equal((await demoGateway.notes('',0)).length,1);
});

test('submission stays locked through failed-send reconciliation, including same-tick submits',async()=>{
 let writes=0;let fail!:()=>void,checked!:()=>void;const write=new Promise<void>(r=>fail=r),check=new Promise<void>(r=>checked=r);
 const api={...demoGateway,submit:async()=>{writes++;await write;throw Error('Lost send');}};
 render(<StudentSubmission api={api} task={{id:crypto.randomUUID(),course_id:'g0c0',title:'Task',description:'',due_at:null,max_score:100,allow_late:true,created_at:new Date().toISOString()}} user="student" attempt={1} onSubmitted={async()=>{}} onFailed={async()=>{await check;}}/>);
 fireEvent.change(screen.getByLabelText('Ваш ответ'),{target:{value:'Answer'}});const form=screen.getByRole('button',{name:'Отправить работу'}).closest('form')!;await act(async()=>{fireEvent.submit(form);fireEvent.submit(form);});assert.equal(writes,1);await act(async()=>fail());await screen.findByText('Lost send');await act(async()=>fireEvent.submit(form));assert.equal(writes,1);assert.equal(mayLeaveDrafts(),false);await act(async()=>checked());assert.equal((screen.getByRole('button',{name:'Отправить работу'}) as HTMLButtonElement).disabled,false);
});

test('publication lock also rejects concurrent writes when Web Locks are unavailable',async()=>{
 let release!:()=>void;const waiting=new Promise<void>(r=>release=r);const first=publicationLock(demoGateway,'student',()=>waiting);await assert.rejects(()=>publicationLock(demoGateway,'student',async()=>{}),/уже выполняется/);release();await first;await publicationLock(demoGateway,'student',async()=>{});
});

test('an older identical note is not mistaken for acknowledgement of a new note',async()=>{
 const {saveNoteSafely}=await import('../src/note-save');await demoGateway.saveNote('Same','Text',null,null);let writes=0;
 const api={...demoGateway,saveNote:async()=>{writes++;throw Error('Rejected new note');}};
 await assert.rejects(()=>saveNoteSafely(api,{title:'Same',body:'Text',id:null,version:null},null,()=>{}),/Rejected new note/);assert.equal(writes,1);assert.equal((await demoGateway.notes('',0)).length,1);
});

test('lost edit acknowledgement recognizes the new version without overwriting another edit',async()=>{
 const {saveNoteSafely}=await import('../src/note-save');await demoGateway.saveNote('Before','Old',null,null);const note=(await demoGateway.notes('',0))[0];let writes=0;
 const api={...demoGateway,saveNote:async(...args:Parameters<typeof demoGateway.saveNote>)=>{writes++;await demoGateway.saveNote(...args);throw Error('Lost edit response');}};
 await saveNoteSafely(api,{title:'After',body:'New',id:note.id,version:note.version},null,()=>{});const notes=await demoGateway.notes('',0);assert.equal(writes,1);assert.equal(notes.length,1);assert.equal(notes[0].version,note.version+1);assert.equal(notes[0].body,'New');
});


test('lost submission acknowledgement recognizes only the matching confirmed own attempt',async()=>{
 const id=crypto.randomUUID();let writes=0,confirmed=false;
 const work={id:'work',student_id:'student',student_name:'Student',text_answer:'Confirmed answer',attempt_no:1,status:'submitted',submitted_at:new Date().toISOString(),is_late:false,return_feedback:null,storage_path:null,original_name:null,mime_type:null,size_bytes:null,score:null,feedback:null,released_at:null};
 const api={...demoGateway,submit:async()=>{writes++;throw Error('Lost response');},works:async()=>[work]};
 render(<StudentSubmission api={api} task={{id,course_id:'g0c0',title:'Task',description:'',due_at:null,max_score:100,allow_late:true,created_at:new Date().toISOString()}} user="student" attempt={1} onSubmitted={async()=>{confirmed=true;}} onFailed={async()=>{throw Error('Should reconcile');}}/>);
 fireEvent.change(screen.getByLabelText('Ваш ответ'),{target:{value:'Confirmed answer'}});fireEvent.click(screen.getByRole('button',{name:'Отправить работу'}));await screen.findByText('Работа отправлена на проверку.');assert.equal(confirmed,true);assert.equal(writes,1);assert.equal(screen.queryByText('Lost response'),null);
});

test('an unfinished, different or another student’s attempt cannot clear the local answer',async()=>{
 const work={id:'work',student_id:'student',student_name:'Student',text_answer:'My answer',attempt_no:1,status:'submitted',submitted_at:new Date().toISOString(),is_late:false,return_feedback:null,storage_path:null,original_name:null,mime_type:null,size_bytes:null,score:null,feedback:null,released_at:null};
 for(const change of [{status:'uploading'},{student_id:'other'},{text_answer:'Other answer'},{attempt_no:2},{original_name:'other.txt'}]){
  const api={...demoGateway,submit:async()=>{throw Error('Not confirmed');},works:async()=>[{...work,...change}]};
  render(<StudentSubmission api={api} task={{id:crypto.randomUUID(),course_id:'g0c0',title:'Task',description:'',due_at:null,max_score:100,allow_late:true,created_at:new Date().toISOString()}} user="student" attempt={1} onSubmitted={async()=>{throw Error('Wrong confirmation');}} onFailed={async()=>{}}/>);
  fireEvent.change(screen.getByLabelText('Ваш ответ'),{target:{value:'My answer'}});fireEvent.click(screen.getByRole('button',{name:'Отправить работу'}));await screen.findByText('Not confirmed');assert.equal((screen.getByLabelText('Ваш ответ') as HTMLTextAreaElement).value,'My answer');assert.equal(screen.queryByText('Работа отправлена на проверку.'),null);cleanup();
 }
});
