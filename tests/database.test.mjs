import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const db=new PGlite();
try {
 await db.exec(`create role anon; create role authenticated;
 create schema storage;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated;
 grant select,insert,delete on storage.objects to authenticated;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon;
 grant execute on function auth.uid() to authenticated,anon;`);
 for (const path of ['supabase/migrations/202610090001_foundation.sql','supabase/migrations/202610090002_access_and_invites.sql','supabase/migrations/202610090003_library.sql','supabase/migrations/202610100004_course_materials.sql','supabase/migrations/202610100005_assignments.sql','supabase/migrations/202610100006_group_board.sql','supabase/migrations/202610100007_private_notes.sql','supabase/migrations/202610100008_reader.sql','supabase/migrations/202610100009_access_management.sql','supabase/migrations/202610110010_course_reader.sql','supabase/migrations/202610110011_private_tasks.sql','supabase/migrations/202610110012_epub.sql','supabase/migrations/202610110013_board_series.sql','supabase/migrations/202610110014_course_workspace.sql','supabase/migrations/202610110015_leader_roster.sql','tests/leader-roster-contract.sql','tests/owner-audit-contract.sql','tests/workspace-contract.sql','tests/series-contract.sql','tests/task-contract.sql','tests/database-contract.sql','tests/library-contract.sql','tests/course-contract.sql','tests/assignment-contract.sql','tests/board-contract.sql','tests/notes-contract.sql','tests/reader-contract.sql','tests/access-management-contract.sql','tests/course-reader-contract.sql','supabase/migrations/202610120016_registration_access.sql','tests/registration-contract.sql']) {
  if(path.endsWith('0011_private_tasks.sql'))await db.exec(`insert into auth.users values('00000000-0000-0000-0000-000000000811');insert into public.profiles(id,full_name) values('00000000-0000-0000-0000-000000000811','Migration fixture');insert into public.private_notes(id,user_id,title,body,version) values('00000000-0000-0000-0000-000000000812','00000000-0000-0000-0000-000000000811','Plan','{"studyhub_plan":1,"due":null,"done":false,"details":"","link":null}',7);`);
  const source=(await readFile(new URL('../'+path,import.meta.url),'utf8'))
   .replace('create extension if not exists pgcrypto;','-- PGlite provides built-in UUID and SHA256 functions.');
  await db.exec(source);
  if(path.endsWith('0011_private_tasks.sql'))await db.exec(`do $$ begin if not exists(select 1 from public.private_tasks where id='00000000-0000-0000-0000-000000000812' and version=7) or exists(select 1 from public.private_notes where id='00000000-0000-0000-0000-000000000812') then raise exception 'Migration lost task';end if;end $$;delete from public.private_tasks where id='00000000-0000-0000-0000-000000000812';`);
  console.log('PASS',path);
 }
 const bundle=await readFile(new URL('../supabase/StudyHub_update_v0.16.sql',import.meta.url),'utf8');
 const snapshot=async()=>JSON.stringify((await db.query('select id,user_id,title,body,version,created_at,updated_at from public.private_tasks order by id')).rows);
 await db.exec(`insert into auth.users values('00000000-0000-0000-0000-000000000821');insert into public.profiles(id,full_name) values('00000000-0000-0000-0000-000000000821','Repeat fixture');insert into public.private_tasks(user_id,title,body,version) values('00000000-0000-0000-0000-000000000821','Keep task','{"studyhub_plan":1,"due":null,"done":false,"details":"Keep body","link":null}',9);`);
 const before=await snapshot();await db.exec(bundle);await db.exec(bundle);
 if(await snapshot()!==before)throw Error('Repeated update modified existing tasks');
 console.log('PASS complete update repeated twice; existing task content, versions and timestamps preserved');
 const workspace=await readFile(new URL('../supabase/StudyHub_update_v0.20.sql',import.meta.url),'utf8');await db.exec(workspace);await db.exec(workspace);console.log('PASS workspace update can be repeated');
 const roster=await readFile(new URL('../supabase/StudyHub_update_v0.23.sql',import.meta.url),'utf8');await db.exec(roster);await db.exec(roster);console.log('PASS roster update can be repeated');
 const registration=await readFile(new URL('../supabase/StudyHub_update_v0.26.sql',import.meta.url),'utf8');await db.exec(registration);await db.exec(registration);console.log('PASS registration update can be repeated');
} finally {await db.close();}
