import {createClient} from '@supabase/supabase-js';
import assert from 'node:assert/strict';

export async function checkCourseSync({url,key,email,password},log=console.log){
 const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
 const clients=[createClient(url,key,options),createClient(url,key,options)];
 let item=null,stage='вход',failure=null;const tokens=[];
 const rpc=async(client,name,args={})=>{const {data,error}=await client.rpc(name,args);if(error)throw Error(`${name}: ${error.code||'request_failed'}`);return data;};
 try{
  for(const client of clients){const {data,error}=await client.auth.signInWithPassword({email,password});if(error||!data.session)throw Error('Вход не выполнен. Проверьте тестовый аккаунт и подтверждение email.');tokens.push(data.session.access_token);}
  if(tokens[0]===tokens[1])throw Error('Две независимые сессии не созданы.');
  const identities=await Promise.all(clients.map(async c=>{const {data,error}=await c.auth.getUser();if(error||!data.user)throw Error('Сессия не подтверждена.');return data.user.id;}));
  assert.equal(identities[0],identities[1]);log('PASS: две независимые сессии одного аккаунта');
  stage='профиль и выбор дисциплины';
  const {data:profile,error:profileError}=await clients[0].from('profiles').select('id').eq('id',identities[0]);
  if(profileError)throw Error('Профиль недоступен.');
  if(!profile?.length){const {error}=await clients[0].from('profiles').insert({id:identities[0],full_name:'Проверка StudyHub'});if(error)throw Error('Сначала завершите регистрацию тестового аккаунта в приложении.');}
  const {data:courses,error:courseError}=await clients[0].from('courses').select('id,title').eq('archived',false).order('id');
  if(courseError)throw Error('Каталог дисциплин недоступен.');
  let course;
  for(const candidate of courses||[]){if(await rpc(clients[0],'manage_course_material',{c:candidate.id,k:'lecture'})){course=candidate.id;break;}}
  // Empty owner test projects retain this clearly labelled fixture group/course for reuse.
  if(!course){
   if(!await rpc(clients[0],'is_owner'))throw Error('Для проверки загрузки нужен тестовый владелец/преподаватель с доступной дисциплиной.');
   const {data:groups,error}=await clients[0].from('study_groups').select('id,name').eq('name','Тест StudyHub');if(error)throw Error('Группы недоступны.');
   const group=groups?.[0]?.id||await rpc(clients[0],'create_group',{p_name:'Тест StudyHub'});
   course=await rpc(clients[0],'create_course',{p_group:group,p_title:'Проверка читалки'});
   log('Создана тестовая дисциплина «Проверка читалки»; группа/дисциплина остаются для следующих проверок.');
  }
  stage='загрузка тестового документа';
  const text='Страница проверки StudyHub.\n'.repeat(350),bytes=new TextEncoder().encode(text);
  const reservations=await rpc(clients[0],'reserve_course_upload',{p_course:course,p_kind:'lecture',p_title:'Проверка синхронизации '+new Date().toISOString(),p_body:'Временный файл автоматической проверки',p_name:'sync-check.txt',p_mime:'text/plain',p_size:bytes.length});
  item=reservations[0];if(!item?.item_id||!item.storage_path)throw Error('Резервирование файла не вернуло документ.');
  const {error:uploadError}=await clients[0].storage.from('studyhub-courses').upload(item.storage_path,bytes,{contentType:'text/plain',upsert:false});if(uploadError)throw Error('Storage: загрузка не выполнена.');
  await rpc(clients[0],'publish_course_upload',{p_id:item.item_id});
  const {data:blob,error:downloadError}=await clients[1].storage.from('studyhub-courses').download(item.storage_path);
  if(downloadError||!blob)throw Error('Storage: скачивание во второй сессии не выполнено.');assert.equal(await blob.text(),text);log('PASS: реальные байты Storage прочитаны второй сессией');
  stage='сохранение и восстановление отметок';
  const save=(client,page,marks,version)=>rpc(client,'save_course_reader_state',{p_item:item.item_id,p_page:page,p_total:3,p_favorite:false,p_bookmarks:marks,p_version:version});
  const saved=await save(clients[0],2,[1,2],0);
  const [second]=await rpc(clients[1],'course_reader_state',{p_item:item.item_id});
  assert.equal(second.page,2);assert.deepEqual(second.bookmarks,[1,2]);assert.equal(second.version,saved.version);
  const updated=await save(clients[1],3,[2,3],second.version);
  const [first]=await rpc(clients[0],'course_reader_state',{p_item:item.item_id});assert.equal(first.page,3);assert.deepEqual(first.bookmarks,[2,3]);assert.equal(first.version,updated.version);
  log('PASS: позиция и закладки переданы в обе стороны между сессиями');
  stage='конфликт устаревшей версии';
  const {error:conflict}=await clients[0].rpc('save_course_reader_state',{p_item:item.item_id,p_page:1,p_total:3,p_favorite:false,p_bookmarks:[],p_version:saved.version});
  assert.equal(conflict?.code,'P0001');assert.match(conflict.message,/Reading state changed/);
  const [intact]=await rpc(clients[1],'course_reader_state',{p_item:item.item_id});assert.equal(intact.page,3);assert.equal(intact.version,updated.version);log('PASS: устаревшая сессия не перезаписала новые отметки');
 }catch(e){failure=Error(`Проверка остановлена (${stage}): ${e.message}`);}
 finally{
  if(item){try{
   const path=await rpc(clients[0],'begin_course_delete',{p_id:item.item_id});
   if(path){const {error}=await clients[0].storage.from('studyhub-courses').remove([path]);if(error)throw Error('Storage cleanup failed');await rpc(clients[0],'finish_course_delete',{p_id:item.item_id});}
   const {data,error}=await clients[0].from('course_reader_states').select('item_id').eq('item_id',item.item_id);if(error)throw Error('State cleanup check failed');assert.equal(data.length,0);
   log('PASS: временный файл и его отметки удалены');
  }catch{log('ВНИМАНИЕ: не удалось завершить удаление временного материала; ID: '+item.item_id);failure||=Error('Удаление тестового материала требует проверки.');}}
  for(const c of clients)try{await c.auth.signOut({scope:'local'});}catch{/* Do not sign out other user sessions. */}
 }
 if(failure)throw failure;
}

if(import.meta.url===new URL(process.argv[1],'file:').href){
 const vars=['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','STUDYHUB_TEST_EMAIL','STUDYHUB_TEST_PASSWORD'];
 const missing=vars.filter(n=>!process.env[n]);
 if(missing.length){console.error('Проверка не запущена. Добавьте в настройки среды: '+missing.join(', '));process.exitCode=2;}
 else try{await checkCourseSync({url:process.env.VITE_SUPABASE_URL,key:process.env.VITE_SUPABASE_ANON_KEY,email:process.env.STUDYHUB_TEST_EMAIL,password:process.env.STUDYHUB_TEST_PASSWORD});}
 catch(e){console.error(e.message);process.exitCode=1;}
}
