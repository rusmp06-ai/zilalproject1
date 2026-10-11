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
 for (const path of ['supabase/migrations/202610090001_foundation.sql','supabase/migrations/202610090002_access_and_invites.sql','supabase/migrations/202610090003_library.sql','supabase/migrations/202610100004_course_materials.sql','supabase/migrations/202610100005_assignments.sql','supabase/migrations/202610100006_group_board.sql','supabase/migrations/202610100007_private_notes.sql','supabase/migrations/202610100008_reader.sql','supabase/migrations/202610100009_access_management.sql','supabase/migrations/202610110010_course_reader.sql','tests/database-contract.sql','tests/library-contract.sql','tests/course-contract.sql','tests/assignment-contract.sql','tests/board-contract.sql','tests/notes-contract.sql','tests/reader-contract.sql','tests/access-management-contract.sql','tests/course-reader-contract.sql']) {
  const source=(await readFile(new URL('../'+path,import.meta.url),'utf8'))
   .replace('create extension if not exists pgcrypto;','-- PGlite provides built-in UUID and SHA256 functions.');
  await db.exec(source);
  console.log('PASS',path);
 }
} finally {await db.close();}
