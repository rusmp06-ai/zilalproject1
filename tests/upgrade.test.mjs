import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
try {
 await db.exec(`create role anon; create role authenticated; create role service_role;
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

 const migrations=(await readdir(new URL('../supabase/migrations/',import.meta.url))).sort().slice(0,10);
 for(const file of migrations)await db.exec((await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;','-- built-in UUID/SHA256 in PGlite'));
 await db.exec(`insert into auth.users values('00000000-0000-0000-0000-000000003590');insert into public.profiles(id,full_name) values('00000000-0000-0000-0000-000000003590','Existing student');insert into public.private_notes(user_id,title,body) values('00000000-0000-0000-0000-000000003590','Existing note','Keep my text');`);
 const snapshot=async()=>JSON.stringify((await db.query('select * from public.private_notes order by id')).rows);
 const before=await snapshot();
 const upgrade=await readFile(new URL('../supabase/StudyHub_upgrade_to_v0.35.sql',import.meta.url),'utf8');
 await db.exec(upgrade);await db.exec(upgrade);assert.equal(await snapshot(),before);
 await db.exec(await readFile(new URL('./upload-recovery-contract.sql',import.meta.url),'utf8'));
 const search=await readFile(new URL('../supabase/StudyHub_update_v0.43.sql',import.meta.url),'utf8');await db.exec(search);await db.exec(search);assert.equal(await snapshot(),before);await db.exec(await readFile(new URL('./search-contract.sql',import.meta.url),'utf8'));
 console.log('PASS base 001-010 upgrades to v0.35 in one file, repeats safely, preserves existing notes and passes cancellation/visibility/quota contracts');
} finally {await db.close();}
