import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost:5173/'});
for(const key of ['window','document','localStorage','sessionStorage','location','history','HTMLElement','HTMLInputElement','MutationObserver','DOMParser','FormData'])Object.defineProperty(globalThis,key,{value:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react');
const {render,screen,fireEvent,waitFor,cleanup,within}=await import('@testing-library/react');
const {App}=await import('../src/App');
const {resetDemo,demoGateway,selectDemo}=await import('../src/demo');
const {loadSchedule}=await import('../src/study-data');
const {calendarFile}=await import('../src/calendar-export');
const {loadEpub}=await import('../src/epub-reader');
const {default:JSZip}=await import('jszip');
const {StudySearch}=await import('../src/StudySearch');

test.afterEach(async()=>{cleanup();await new Promise(resolve=>setTimeout(resolve,0));sessionStorage.clear();});

test('note draft survives navigation and remount; declined navigation keeps editor',async()=>{
 resetDemo();selectDemo('student');const original=window.confirm;let accept=false;window.confirm=()=>accept;
 try{render(<App/>);await screen.findByText(/Здравствуйте, Студент/);
 fireEvent.click(within(screen.getByRole('complementary')).getByRole('button',{name:'Мои заметки',exact:true}));
 fireEvent.change(await screen.findByLabelText('Название заметки'),{target:{value:'Draft title'}});fireEvent.change(screen.getByLabelText('Текст заметки'),{target:{value:'Important unsaved text'}});
 await screen.findByText(/Черновик сохраняется/);
 fireEvent.click(within(screen.getByRole('complementary')).getByRole('button',{name:'Мой день',exact:true}));assert.ok(screen.getByLabelText('Текст заметки'));
 accept=true;fireEvent.click(within(screen.getByRole('complementary')).getByRole('button',{name:'Мой день',exact:true}));await screen.findByText(/Здравствуйте, Студент/);
 fireEvent.click(within(screen.getByRole('complementary')).getByRole('button',{name:'Мои заметки',exact:true}));assert.equal((await screen.findByLabelText('Текст заметки') as HTMLTextAreaElement).value,'Important unsaved text');
 fireEvent.click(screen.getByRole('button',{name:'Сохранить заметку',exact:true}));await screen.findByText('Заметка сохранена.');await waitFor(()=>assert.equal(sessionStorage.getItem('studyhub-draft-v1:demo:student:note'),null));
 }finally{window.confirm=original;}
});

test('note pages do not become empty when plan records fill the first catalog page',async()=>{
 resetDemo();selectDemo('student');await demoGateway.saveNote('Actual notebook record','Keep me',null,null);
 for(let i=0;i<51;i++)await demoGateway.saveTask('Plan '+i,JSON.stringify({studyhub_plan:1,due:null,done:false,details:'',link:null}),null,null);
 const {NotesPanel}=await import('../src/NotesPanel');render(<NotesPanel api={demoGateway} userId="student"/>);
 await screen.findByText('Actual notebook record');assert.equal(screen.queryByText('Личных заметок пока нет.')===null,true);
});

test('calendar loader collects all 51 events across schedule pages',async()=>{
 resetDemo();selectDemo('student');const snapshot=await demoGateway.snapshot(),calls:number[]=[];
 const items=Array.from({length:51},(_,i)=>({id:'event'+i,group_id:'g0',course_id:null,kind:'schedule' as const,title:'Event '+i,body:'',location:'Room',starts_at:'2026-10-15T03:00:00Z',ends_at:'2026-10-15T04:00:00Z',author_name:'Teacher',created_at:'2026-10-01T00:00:00Z',can_manage:false}));
 const api={...demoGateway,board:async(_g:string,_k:unknown,_f:unknown,_t:unknown,offset:number)=>{calls.push(offset);return {items:items.slice(offset,offset+50),canRead:true,writeScopes:[]};}};
 const result=await loadSchedule(api,'g0','2026-10-01T00:00Z','2026-11-01T00:00Z');assert.equal(result.items.length,51);assert.deepEqual(calls,[0,50]);
});

test('study home removes submitted work from attention list and displays status in all tasks',async()=>{
 resetDemo();selectDemo('owner');await demoGateway.createAssignment('g0c0','Status check','Description',null,10,true);const a=(await demoGateway.assignments('g0c0')).items[0];selectDemo('student');await demoGateway.submit(a.id,'Answer',null);
 const snapshot=await demoGateway.snapshot(),{StudyHome}=await import('../src/StudyHome');const props={api:demoGateway,snapshot,onCourse:()=>{},onRead:()=>{},onNavigate:()=>{}};
 const app=render(<StudyHome {...props}/>);await waitFor(()=>assert.equal(screen.queryByText('Собираем ваше учебное пространство…')===null,true));assert.equal(screen.queryByRole('button',{name:/Status check/})===null,true);
 app.rerender(<StudyHome {...props} view="tasks"/>);await screen.findByText('Сдано · на проверке');
});

test('EPUB follows spine order and renders text without embedded scripts',async()=>{
 const zip=new JSZip();
 zip.file('mimetype','application/epub+zip');zip.file('META-INF/container.xml','<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>');
 zip.file('OPS/book.opf','<package><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>');
 zip.file('OPS/a.xhtml','<html><body><h1>First</h1><p>Study text</p><script>evil()</script></body></html>');zip.file('OPS/b.xhtml','<html><body><h1>Second</h1></body></html>');
 const pages=await loadEpub(await zip.generateAsync({type:'arraybuffer'})),text=pages.join('');assert.ok(text.indexOf('Second')<text.indexOf('First'));assert.ok(!text.includes('evil'));
 zip.file('META-INF/encryption.xml','<encryption/>');const encrypted=await zip.generateAsync({type:'arraybuffer'});await assert.rejects(()=>loadEpub(encrypted),/Зашифрованный/);
});

test('calendar export escapes text and includes timezone-safe reminders',async()=>{
 const text=calendarFile([{id:'event',group_id:'g0',course_id:null,kind:'schedule',title:'Семинар, финансы; план',body:'Line\nNext',location:'204',starts_at:'2026-10-15T03:00:00Z',ends_at:'2026-10-15T04:00:00Z',author_name:'Teacher',created_at:'',can_manage:false}],[],[]);
 assert.ok(text.includes('DTSTART:20261015T030000Z'));assert.ok(text.includes('Семинар\\, финансы\\; план'));assert.ok(text.includes('TRIGGER:-PT30M'));assert.ok(text.includes('DESCRIPTION:Line\\nNext'));
 for(const line of text.split('\r\n'))assert.ok(new TextEncoder().encode(line).length<=75);
});

test('global search finds own notes and materials without exposing other accounts',async()=>{
 resetDemo();selectDemo('owner');await demoGateway.saveNote('Private owner finance','Secret',null,null);await demoGateway.saveMaterial('g0c0','lecture','Finance lecture','Budget',null,null);
 selectDemo('student');await demoGateway.saveNote('Finance summary','Personal finance',null,null);const snapshot=await demoGateway.snapshot();
 render(<StudySearch api={demoGateway} snapshot={snapshot} onCourse={()=>{}} onTasks={()=>{}}/>);fireEvent.change(screen.getByLabelText('Поиск по учебному пространству'),{target:{value:'Finance'}});fireEvent.click(screen.getByRole('button',{name:'Найти',exact:true}));
 await screen.findByText('Finance summary');await screen.findByText('Finance lecture');assert.equal(screen.queryByText('Private owner finance')===null,true);
});

test('library storefront filters the complete catalog and discards partial data on denial or failure',async()=>{
 const {libraryCatalog,libraryShelf}=await import('../src/library-world');
 resetDemo();selectDemo('student');const source=(await demoGateway.library('',0)).items[0];
 const items=Array.from({length:51},(_,i)=>({...source,id:'book-'+i,title:'Книга '+String(i).padStart(2,'0'),mime_type:i===50?'application/pdf':'text/plain',favorite:i===50,page:i===50?2:1,total_pages:i===50?3:0}));
 const calls:number[]=[];
 const api={...demoGateway,library:async(_q:string,offset:number)=>{calls.push(offset);return {items:items.slice(offset,offset+50),canRead:true,quota:null};}};
 const result=await libraryCatalog(api,'',false);assert.deepEqual(calls,[0,50]);assert.equal(result.items.length,51);assert.equal(libraryShelf(result.items,'reading','PDF','new')[0].id,'book-50');
 const denied=await libraryCatalog({...api,library:async(q,o)=>o?{items:[],canRead:false,quota:null}:api.library(q,o)},'',false);assert.equal(denied.canRead,false);assert.equal(denied.items.length,0);
 await assert.rejects(()=>libraryCatalog({...api,library:async(q,o)=>{if(o)throw Error('Network');return api.library(q,o);}},'',false),/Network/);
});

test('speech preserves text, chunks long pages, supports pause/resume, cancels stale events and restricts automatic continuation',async()=>{
 const {useReaderSpeech,speechParts}=await import('../src/reader-speech');const {renderHook,act}=await import('@testing-library/react');
 const text=('Учебная фраза. 🙂 Следующая мысль. ').repeat(25),parts=speechParts(text);assert.equal(parts.map(p=>p.text).join(''),text);assert.ok(parts.every(p=>p.text.length<=260));
 const spoken:any[]=[],counts={pause:0,resume:0,finish:0};const previous=Object.getOwnPropertyDescriptor(globalThis,'speechSynthesis'),oldUtterance=Object.getOwnPropertyDescriptor(globalThis,'SpeechSynthesisUtterance');
 const voice={voiceURI:'ru-local',name:'Русский',lang:'ru-RU',localService:true};
 const engine={getVoices:()=>[voice],speak:(u:any)=>spoken.push(u),cancel(){},pause:()=>counts.pause++,resume:()=>counts.resume++,addEventListener(){},removeEventListener(){}};
 class Utterance{text:string;rate=1;voice:any;lang='';onend:any;onerror:any;constructor(text:string){this.text=text;}}
 Object.defineProperty(globalThis,'speechSynthesis',{value:engine,configurable:true});Object.defineProperty(globalThis,'SpeechSynthesisUtterance',{value:Utterance,configurable:true});
 try{
  const {result,unmount}=renderHook(()=>useReaderSpeech(()=>counts.finish++));
  act(()=>result.current.start(text));assert.equal(spoken[0].voice,voice);assert.equal(result.current.state,'playing');
  act(()=>result.current.pause());assert.equal(result.current.state,'paused');assert.equal(counts.pause,1);
  act(()=>result.current.resume());assert.equal(counts.resume,1);
  const stale=spoken[0];act(()=>result.current.stop());const count=spoken.length;act(()=>stale.onend());assert.equal(spoken.length,count);assert.equal(result.current.state,'idle');
  act(()=>result.current.configure({rate:1.5,voice:'ru-local',autoNext:true}));act(()=>result.current.start('Короткая фраза.','selection'));assert.equal(spoken.at(-1).rate,1.5);act(()=>spoken.at(-1).onend());assert.equal(counts.finish,0);
  act(()=>result.current.start(text));let n=0;while(result.current.state==='playing'&&n++<30)act(()=>spoken.at(-1).onend());assert.equal(counts.finish,1);assert.equal(result.current.state,'idle');
  act(()=>result.current.start('Ещё фраза'));act(()=>spoken.at(-1).onerror({error:'not-allowed'}));assert.match(result.current.error,/заблокировал/);assert.equal(result.current.state,'idle');unmount();
 }finally{cleanup();if(previous)Object.defineProperty(globalThis,'speechSynthesis',previous);else delete (globalThis as any).speechSynthesis;if(oldUtterance)Object.defineProperty(globalThis,'SpeechSynthesisUtterance',oldUtterance);else delete (globalThis as any).SpeechSynthesisUtterance;localStorage.removeItem('studyhub-speech-preferences-v1');}
});
