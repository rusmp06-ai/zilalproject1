import {chromium} from 'playwright-core';
import {createClient} from '@supabase/supabase-js';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const artifacts=process.env.NOTES_TEST_ARTIFACTS||'/tmp/studyhub-notes-source';
await mkdir(artifacts,{recursive:true});
const live=process.env.NOTES_TEST_LIVE==='1',text='Глава 1. Учёба\n'+'Учебный материал. '.repeat(280)+'\nГлава 2. Повторение\nРедкий поисковый фрагмент.',prefix='Проверка источника '+Date.now();
let browser,page,client,stage='подготовка',failed=false;const files=[],notes=[];
const rpc=async(name,args={})=>{const {data,error}=await client.rpc(name,args);if(error)throw Error(name+': '+error.code);return data;};
try{
 if(live){
  for(const key of ['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','STUDYHUB_TEST_EMAIL','STUDYHUB_TEST_PASSWORD'])if(!process.env[key])throw Error('Missing '+key);
  client=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const {error}=await client.auth.signInWithPassword({email:process.env.STUDYHUB_TEST_EMAIL,password:process.env.STUDYHUB_TEST_PASSWORD});if(error)throw Error('Auth failed');
  const {data:courses,error:courseError}=await client.from('courses').select('id,group_id').eq('archived',false);if(courseError)throw Error('Courses unavailable');let course;
  for(const c of courses||[])if(await rpc('manage_course_material',{c:c.id,k:'lecture'})){course=c;break;}if(!course)throw Error('Test course required');
  const bytes=new TextEncoder().encode(text);
  for(const kind of ['library','course']){
   const args=kind==='library'?{p_group:course.group_id,p_title:prefix+' '+kind,p_name:'source.txt',p_mime:'text/plain',p_size:bytes.length}:{p_course:course.id,p_kind:'lecture',p_title:prefix+' '+kind,p_body:'Временный документ проверки заметок',p_name:'source.txt',p_mime:'text/plain',p_size:bytes.length};
   const [r]=await rpc(kind==='library'?'reserve_library_upload':'reserve_course_upload',args);files.push({...r,kind});
   const {error}=await client.storage.from('studyhub-'+(kind==='library'?'library':'courses')).upload(r.storage_path,bytes,{contentType:'text/plain',upsert:false});if(error)throw Error('Upload failed');await rpc(kind==='library'?'publish_library_upload':'publish_course_upload',{p_id:r.item_id});
   const id=await rpc('save_private_note',{p_title:prefix+' '+kind,p_body:JSON.stringify({studyhub_reader_note:1,sourceId:r.item_id,sourceTitle:prefix+' '+kind,page:2,quote:'Редкий поисковый фрагмент.',text:'Повторить к занятию'}),p_id:null,p_version:null});notes.push(id);
  }
 }
 stage='браузер и вход';browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});page=await browser.newPage({viewport:{width:1440,height:1000}});let errors=0;page.on('pageerror',()=>errors++);
 if(live){
  // Browser API requests use Node's verified environment proxy; tokens stay in memory.
  await page.route(process.env.VITE_SUPABASE_URL.replace(/\/$/,'')+'/**',async route=>{try{const req=route.request(),response=await fetch(req.url(),{method:req.method(),headers:req.headers(),body:['GET','HEAD'].includes(req.method())?undefined:req.postDataBuffer()});const headers=Object.fromEntries(response.headers);delete headers['content-encoding'];delete headers['content-length'];await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});}catch{await route.abort();}});
 }
 await page.goto(process.env.NOTES_TEST_URL||'http://127.0.0.1:5177/');
 if(live){await page.getByLabel('Email',{exact:true}).fill(process.env.STUDYHUB_TEST_EMAIL);await page.getByLabel('Пароль',{exact:true}).fill(process.env.STUDYHUB_TEST_PASSWORD);await page.getByRole('button',{name:'Войти',exact:true}).click();}
 else{
  await page.locator('.demo-roles').waitFor();await page.evaluate(async({text,prefix})=>{const d=await import('/src/demo.ts');d.resetDemo();d.selectDemo('owner');const file=new File([text],'source.txt',{type:'text/plain'});await d.demoGateway.uploadLibrary('g0',prefix+' library',file);await d.demoGateway.saveMaterial('g0c0','lecture',prefix+' course','',file,null);const book=(await d.demoGateway.library('',0)).items.find(i=>i.title===prefix+' library'),material=(await d.demoGateway.courseMaterials('g0c0','lecture',0)).items[0];d.selectDemo('student');for(const item of [book,material])await d.demoGateway.saveNote(item.title,JSON.stringify({studyhub_reader_note:1,sourceId:item.id,sourceTitle:item.title,page:2,quote:'Редкий поисковый фрагмент.',text:'Повторить к занятию'}),null,null);},{text,prefix});await page.getByRole('button',{name:'Студент',exact:true}).click();
 }
 await page.getByText('Ваше пространство',{exact:true}).waitFor();await page.getByRole('button',{name:'Мои заметки',exact:true}).click();
 for(const kind of ['library','course']){
  stage='открытие источника '+kind;const card=page.locator('article').filter({has:page.getByRole('heading',{name:prefix+' '+kind,exact:true})});const opener=card.getByRole('button',{name:'Открыть источник · стр. 2',exact:true});await opener.click();const dialog=page.getByRole('dialog',{name:prefix+' '+kind});await dialog.getByText('Страница 2 из 2 · Прогресс: 100%',{exact:true}).waitFor();
  stage='поиск и подсветка '+kind;await dialog.getByRole('button',{name:'Поиск в документе',exact:true}).click();await dialog.getByLabel('Найти в тексте',{exact:true}).fill('Редкий поисковый фрагмент');await dialog.getByRole('button',{name:'Найти фрагмент',exact:true}).click();await dialog.getByRole('button',{name:/Страница 2.*Редкий поисковый фрагмент/}).click();await dialog.locator('.reader-text mark').getByText('Редкий поисковый фрагмент',{exact:true}).waitFor();
  await page.screenshot({path:artifacts+'/'+kind+'-desktop.png'});await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>{const m=document.querySelector('.reader-text mark'),d=document.querySelector('.reader-document');if(!m||!d)return false;const a=m.getBoundingClientRect(),b=d.getBoundingClientRect();return a.top>=b.top&&a.bottom<=b.bottom;});await page.screenshot({path:artifacts+'/'+kind+'-mobile.png'});assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));await dialog.getByRole('button',{name:'Закрыть просмотр',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.textContent?.includes('Открыть источник'));await page.setViewportSize({width:1440,height:1000});
 }
 assert.equal(errors,0);console.log('PASS '+(live?'real Supabase':'demo')+': notebook → library/course page 2, search highlighting, mobile width, return focus; no browser errors');
}catch{failed=true;console.error('FAIL notes-source browser: '+stage+' (credential values omitted)');}
finally{
 if(live&&page)try{await page.evaluate(async()=>{const a=await import('/src/api.ts');await a.client?.auth.signOut({scope:'local'});});}catch{/* Disposable browser only. */}
 await browser?.close();
 if(client){
  for(const id of notes)try{await rpc('delete_private_note',{p_id:id,p_version:1});}catch{failed=true;console.error('Cleanup note incomplete; ID '+id);}
  for(const file of files)try{const path=await rpc(file.kind==='library'?'begin_library_delete':'begin_course_delete',{p_id:file.item_id});if(path){const {error}=await client.storage.from(file.kind==='library'?'studyhub-library':'studyhub-courses').remove([path]);if(error)throw Error('Storage cleanup');await rpc(file.kind==='library'?'finish_library_delete':'finish_course_delete',{p_id:file.item_id});}}catch{failed=true;console.error('Cleanup document incomplete; ID '+file.item_id);}
  await client.auth.signOut({scope:'local'});console.log('Temporary live notes/documents cleanup completed: '+!failed);
 }
 if(failed)process.exitCode=1;
}
