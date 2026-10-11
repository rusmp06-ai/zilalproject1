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

test('owner creates group, invites leader, new account accepts invitation and creates own group',async()=>{
 resetDemo();render(<App/>);
 fireEvent.click(screen.getByRole('button',{name:'Владелец',exact:true}));
 await screen.findByText('Ваше пространство');
 fireEvent.click(screen.getByRole('button',{name:'Группы и дисциплины',exact:true}));
 fireEvent.change(screen.getByPlaceholderText('Например, ИФ-3-24'),{target:{value:'Новая группа'}});
 fireEvent.click(screen.getByRole('button',{name:'Создать группу',exact:true}));
 await screen.findByText('Группа создана.');
 assert.ok((await demoGateway.snapshot()).groups.some(g=>g.name==='Новая группа'));
 fireEvent.click(screen.getByRole('button',{name:'Приглашения',exact:true}));
 fireEvent.change(screen.getByLabelText('Кого приглашаем'),{target:{value:'leader'}});
 fireEvent.click(screen.getByRole('button',{name:'Создать ссылку',exact:true}));
 const textarea=await screen.findByLabelText('Пригласительная ссылка') as HTMLTextAreaElement;
 const invite=new URL(textarea.value).hash;
 await demoGateway.logout();cleanup();dom.window.location.hash=invite;render(<App/>);
 fireEvent.click(screen.getByRole('button',{name:'Создать аккаунт',exact:true}));
 fireEvent.change(screen.getByLabelText('Имя и фамилия'),{target:{value:'Новый староста'}});
 fireEvent.click(screen.getByRole('button',{name:'Зарегистрироваться',exact:true}));
 await screen.findByRole('button',{name:'Принять приглашение'});
 fireEvent.click(screen.getByRole('button',{name:'Принять приглашение'}));
 await screen.findByText('Приглашение принято.');
 assert.equal((await demoGateway.snapshot()).availableGroups,1);
 fireEvent.click(screen.getByRole('button',{name:'Группы и дисциплины',exact:true}));
 fireEvent.change(screen.getByPlaceholderText('Например, ИФ-3-24'),{target:{value:'Группа старосты'}});
 fireEvent.click(screen.getByRole('button',{name:'Создать группу',exact:true}));
 await screen.findByText('Группа создана.');
 const s=await demoGateway.snapshot();assert.equal(s.groups.length,1);assert.equal(s.groups[0].name,'Группа старосты');
 cleanup();dom.window.location.hash='';
});
test('owner blocks student and student cannot reopen dashboard',async()=>{
 resetDemo();render(<App/>);
 fireEvent.click(screen.getByRole('button',{name:'Владелец',exact:true}));
 await screen.findByText('Ваше пространство');
 fireEvent.click(screen.getByRole('button',{name:'Управление доступом',exact:true}));
 const studentName=screen.getByText('Студент',{selector:'.people-list b'});
 const row=studentName.parentElement!.parentElement!;
 fireEvent.click(within(row).getByRole('button',{name:'Заблокировать',exact:true}));
 await screen.findByText('Статус аккаунта изменён.');
 fireEvent.click(screen.getByRole('button',{name:'Студент',exact:true}));
 await screen.findByRole('alert');
 await waitFor(()=>assert.equal(screen.queryByText('Ваше пространство')===null,true));
 assert.match(screen.getByRole('alert').textContent||'',/Доступ к аккаунту закрыт/);
 cleanup();
});
test('teacher demo shows only assigned disciplines in both groups',async()=>{
 resetDemo();selectDemo('teacher');const s=await demoGateway.snapshot();
 assert.equal(s.groups.length,2);assert.equal(s.courses.length,2);
 assert.ok(s.courses.every(c=>c.title==='Корпоративные финансы'));
});

test('leader uploads material and owner deletes it; student only reads',async()=>{
 resetDemo();render(<App/>);
 fireEvent.click(screen.getByRole('button',{name:'Староста',exact:true}));
 await screen.findByText('Ваше пространство');
 fireEvent.click(screen.getByRole('button',{name:'Библиотека',exact:true}));
 await screen.findByText('Как пользоваться общей библиотекой');
 fireEvent.change(screen.getByLabelText('Название материала'),{target:{value:'Лекция старосты'}});
 const file=new dom.window.File(['Finance notes'],'lecture.txt',{type:'text/plain'});
 fireEvent.change(screen.getByLabelText('Файл',{exact:true}),{target:{files:[file]}});
 fireEvent.submit(screen.getByRole('button',{name:'Загрузить материал',exact:true}).closest('form')!);
 await screen.findByText('Материал опубликован в общей библиотеке.');
 assert.equal((await demoGateway.library('',0)).items.filter(i=>i.title==='Лекция старосты').length,1);
 fireEvent.click(screen.getByRole('button',{name:'Студент',exact:true}));
 await screen.findByText('Ваше пространство');
 fireEvent.click(screen.getByRole('button',{name:'Библиотека',exact:true}));
 await screen.findByText('Лекция старосты');
 assert.equal(screen.queryByRole('button',{name:'Загрузить материал'})===null,true);
 assert.equal(screen.queryByRole('button',{name:'Удалить',exact:true})===null,true);
 fireEvent.click(screen.getByRole('button',{name:'Владелец',exact:true}));
 await screen.findByText('Ваше пространство');
 fireEvent.click(screen.getByRole('button',{name:'Библиотека',exact:true}));
 const card=(await screen.findByText('Лекция старосты')).closest('article')!;
 fireEvent.click(within(card).getByRole('button',{name:'Удалить',exact:true}));
 fireEvent.click(within(card).getByRole('button',{name:'Подтвердить удаление'}));
 await screen.findByText('Материал удалён.');
 await waitFor(()=>assert.equal(screen.queryByText('Лекция старосты')===null,true));
});
test('library prohibition prevents reads and downloads in demo',async()=>{
 resetDemo();selectDemo('owner');await demoGateway.deny('library',null,'g0',null);
 selectDemo('student');const page=await demoGateway.library('',0);assert.equal(page.canRead,false);assert.equal(page.items.length,0);
 await assert.rejects(()=>demoGateway.downloadLibrary({id:'sample-note'} as any),/Доступ к библиотеке закрыт/);
 selectDemo('owner');const own=await demoGateway.snapshot();await demoGateway.restore(own.denials[0].id);
 selectDemo('student');assert.equal((await demoGateway.library('',0)).canRead,true);
});
test('file validation rejects empty, oversized and executable web files',async()=>{
 const {validateFile}=await import('../src/files');
 assert.throws(()=>validateFile({name:'x.txt',size:0,type:'text/plain'}),/Размер/);
 assert.throws(()=>validateFile({name:'x.pdf',size:10485761,type:'application/pdf'}),/Размер/);
 assert.throws(()=>validateFile({name:'x.html',size:10,type:'text/html'}),/Поддерживаются/);
 assert.throws(()=>validateFile({name:'x.pdf',size:10,type:'text/html'}),/не соответствует/);
 assert.equal(validateFile({name:'x.docx',size:10,type:''}),'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});

test('leader publishes lecture and course file; student reads without editing rights',async()=>{
 resetDemo();render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Староста',exact:true}));await screen.findByText('Ваше пространство');
 fireEvent.click(screen.getByRole('button',{name:'Группы и дисциплины',exact:true}));fireEvent.click(screen.getAllByRole('button',{name:'Открыть дисциплину'})[0]);
 fireEvent.click(await screen.findByRole('button',{name:'Материалы',exact:true}));fireEvent.click(await screen.findByRole('button',{name:'Опубликовать материал',exact:true}));await screen.findByRole('heading',{name:'Новый материал',exact:true});
 fireEvent.change(screen.getByLabelText('Название',{exact:true}),{target:{value:'Лекция по финансам'}});
 fireEvent.change(screen.getByLabelText('Текст или описание'),{target:{value:'Текст лекции для своей группы.'}});
 fireEvent.click(screen.getByRole('button',{name:'Опубликовать',exact:true}));await screen.findByText('Материал сохранён.');await screen.findByText('Лекция по финансам');
 fireEvent.click(screen.getByRole('button',{name:'Презентации',exact:true}));await screen.findByRole('heading',{name:'Новый материал',exact:true});
 fireEvent.change(screen.getByLabelText('Название',{exact:true}),{target:{value:'Слайды к лекции'}});
 fireEvent.change(screen.getByLabelText('Файл — необязательно'),{target:{files:[new dom.window.File(['slides'],'slides.txt',{type:'text/plain'})]}});
 fireEvent.click(screen.getByRole('button',{name:'Опубликовать',exact:true}));await screen.findByText('Материал сохранён.');await screen.findByText('Слайды к лекции');
 fireEvent.click(screen.getByRole('button',{name:'Студент',exact:true}));await screen.findByText('Ваше пространство');
 fireEvent.click(screen.getByRole('button',{name:'Группы и дисциплины',exact:true}));fireEvent.click(screen.getAllByRole('button',{name:'Открыть дисциплину'})[0]);
 fireEvent.click(await screen.findByRole('button',{name:'Темы',exact:true}));await screen.findByText('Лекция по финансам');assert.equal(screen.queryByRole('button',{name:'Опубликовать',exact:true})===null,true);assert.equal(screen.queryByRole('button',{name:'Изменить',exact:true})===null,true);
 await screen.findByText('Слайды к лекции');await screen.findByRole('button',{name:'Скачать файл'});
});
test('lecture denial is separate from presentations and teacher cannot manage unassigned course',async()=>{
 resetDemo();selectDemo('leader');await demoGateway.saveMaterial('g0c0','lecture','Lecture','body',null,null);await demoGateway.saveMaterial('g0c0','presentation','Slides','body',null,null);
 selectDemo('owner');await demoGateway.deny('lectures',null,'g0',null);
 selectDemo('student');await assert.rejects(()=>demoGateway.courseMaterials('g0c0','lecture',0),/Доступ/);assert.equal((await demoGateway.courseMaterials('g0c0','presentation',0)).items.length,1);
 selectDemo('teacher');await assert.rejects(()=>demoGateway.saveMaterial('g0c1','material','Forbidden','',null,null),/Доступ/);
});

test('assignment UI submits, hides draft grade, and shows published result',async()=>{
 resetDemo();render(<App/>);
 async function open(role:string,id?:string){fireEvent.click(screen.getByRole('button',{name:role,exact:true}));await screen.findByText('Ваше пространство');fireEvent.click(screen.getByRole('button',{name:'Группы и дисциплины',exact:true}));fireEvent.click(screen.getAllByRole('button',{name:'Открыть дисциплину'})[0]);fireEvent.click(await screen.findByRole('button',{name:'Задания',exact:true}));await screen.findByLabelText('Выберите задание');if(id){fireEvent.change(screen.getByLabelText('Выберите задание'),{target:{value:id}});await screen.findByText('Практика 1',{selector:'h3'});}}
 await open('Преподаватель');
 fireEvent.change(screen.getByLabelText('Название задания'),{target:{value:'Практика 1'}});fireEvent.change(screen.getByLabelText('Условия задания'),{target:{value:'Решите задачу'}});fireEvent.click(screen.getByRole('button',{name:'Создать задание'}));await screen.findByText('Задание опубликовано.');const id=(await demoGateway.assignments('g0c0')).items[0].id;
 await open('Студент',id);fireEvent.change(screen.getByLabelText('Ваш ответ'),{target:{value:'Решение студента'}});fireEvent.click(screen.getByRole('button',{name:'Отправить работу'}));await screen.findByText('Работа отправлена на проверку.');
 await open('Преподаватель',id);fireEvent.change(await screen.findByLabelText('Балл'),{target:{value:'80'}});fireEvent.change(screen.getByLabelText('Обратная связь'),{target:{value:'Комментарий преподавателя'}});fireEvent.click(screen.getByRole('button',{name:'Сохранить черновик'}));await screen.findByText('Оценка сохранена.');
 await open('Студент',id);await screen.findByText('Решение студента');assert.equal(screen.queryByText('Комментарий преподавателя')===null,true);assert.equal(screen.queryByText(/Черновик оценки/)===null,true);
 await open('Преподаватель',id);fireEvent.click(await screen.findByRole('button',{name:'Опубликовать оценку'}));await screen.findByText('Оценка сохранена.');
 await open('Студент',id);await screen.findByText('Опубликованная оценка: 80 / 100');await screen.findByText('Комментарий преподавателя');assert.equal(screen.queryByRole('button',{name:'Отправить работу'})===null,true);
});
test('assignment return keeps attempts and denies leader grading',async()=>{
 resetDemo();selectDemo('leader');await assert.rejects(()=>demoGateway.createAssignment('g0c0','Test','Body',null,100,false));selectDemo('teacher');await demoGateway.createAssignment('g0c0','Test','Body',null,100,false);const id=(await demoGateway.assignments('g0c0')).items[0].id;
 selectDemo('student');await demoGateway.submit(id,'First',null);await assert.rejects(()=>demoGateway.submit(id,'Duplicate',null));const work=(await demoGateway.works(id,0))[0];selectDemo('leader');await assert.rejects(()=>demoGateway.grade(work.id,50,'',true));selectDemo('teacher');await demoGateway.returnWork(work.id,'Исправьте ответ');selectDemo('student');await demoGateway.submit(id,'Second',null);const attempts=await demoGateway.works(id,0);assert.equal(attempts.length,2);assert.equal(attempts.find(w=>w.attempt_no===1)?.status,'returned');assert.equal(attempts.find(w=>w.attempt_no===2)?.text_answer,'Second');
});

test('leader schedule entry can be edited; student reads without controls; owner deletes',async()=>{
 resetDemo();render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Староста',exact:true}));await screen.findByText('Ваше пространство');fireEvent.click(screen.getByRole('button',{name:'Расписание',exact:true}));
 fireEvent.click(await screen.findByRole('button',{name:'Управление занятиями'}));fireEvent.change(await screen.findByLabelText('Название занятия'),{target:{value:'Финансы · семинар'}});fireEvent.change(screen.getByLabelText('Аудитория или место'),{target:{value:'Аудитория 101'}});fireEvent.click(screen.getByRole('button',{name:'Добавить занятие',exact:true}));await screen.findByText('Занятие добавлено.');await screen.findByText('Финансы · семинар');
 fireEvent.click(screen.getByRole('button',{name:'Изменить запись'}));fireEvent.change(screen.getByLabelText('Название занятия'),{target:{value:'Финансы · практика'}});fireEvent.click(screen.getByRole('button',{name:'Сохранить изменения'}));await screen.findByText('Запись обновлена.');await screen.findByText('Финансы · практика');
 fireEvent.click(screen.getByRole('button',{name:'Студент',exact:true}));await screen.findByText('Ваше пространство');fireEvent.click(screen.getByRole('button',{name:'Расписание',exact:true}));await screen.findByText('Финансы · практика');assert.equal(screen.queryByRole('button',{name:'Добавить занятие',exact:true})===null,true);assert.equal(screen.queryByRole('button',{name:'Изменить запись'})===null,true);await screen.findByText('Аудитория 101');
 fireEvent.click(screen.getByRole('button',{name:'Владелец',exact:true}));await screen.findByText('Ваше пространство');fireEvent.click(screen.getByRole('button',{name:'Расписание',exact:true}));fireEvent.click(await screen.findByRole('button',{name:'Управление занятиями'}));fireEvent.click(await screen.findByRole('button',{name:'Удалить запись'}));fireEvent.click(screen.getByRole('button',{name:'Подтвердить удаление'}));await screen.findByText('Запись удалена.');await waitFor(()=>assert.equal(screen.queryByText('Финансы · практика')===null,true));
});
test('assigned teacher publishes course announcement and student sees it',async()=>{
 resetDemo();render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Преподаватель',exact:true}));await screen.findByText('Ваше пространство');fireEvent.click(screen.getByRole('button',{name:'Объявления',exact:true}));const title=await screen.findByLabelText('Заголовок объявления');assert.equal(screen.queryByRole('option',{name:'Общее событие группы'})===null,true);fireEvent.change(title,{target:{value:'Подготовка к экзамену'}});fireEvent.change(screen.getByLabelText('Описание'),{target:{value:'Повторите главы 1–3.'}});fireEvent.click(screen.getByRole('button',{name:'Опубликовать объявление'}));await screen.findByText('Объявление опубликовано.');
 fireEvent.click(screen.getByRole('button',{name:'Студент',exact:true}));await screen.findByText('Ваше пространство');fireEvent.click(screen.getByRole('button',{name:'Объявления',exact:true}));await screen.findByText('Подготовка к экзамену');await screen.findByText('Повторите главы 1–3.');assert.equal(screen.queryByRole('button',{name:'Опубликовать объявление'})===null,true);
});
test('board permission scopes, section blocks and Bishkek boundaries',async()=>{
 const {boardInstant,boardWindow,bishkekInput}=await import('../src/board-time');assert.equal(boardInstant('2026-10-10T09:00'),'2026-10-10T03:00:00.000Z');assert.equal(bishkekInput('2026-10-09T19:00:00Z'),'2026-10-10T01:00');assert.deepEqual(boardWindow('2026-10-10'),{from:'2026-10-09T18:00:00.000Z',to:'2026-10-16T18:00:00.000Z'});assert.throws(()=>boardInstant('2026-02-30T09:00'),/Некорректная/);
 resetDemo();selectDemo('leader');const input={group:'g0',course:'g0c0',kind:'schedule' as const,title:'Class',body:'',location:'101',start:'2026-10-10T03:00:00.000Z',end:'2026-10-10T04:00:00.000Z',id:null};await demoGateway.saveBoard(input);await assert.rejects(()=>demoGateway.saveBoard({...input,group:'g1',course:null}));selectDemo('teacher');assert.equal((await demoGateway.board('g0','schedule',null,null,0)).writeScopes.length,0);await assert.rejects(()=>demoGateway.saveBoard(input));await assert.rejects(()=>demoGateway.saveBoard({...input,kind:'announcement',start:null,end:null,course:'g0c1'}));
 selectDemo('student');assert.equal((await demoGateway.board('g0','schedule','2026-10-10T04:00:00.000Z',null,0)).items.length,0);selectDemo('owner');await demoGateway.deny('schedule',null,'g0',null);selectDemo('student');assert.equal((await demoGateway.board('g0','schedule',null,null,0)).canRead,false);assert.equal((await demoGateway.board('g0','announcement',null,null,0)).canRead,true);selectDemo('owner');await demoGateway.restore((await demoGateway.snapshot()).denials[0].id);await demoGateway.deny('course',null,'g0','g0c0');selectDemo('student');assert.equal((await demoGateway.board('g0','schedule',null,null,0)).items.length,0);
});

test('personal note UI creates, searches, edits and deletes own records',async()=>{
 resetDemo();render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Студент',exact:true}));await screen.findByText('Ваше пространство');fireEvent.click(screen.getByRole('button',{name:'Мои заметки',exact:true}));fireEvent.change(await screen.findByLabelText('Название заметки'),{target:{value:'Мой конспект'}});fireEvent.change(screen.getByLabelText('Текст заметки'),{target:{value:'Формула стоимости капитала'}});fireEvent.click(screen.getByRole('button',{name:'Сохранить заметку'}));await screen.findByText('Заметка сохранена.');await screen.findByText('Мой конспект',{selector:'h3'});
 fireEvent.change(screen.getByLabelText('Поиск по заметкам'),{target:{value:'стоимости'}});fireEvent.click(screen.getByRole('button',{name:'Найти заметки'}));fireEvent.click(await screen.findByRole('button',{name:'Редактировать заметку'}));fireEvent.change(screen.getByLabelText('Название заметки'),{target:{value:'Конспект обновлён'}});fireEvent.click(screen.getByRole('button',{name:'Сохранить заметку'}));await screen.findByText('Конспект обновлён',{selector:'h3'});
 fireEvent.click(screen.getByRole('button',{name:'Владелец',exact:true}));await screen.findByText('Ваше пространство');fireEvent.click(screen.getByRole('button',{name:'Мои заметки',exact:true}));await screen.findByText('Личных заметок пока нет.');assert.equal(screen.queryByText('Конспект обновлён')===null,true);
 fireEvent.click(screen.getByRole('button',{name:'Студент',exact:true}));await screen.findByText('Ваше пространство');fireEvent.click(screen.getByRole('button',{name:'Мои заметки',exact:true}));fireEvent.click(await screen.findByRole('button',{name:'Удалить заметку'}));fireEvent.click(screen.getByRole('button',{name:'Подтвердить удаление'}));await screen.findByText('Заметка удалена.');await screen.findByText('Личных заметок пока нет.');
});
test('personal note permissions, stale versions and pagination',async()=>{
 resetDemo();selectDemo('student');for(let i=0;i<51;i++)await demoGateway.saveNote('Note '+i,'Secret body',null,null);const page=await demoGateway.notes('',0),next=await demoGateway.notes('',50);assert.equal(page.length,50);assert.equal(next.length,1);const n=page[0];await demoGateway.saveNote('Revised','Secret',n.id,n.version);await assert.rejects(()=>demoGateway.saveNote('Stale','Overwrite',n.id,n.version));await assert.rejects(()=>demoGateway.deleteNote(n.id,n.version));selectDemo('owner');assert.equal((await demoGateway.notes('',0)).length,0);await assert.rejects(()=>demoGateway.deleteNote(n.id,n.version+1));await demoGateway.block('student',null,true);selectDemo('student');await assert.rejects(()=>demoGateway.notes('',0));selectDemo('owner');await demoGateway.block('student',null,false);selectDemo('student');assert.equal((await demoGateway.notes('Revised',0)).length,1);for(let i=0;i<10;i++)await demoGateway.saveNote('Large '+i,'Я'.repeat(50000),null,null);await assert.rejects(()=>demoGateway.saveNote('Over budget','Я'.repeat(50000),null,null),/Лимит/);
});

test('reader resumes text pages, bookmarks and personal favorites',async()=>{
 resetDemo();selectDemo('owner');
 const file=Object.assign(new Blob(['А'.repeat(4000)+'Б'.repeat(4000)+'Последняя страница'],{type:'text/plain'}),{name:'book.txt'});
 await demoGateway.uploadLibrary('g0','Учебник',file as File);
 selectDemo('student');render(<App/>);await screen.findByText('Ваше пространство');fireEvent.click(screen.getByRole('button',{name:'Библиотека',exact:true}));
 const card=(await screen.findByText('Учебник',{selector:'h3'})).closest('article')!;
 fireEvent.click(within(card).getByRole('button',{name:'Открыть',exact:true}));
 const dialog=await screen.findByRole('dialog',{name:'Учебник'});
 await within(dialog).findByText('Страница 1 из 3 · Прогресс: 33%');
 fireEvent.click(within(dialog).getByRole('button',{name:'Следующая страница'}));await within(dialog).findByText('Страница 2 из 3 · Прогресс: 67%');
 fireEvent.click(within(dialog).getByRole('button',{name:'Добавить закладку'}));await within(dialog).findByRole('button',{name:'К странице 2'});
 fireEvent.change(within(dialog).getByLabelText('Страница',{exact:true}),{target:{value:'3'}});fireEvent.click(within(dialog).getByRole('button',{name:'Перейти к странице'}));await within(dialog).findByText('Страница 3 из 3 · Прогресс: 100%');fireEvent.click(within(dialog).getByRole('button',{name:'К странице 2'}));await within(dialog).findByText('Страница 2 из 3 · Прогресс: 67%');
 fireEvent.click(within(dialog).getByText('Ещё',{exact:true}));fireEvent.click(within(dialog).getByRole('button',{name:'В избранное',exact:true}));await within(dialog).findByRole('button',{name:'Убрать из избранного',exact:true});
 fireEvent.click(within(dialog).getByRole('button',{name:'Закрыть просмотр'}));
 fireEvent.click(within((await screen.findByText('Учебник',{selector:'h3'})).closest('article')!).getByRole('button',{name:'Открыть',exact:true}));
 const reopened=await screen.findByRole('dialog',{name:'Учебник'});await within(reopened).findByText('Страница 2 из 3 · Прогресс: 67%');fireEvent.click(within(reopened).getByRole('button',{name:'Закладки',exact:true}));await within(reopened).findByRole('button',{name:'К странице 2'});
 fireEvent.click(within(reopened).getByRole('button',{name:'Убрать закладку'}));await waitFor(()=>assert.equal(within(reopened).queryByRole('button',{name:'К странице 2'})===null,true));
 fireEvent.click(within(reopened).getByRole('button',{name:'Закрыть просмотр'}));fireEvent.click(screen.getByLabelText('Только избранное'));
 await waitFor(()=>assert.equal(screen.queryByText('Как пользоваться общей библиотекой',{selector:'h3'})===null,true));assert.ok(screen.getByText('Учебник',{selector:'h3'}));
 fireEvent.click(screen.getByRole('button',{name:'Владелец',exact:true}));await screen.findByText('Ваше пространство');fireEvent.click(screen.getByRole('button',{name:'Библиотека',exact:true}));fireEvent.click(await screen.findByLabelText('Только избранное'));await screen.findByText('В избранном пока нет материалов.');
});

test('reading state rejects stale writes and access denial without exposing another account',async()=>{
 const {emptyReading,textPages}=await import('../src/reader-state');
 assert.equal(textPages('🙂'.repeat(4001)).join(''),'🙂'.repeat(4001));assert.equal(textPages('🙂'.repeat(4001)).length,2);
 resetDemo();selectDemo('student');const first=await demoGateway.saveReading({...emptyReading('sample-note'),page:2,total_pages:3,favorite:true,bookmarks:[2,1,2]});assert.deepEqual(first.bookmarks,[1,2]);
 await demoGateway.saveReading({...first,page:3});await assert.rejects(()=>demoGateway.saveReading({...first,page:1}),/изменены/);
 await assert.rejects(()=>demoGateway.saveReading({...first,bookmarks:[4]}),/Проверьте/);
 selectDemo('owner');assert.equal((await demoGateway.readingState('sample-note')).version,0);assert.equal((await demoGateway.library('',0,true)).items.length,0);
 await demoGateway.deny('library','student',null,null);selectDemo('student');await assert.rejects(()=>demoGateway.readingState('sample-note'),/закрыт/);await assert.rejects(()=>demoGateway.saveReading(first),/закрыт/);
 selectDemo('owner');await demoGateway.restore((await demoGateway.snapshot()).denials[0].id);selectDemo('student');assert.equal((await demoGateway.readingState('sample-note')).page,3);
 selectDemo('owner');await demoGateway.deleteLibrary('sample-note');selectDemo('student');await assert.rejects(()=>demoGateway.readingState('sample-note'),/закрыт/);
});

test('owner transfers student with confirmation and preserves personal notes',async()=>{
 resetDemo();selectDemo('student');await demoGateway.saveNote('Keep me','Private',null,null);selectDemo('owner');render(<App/>);await screen.findByText('Ваше пространство');fireEvent.click(screen.getByRole('button',{name:'Управление доступом',exact:true}));
 fireEvent.change(screen.getByLabelText('Новая группа'),{target:{value:'g1'}});fireEvent.click(screen.getByRole('button',{name:'Перенести студента',exact:true}));assert.equal((await demoGateway.snapshot()).memberships.find(m=>m.user_id==='student'&&m.role==='student'&&m.active)?.group_id,'g0');
 fireEvent.click(screen.getByRole('button',{name:'Подтвердить перенос'}));await screen.findByText('Студент перенесён в новую группу.');assert.equal((await demoGateway.snapshot()).memberships.find(m=>m.user_id==='student'&&m.role==='student'&&m.active)?.group_id,'g1');await assert.rejects(()=>demoGateway.transferStudent('student','g0','g2'),/изменилась/);
 fireEvent.click(screen.getByRole('button',{name:'Студент',exact:true}));await screen.findByText('Ваше пространство');assert.deepEqual((await demoGateway.snapshot()).groups.map(g=>g.id),['g1']);assert.equal((await demoGateway.notes('',0))[0].title,'Keep me');await assert.rejects(()=>demoGateway.transferStudent('student','g1','g0'),/владельца/);
});
test('leader revokes own invitation and removes only one teaching assignment',async()=>{
 resetDemo();selectDemo('owner');await demoGateway.invite('student','g0',[],60);selectDemo('leader');const token=await demoGateway.invite('student','g0',[],60);render(<App/>);await screen.findByText('Ваше пространство');fireEvent.click(screen.getByRole('button',{name:'Приглашения',exact:true}));
 fireEvent.click(await screen.findByRole('button',{name:'Отозвать приглашение'}));fireEvent.click(screen.getByRole('button',{name:'Подтвердить отзыв'}));await screen.findByText('Приглашение отозвано.');assert.equal((await demoGateway.invitationCatalog(0)).length,1);
 selectDemo('student');await assert.rejects(()=>demoGateway.redeem(token),/недоступно/);selectDemo('leader');
 fireEvent.click(screen.getByRole('button',{name:'Группы и дисциплины',exact:true}));fireEvent.click(await screen.findByRole('button',{name:'Снять назначение'}));fireEvent.click(screen.getByRole('button',{name:'Подтвердить снятие назначения'}));await screen.findByText('Назначение преподавателя снято.');await screen.findByText('Назначений в этой группе нет.');await assert.rejects(()=>demoGateway.removeTeaching('g1c0','teacher'),/прав/);
 selectDemo('teacher');assert.equal((await demoGateway.assignments('g1c0')).canGrade,true);await assert.rejects(()=>demoGateway.assignments('g0c0'),/Доступ/);
});

test('student day connects schedule, exact assignment, calendar and saved reading',async()=>{
 resetDemo();selectDemo('owner');
 const owner=await demoGateway.snapshot(),course=owner.courses[0];
 const start=new Date(Date.now()+30*60000).toISOString(),end=new Date(Date.now()+90*60000).toISOString();
 await demoGateway.saveBoard({group:course.group_id,course:course.id,kind:'schedule',title:'Семинар учебного дня',body:'Подготовить конспект',location:'Аудитория 204',start,end,id:null});
 await demoGateway.createAssignment(course.id,'Задание учебного дня','Прочитать главу',new Date(Date.now()+86400000).toISOString(),10,true);
 const task=(await demoGateway.assignments(course.id)).items.find(a=>a.title==='Задание учебного дня')!;
 const file=new File(['А'.repeat(4500)],'учебный-день.txt',{type:'text/plain'});
 await demoGateway.uploadLibrary(course.group_id,'Книга учебного дня',file);
 const book=(await demoGateway.library('',0)).items.find(b=>b.title==='Книга учебного дня')!;
 selectDemo('student');const state=await demoGateway.readingState(book.id);
 await demoGateway.saveReading({...state,page:2,total_pages:2,favorite:true});
 render(<App/>);
 await screen.findByText(/Здравствуйте, Студент/);
 await within(screen.getByRole('region',{name:'Сейчас и следующая пара'})).findByRole('heading',{name:'Семинар учебного дня',exact:true});
 assert.ok(within(screen.getByRole('region',{name:'Сейчас и следующая пара'})).getByText('Аудитория 204'));
 fireEvent.click(screen.getByRole('button',{name:/Задание учебного дня/}));
 const select=await screen.findByLabelText('Выберите задание');
 await waitFor(()=>assert.equal((select as HTMLSelectElement).value,task.id));
 await screen.findByText('Прочитать главу');
 fireEvent.click(screen.getByRole('button',{name:'Календарь',exact:true}));
 await screen.findByLabelText('Месяц');
 const day=new Date(start).toLocaleDateString('ru-RU',{timeZone:'Asia/Bishkek',weekday:'long',day:'numeric',month:'long'});
 fireEvent.click(screen.getByRole('button',{name:new RegExp(day)}));
 await screen.findByRole('button',{name:/Семинар учебного дня/});
 fireEvent.click(screen.getByRole('button',{name:'Мой день',exact:true}));
 fireEvent.click(await screen.findByRole('button',{name:/Книга учебного дня/}));
 await screen.findByRole('dialog');
 await screen.findByText(/Страница 2 из 2 · Прогресс/);
});

test('study day preserves working widgets when schedule fails and retries without stale data',async()=>{
 const {StudyHome}=await import('../src/StudyHome');
 resetDemo();selectDemo('student');const snapshot=await demoGateway.snapshot();
 let failing=true,calls=0;
 const api={...demoGateway,board:async(_group:string,kind:string)=>{if(kind==='schedule')calls++;if(failing)throw Error('network');return {items:[],canRead:false,writeScopes:[]};}};
 render(<StudyHome api={api} snapshot={snapshot} onNavigate={()=>{}} onCourse={()=>{}} onRead={()=>{}}/>);
 await screen.findByText('Расписание не удалось загрузить полностью. Попробуйте ещё раз.');
 assert.ok(screen.getByRole('button',{name:/Читать и учиться/}));
 failing=false;fireEvent.click(screen.getByRole('button',{name:'Попробовать снова'}));
 await screen.findByText('Доступ к расписанию закрыт.');
 await waitFor(()=>assert.equal(screen.queryByText('Расписание не удалось загрузить полностью. Попробуйте ещё раз.')===null,true));
 assert.equal(calls,2);
});

test('study calendar uses Bishkek month boundaries and keeps midnight-spanning classes',async()=>{
 const {StudyHome}=await import('../src/StudyHome');
 resetDemo();selectDemo('student');const snapshot=await demoGateway.snapshot();
 const event={id:'midnight',group_id:snapshot.groups[0].id,course_id:null,kind:'schedule' as const,title:'Вечерняя подготовка',body:'',location:'Онлайн',starts_at:'2026-10-31T17:59:30.000Z',ends_at:'2026-10-31T18:30:00.000Z',author_name:'Староста',created_at:'2026-10-01T00:00:00Z',can_manage:false};
 const calls:{from:string|null;to:string|null}[]=[];
 const api={...demoGateway,assignments:async()=>({items:[],canGrade:false,canSubmit:true,userId:snapshot.me.id}),board:async(_g:string,_k:any,from:string|null,to:string|null)=>{calls.push({from,to});return {items:[event],canRead:true,writeScopes:[]};}};
 render(<StudyHome api={api} snapshot={snapshot} view="calendar" onNavigate={()=>{}} onCourse={()=>{}} onRead={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Месяц'),{target:{value:'2026-10'}});
 await waitFor(()=>assert.equal(screen.queryByText('Собираем ваше учебное пространство…')===null,true));
 assert.deepEqual(calls.at(-1),{from:'2026-09-30T18:00:00.000Z',to:'2026-10-31T18:00:00.000Z'});
 const count=calls.length;
 fireEvent.click(screen.getByRole('button',{name:/31 октября/}));
 await screen.findByRole('button',{name:/Вечерняя подготовка/});
 assert.equal(calls.length,count);
 fireEvent.change(screen.getByLabelText('Месяц'),{target:{value:'2026-11'}});
 await waitFor(()=>assert.deepEqual(calls.at(-1),{from:'2026-10-31T18:00:00.000Z',to:'2026-11-30T18:00:00.000Z'}));
 await screen.findByRole('button',{name:/Вечерняя подготовка/});
});

test('registered student keeps their group without selectors across study screens',async()=>{
 resetDemo();selectDemo('student');render(<App/>);
 await screen.findByText(/Здравствуйте, Студент/);
 await waitFor(()=>assert.equal(screen.queryByText('Собираем ваше учебное пространство…')===null,true));
 assert.equal(screen.queryByRole('combobox')===null,true);
 assert.ok(screen.getByText('ИФ-1-24'));
 for(const name of ['Календарь','Все задания','Расписание','Объявления','Группы и дисциплины']){
  fireEvent.click(within(screen.getByRole('complementary')).getByRole('button',{name,exact:true}));
  assert.equal(screen.queryByRole('combobox')===null,true);
  assert.ok(screen.getByText('ИФ-1-24'));
 }
 assert.equal(screen.queryByText('Создание группы')===null,true);
});

test('group context follows student membership and transfers; staff retain switching',async()=>{
 const {groupContext}=await import('../src/group-context');
 resetDemo();selectDemo('owner');const all=await demoGateway.snapshot();
 const student={...all,owner:false,me:all.profiles.find(p=>p.id==='student')!};
 assert.equal(groupContext(student,'g1').id,'g0');assert.equal(groupContext(student).canChoose,false);
 const moved={...student,memberships:student.memberships.map(m=>m.user_id==='student'?{...m,group_id:'g2'}:m)};
 assert.equal(groupContext(moved,'g0').id,'g2');
 const missing={...student,groups:student.groups.filter(g=>g.id!=='g0')};
 assert.equal(groupContext(missing).id,'');assert.equal(groupContext(missing).canChoose,false);
 const teacher={...all,owner:false,me:all.profiles.find(p=>p.id==='teacher')!};
 assert.equal(groupContext(teacher,'g1').id,'g1');assert.equal(groupContext(teacher).canChoose,true);
 assert.equal(groupContext({...teacher,groups:teacher.groups.slice(0,1)}).canChoose,false);
});

test('reader searches pages, remembers appearance and shares private quoted notes with notebook',async()=>{
 const {ReaderPanel}=await import('../src/ReaderPanel');
 resetDemo();selectDemo('owner');
 const text='Глава 1. Введение\n'+('Текст учебника. '.repeat(280))+'\nГлава 2. Рынок\nСпрос и предложение.';
 const file=Object.assign(new Blob([text],{type:'text/plain'}),{name:'reader-study.txt'});
 await demoGateway.uploadLibrary('g0','Учебная книга',file as File);
 const item=(await demoGateway.library('',0)).items.find(i=>i.title==='Учебная книга')!;
 selectDemo('student');
 render(<ReaderPanel api={demoGateway} item={item} onChanged={()=>{}}/>);
 await screen.findByLabelText('Текст страницы');
 fireEvent.click(screen.getByRole('button',{name:'Настройки чтения'}));
 fireEvent.click(screen.getByRole('button',{name:'Сепия'}));
 fireEvent.change(screen.getByLabelText('Размер текста'),{target:{value:'25'}});
 assert.equal(document.querySelector('.reader')?.getAttribute('data-theme'),'sepia');
 fireEvent.click(screen.getByRole('button',{name:'Поиск в документе'}));
 fireEvent.change(screen.getByLabelText('Найти в тексте'),{target:{value:'Спрос и предложение'}});
 fireEvent.click(screen.getByRole('button',{name:'Найти фрагмент'}));
 fireEvent.click(await screen.findByRole('button',{name:/Страница 2.*Спрос и предложение/s}));
 await screen.findByText('Страница 2 из 2 · Прогресс: 100%');
 fireEvent.click(screen.getByText('Ещё',{exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'Заметка к странице'}));
 fireEvent.change(screen.getByLabelText('Мысль или вопрос'),{target:{value:'Повторить определение спроса'}});
 fireEvent.click(screen.getByRole('button',{name:'Сохранить запись'}));
 await screen.findByText('Заметка сохранена в «Мои заметки».');
 await screen.findByText('Повторить определение спроса');
 const notes=await demoGateway.notes(item.id,0);assert.equal(notes.length,1);
 const {decodeReaderNote}=await import('../src/reader-tools');
 assert.equal(decodeReaderNote(notes[0].body)?.page,2);
 cleanup();const {NotesPanel}=await import('../src/NotesPanel');render(<NotesPanel api={demoGateway}/>);
 await screen.findByText('Повторить определение спроса');
 assert.ok(screen.getByText('Источник: Учебная книга · страница 2'));
 fireEvent.click(screen.getByRole('button',{name:'Редактировать заметку'}));
 fireEvent.change(screen.getByLabelText('Текст заметки'),{target:{value:'Дополненное определение'}});
 fireEvent.click(screen.getByRole('button',{name:'Сохранить заметку'}));
 await screen.findByText('Заметка сохранена.');
 const updated=(await demoGateway.notes(item.id,0))[0];
 assert.equal(decodeReaderNote(updated.body)?.text,'Дополненное определение');
 selectDemo('owner');assert.equal((await demoGateway.notes(item.id,0)).length,0);
 cleanup();selectDemo('student');render(<ReaderPanel api={demoGateway} item={item} onChanged={()=>{}}/>);
 await screen.findByText('Страница 2 из 2 · Прогресс: 100%');
 assert.equal(document.querySelector('.reader')?.getAttribute('data-theme'),'sepia');
 fireEvent.click(screen.getByRole('button',{name:'Настройки чтения'}));
 assert.equal((screen.getByLabelText('Размер текста') as HTMLInputElement).value,'25');
});

test('reader validates preferences, keeps document text literal and recognizes only linked note format',async()=>{
 const {readerPreferences,textOutline,findText,decodeReaderNote,encodeReaderNote}=await import('../src/reader-tools');
 assert.deepEqual(readerPreferences({theme:'invalid',fontSize:100,lineHeight:0,zoom:500}),{theme:'light',fontSize:32,lineHeight:1.4,zoom:200,font:'serif',column:72});
 assert.equal(readerPreferences(null).fontSize,20);
 assert.deepEqual(textOutline(['Глава 1. Начало\nТекст','## Глава 2. Продолжение']),[{title:'Глава 1. Начало',page:1,level:1},{title:'Глава 2. Продолжение',page:2,level:2}]);
 assert.equal(findText(['Без совпадений','Спрос И Предложение'],'спрос и предложение')[0].page,2);
 assert.equal(decodeReaderNote('{"sourceId":"x"}'),null);
 const n={sourceId:'id',sourceTitle:'Книга',page:2,quote:'<script>alert(1)</script>',text:'Моя мысль'};
 assert.deepEqual(decodeReaderNote(encodeReaderNote(n)),n);
});

test('legacy course reader isolates device progress and retains progress if storage is full',async()=>{
 const legacyApi={...demoGateway,courseReadingState:async()=>{throw Object.assign(Error('missing RPC'),{code:'PGRST202'});}};
 const {CourseReader}=await import('../src/CourseReader');
 resetDemo();selectDemo('owner');const snap=await demoGateway.snapshot(),course=snap.courses.find(c=>c.group_id==='g0')!;
 const file=Object.assign(new Blob(['Текст документа. '.repeat(400)],{type:'text/plain'}),{name:'course-reader.txt'});
 await demoGateway.saveMaterial(course.id,'lecture','Чтение курса','',file as File,null);
 const material=(await demoGateway.courseMaterials(course.id,'lecture',0)).items[0];
 selectDemo('student');render(<CourseReader api={legacyApi} material={material} onClose={()=>{}}/>);
 await screen.findByText('Страница 1 из 2 · Прогресс: 50%');
 fireEvent.click(screen.getByRole('button',{name:'Следующая страница'}));await screen.findByText('Страница 2 из 2 · Прогресс: 100%');
 fireEvent.click(screen.getByRole('button',{name:'Добавить закладку'}));await screen.findByRole('button',{name:'К странице 2'});
 cleanup();selectDemo('owner');render(<CourseReader api={legacyApi} material={material} onClose={()=>{}}/>);
 await screen.findByText('Страница 1 из 2 · Прогресс: 50%');assert.equal(screen.queryByRole('button',{name:'К странице 2'})===null,true);
 cleanup();selectDemo('student');
 const proto=Object.getPrototypeOf(localStorage),original=proto.setItem;
 proto.setItem=function(key:string,value:string){if(key.startsWith('studyhub-course-reading-v1:'))throw Error('QuotaExceeded');return original.call(this,key,value);};
 try{
  render(<CourseReader api={legacyApi} material={material} onClose={()=>{}}/>);await screen.findByText('Страница 2 из 2 · Прогресс: 100%');
  fireEvent.click(screen.getByRole('button',{name:'Предыдущая страница'}));await screen.findByText('Страница 1 из 2 · Прогресс: 50%');
  fireEvent.click(screen.getByRole('button',{name:'Закладки',exact:true}));fireEvent.click(screen.getByRole('button',{name:'К странице 2'}));await screen.findByText('Страница 2 из 2 · Прогресс: 100%');
  fireEvent.click(screen.getByRole('button',{name:'Убрать закладку'}));await waitFor(()=>assert.equal(screen.queryByRole('button',{name:'К странице 2'})===null,true));
  assert.equal(screen.queryByRole('button',{name:'К странице 2'})===null,true);
 }finally{proto.setItem=original;}
});

test('course account marks import legacy once and never overwrite newer account position',async()=>{
 const {courseReading}=await import('../src/course-reading');const {emptyReading}=await import('../src/reader-state');
 const item='migration-example',key='studyhub-course-reading-v1:student:'+item;let stored=emptyReading(item),writes=0;
 const api={...demoGateway,courseReadingState:async()=>structuredClone(stored),saveCourseReading:async next=>{assert.equal(next.version,stored.version);writes++;stored={...next,version:stored.version+1};return structuredClone(stored);}};
 localStorage.setItem(key,JSON.stringify({...emptyReading(item),page:3,total_pages:5,bookmarks:[2,3],version:4}));
 const first=courseReading(api,'student',item,()=>assert.fail('RPC exists'));
 assert.equal((await first.read()).page,3);assert.equal(writes,1);assert.equal(localStorage.getItem(key),null);
 // Another device has a stale local copy, but the account is authoritative.
 stored={...stored,page:4,version:2};localStorage.setItem(key,JSON.stringify({...stored,page:1,version:1}));
 const second=courseReading(api,'student',item,()=>assert.fail('RPC exists'));assert.equal((await second.read()).page,4);assert.equal(writes,1);
 await second.save({...await second.read(),page:5});assert.equal((await first.read()).page,5);
 localStorage.removeItem(key);
});

test('course reading never silently falls back after access or network errors',async()=>{
 const {courseReading}=await import('../src/course-reading');const {emptyReading}=await import('../src/reader-state');
 for(const code of ['42501','NETWORK','PGRST301']){
  const api={...demoGateway,courseReadingState:async()=>{throw Object.assign(Error('denied or offline'),{code});}};
  const reading=courseReading(api,'student','protected-document',()=>assert.fail('unexpected fallback'));
  await assert.rejects(()=>reading.read(),/denied or offline/);
 }
 const api={...demoGateway,courseReadingState:async()=>emptyReading('protected-document'),saveCourseReading:async()=>{throw Error('Network failed');}};
 const reading=courseReading(api,'student','protected-document',()=>assert.fail('unexpected fallback'));
 await reading.read();await assert.rejects(()=>reading.save({...emptyReading('protected-document'),total_pages:2}),/Network failed/);
});

test('demo course account marks are private, versioned and hidden after course denial',async()=>{
 resetDemo();selectDemo('owner');await demoGateway.saveMaterial('g0c0','lecture','Account reader','',Object.assign(new Blob(['text'],{type:'text/plain'}),{name:'read.txt'}) as File,null);
 const item=(await demoGateway.courseMaterials('g0c0','lecture',0)).items[0];
 selectDemo('student');const original=await demoGateway.courseReadingState(item.id);
 const saved=await demoGateway.saveCourseReading({...original,page:2,total_pages:3,bookmarks:[2]});assert.equal(saved.version,1);
 await assert.rejects(()=>demoGateway.saveCourseReading({...original,total_pages:3}),/Отметки изменены/);
 selectDemo('owner');assert.equal((await demoGateway.courseReadingState(item.id)).version,0);
 await demoGateway.deny('lectures','student',null,null);selectDemo('student');await assert.rejects(()=>demoGateway.courseReadingState(item.id),/Доступ к разделу закрыт/);
 selectDemo('owner');const s=await demoGateway.snapshot();await demoGateway.restore(s.denials[0].id);selectDemo('student');assert.equal((await demoGateway.courseReadingState(item.id)).page,2);
});

test('notebook opens both document sources at anchored page and keeps notes when source is gone',async()=>{
 const {NotesPanel}=await import('../src/NotesPanel');const {encodeReaderNote}=await import('../src/reader-tools');
 resetDemo();selectDemo('owner');const file=Object.assign(new Blob(['Учебный текст. '.repeat(450)],{type:'text/plain'}),{name:'source.txt'});
 await demoGateway.uploadLibrary('g0','Источник книги',file as File);await demoGateway.saveMaterial('g0c0','lecture','Источник лекции','',file as File,null);
 const book=(await demoGateway.library('',0)).items.find(b=>b.title==='Источник книги')!,material=(await demoGateway.courseMaterials('g0c0','lecture',0)).items[0];
 selectDemo('student');for(const item of [book,material])await demoGateway.saveNote('Запись '+item.title,encodeReaderNote({sourceId:item.id,sourceTitle:item.title,page:2,quote:'Учебный текст.',text:'Моя мысль'}),null,null);
 render(<NotesPanel api={demoGateway}/>);await screen.findByText('Запись Источник книги');
 for(const item of [book,material]){
  const card=screen.getByText('Запись '+item.title).closest('article')!;
  fireEvent.click(within(card).getByRole('button',{name:'Открыть источник · стр. 2'}));const dialog=await screen.findByRole('dialog',{name:item.title});await within(dialog).findByText('Страница 2 из 2 · Прогресс: 100%');
  fireEvent.click(within(dialog).getByRole('button',{name:'Закрыть просмотр'}));await waitFor(()=>assert.equal(screen.queryByRole('dialog')===null,true));
 }
 selectDemo('owner');await demoGateway.deleteLibrary(book.id);selectDemo('student');
 fireEvent.click(within(screen.getByText('Запись Источник книги').closest('article')!).getByRole('button',{name:'Открыть источник · стр. 2'}));await screen.findByText('Источник удалён, недоступен или не удалось подключиться. Сама заметка сохранена.');assert.equal((await demoGateway.notes(book.id,0)).length,1);
});

test('source resolution enforces section access and search highlights literal matching text',async()=>{
 const {highlightedText}=await import('../src/reader-tools');
 assert.deepEqual(highlightedText('Спрос, СПРОС и <script>','спрос'),[{text:'Спрос',match:true},{text:', ',match:false},{text:'СПРОС',match:true},{text:' и <script>',match:false}]);
 assert.equal(highlightedText('а'.repeat(1000),'а').filter(p=>p.match).length,200);
 resetDemo();selectDemo('owner');await demoGateway.deny('library','student',null,null);selectDemo('student');await assert.rejects(()=>demoGateway.readerSource('sample-note'),/Доступ к чтению закрыт/);
 resetDemo();selectDemo('owner');await demoGateway.saveMaterial('g0c0','lecture','Закрытый источник','',Object.assign(new Blob(['text'],{type:'text/plain'}),{name:'source.txt'}) as File,null);const m=(await demoGateway.courseMaterials('g0c0','lecture',0)).items[0];await demoGateway.deny('lectures','student',null,null);selectDemo('student');await assert.rejects(()=>demoGateway.readerSource(m.id),/Доступ к разделу закрыт/);
});

test('personal plan persists, hides from notes, enforces private ownership and optimistic version',async()=>{
 const {loadPlan,decodePlan}=await import('../src/personal-plan');
 resetDemo();selectDemo('student');
 const value={studyhub_plan:1,due:'2026-10-11',done:false,details:'Read chapter',link:null};
 await demoGateway.saveNote('Prepare seminar',JSON.stringify(value),null,null);
 const {tasks}=await loadPlan(demoGateway);assert.equal(tasks.length,1);
 const task=tasks[0];await demoGateway.saveTask(task.title,JSON.stringify({...value,done:true}),task.id,task.version);
 await assert.rejects(()=>demoGateway.saveTask(task.title,JSON.stringify(value),task.id,task.version));
 assert.equal((await loadPlan(demoGateway)).tasks[0].plan.done,true);
 selectDemo('owner');assert.equal((await loadPlan(demoGateway)).tasks.length,0);
 await assert.rejects(()=>demoGateway.deleteTask(task.id,2));
 assert.equal(decodePlan(JSON.stringify({...value,due:'2026-02-31'})),null);
 selectDemo('student');render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Студент',exact:true}));
 await screen.findByText('Мой план на сегодня');fireEvent.click(screen.getByRole('button',{name:'Мои заметки',exact:true}));
 await screen.findByText('Новая заметка');assert.equal(screen.queryByText('Prepare seminar'),null);
});
