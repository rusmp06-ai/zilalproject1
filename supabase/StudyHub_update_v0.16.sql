-- StudyHub v0.16: update a database with migrations 001–010 already applied.
-- Safe to repeat; existing notes and tasks are preserved.

-- supabase/migrations/202610110011_private_tasks.sql
begin;
create or replace function public.is_plan_record(body text) returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare p jsonb;
begin
 p:=body::jsonb;
 return coalesce(p->>'studyhub_plan'='1' and jsonb_typeof(p->'done')='boolean' and jsonb_typeof(p->'details')='string'
 and length(p->>'details')<=20000 and (p->'due'='null'::jsonb or (jsonb_typeof(p->'due')='string' and (p->>'due') ~ '^\d{4}-\d{2}-\d{2}$' and to_char((p->>'due')::date,'YYYY-MM-DD')=p->>'due'))
 and (p->'link'='null'::jsonb or (jsonb_typeof(p->'link')='object' and p->'link'->>'kind' in ('course','document','note') and length(p->'link'->>'id')>0 and jsonb_typeof(p->'link'->'title')='string')),false);
exception when others then return false;
end $$;

create table if not exists public.private_tasks (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),
 title text not null check(length(trim(title)) between 1 and 200),body text not null default '' check(length(body)<=50000),
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists tasks_by_user on public.private_tasks(user_id,updated_at desc,id);
alter table public.private_tasks enable row level security;
revoke all on public.private_tasks from anon,authenticated;
grant select on public.private_tasks to authenticated;
drop policy if exists notes_own on public.private_tasks;
create policy notes_own on public.private_tasks for select to authenticated using(user_id=auth.uid() and public.is_active_user());
create or replace function public.task_catalog(p_search text default '',p_offset integer default 0) returns setof public.private_tasks
language sql stable security definer set search_path=pg_catalog as $$
 select * from public.private_tasks n where n.user_id=auth.uid() and public.is_active_user()
 and (position(lower(coalesce(p_search,'')) in lower(n.title))>0 or position(lower(coalesce(p_search,'')) in lower(n.body))>0)
 order by n.updated_at desc,n.id limit 50 offset greatest(0,least(coalesce(p_offset,0),100000));
$$;
create or replace function public.save_private_task(p_title text,p_body text,p_id uuid default null,p_version integer default null) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare result uuid; used_bytes bigint; replaced_bytes bigint;
begin
 if not public.is_active_user() then raise exception 'Access denied'; end if;
 if not public.is_plan_record(p_body) then raise exception 'Invalid task record'; end if;
 if p_title is null or length(trim(p_title)) not between 1 and 200 or p_body is null or length(p_body)>50000 then raise exception 'Invalid task'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,743));
 select coalesce(sum(octet_length(title)+octet_length(body)),0) into used_bytes from public.private_tasks where user_id=auth.uid();
 select coalesce((select octet_length(title)+octet_length(body) from public.private_tasks where id=p_id and user_id=auth.uid()),0) into replaced_bytes;
 if used_bytes-replaced_bytes+octet_length(trim(p_title))+octet_length(p_body)>1048576 then raise exception 'Personal tasks budget reached (1 MiB)'; end if;
 if p_id is null then
  if (select count(*) from public.private_tasks where user_id=auth.uid())>=1000 then raise exception 'Task limit reached'; end if;
  insert into public.private_tasks(user_id,title,body) values(auth.uid(),trim(p_title),p_body) returning id into result;
 else
  update public.private_tasks set title=trim(p_title),body=p_body,version=version+1,updated_at=clock_timestamp() where id=p_id and user_id=auth.uid() and version=p_version returning id into result;
  if not found then raise exception 'Task unavailable or changed. Refresh before editing'; end if;
 end if;
 return result;
end $$;
create or replace function public.delete_private_task(p_id uuid,p_version integer) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not public.is_active_user() then raise exception 'Access denied'; end if;
 delete from public.private_tasks where id=p_id and user_id=auth.uid() and version=p_version;
 if not found then raise exception 'Task unavailable or changed. Refresh before deleting'; end if;
end $$;
revoke all on function public.task_catalog(text,integer),public.save_private_task(text,text,uuid,integer),public.delete_private_task(uuid,integer) from public,anon;
grant execute on function public.task_catalog(text,integer),public.save_private_task(text,text,uuid,integer),public.delete_private_task(uuid,integer) to authenticated;
-- Move existing plan records without changing their IDs, versions or timestamps.
insert into public.private_tasks select * from public.private_notes where public.is_plan_record(body) on conflict (id) do nothing;
delete from public.private_notes n using public.private_tasks t where n.id=t.id and n.user_id=t.user_id and n.title=t.title and n.body=t.body and n.version=t.version and n.created_at=t.created_at and n.updated_at=t.updated_at and public.is_plan_record(n.body);
do $$ begin if exists(select 1 from public.private_notes where public.is_plan_record(body)) then raise exception 'Task migration conflict: existing task differs from note. No records were removed; contact support.';end if;end $$;
revoke all on function public.is_plan_record(text) from public,anon;
grant execute on function public.is_plan_record(text) to authenticated;
commit;

-- supabase/migrations/202610110012_epub.sql
begin;
update storage.buckets set allowed_mime_types=array_append(allowed_mime_types,'application/epub+zip') where id in ('studyhub-library','studyhub-courses') and not ('application/epub+zip'=any(allowed_mime_types));
create or replace function public.reserve_library_upload(p_group uuid,p_title text,p_name text,p_mime text,p_size bigint)
returns table(item_id uuid,storage_path text) language plpgsql security definer set search_path=pg_catalog as $$
declare fid uuid; iid uuid; path text; lim public.storage_limits%rowtype;
begin
 if not(public.is_owner() or (public.is_group_leader(p_group) and public.has_section_access('library'))) then raise exception 'Access denied'; end if;
 if not exists(select 1 from public.study_groups where id=p_group and not blocked) then raise exception 'Group unavailable'; end if;
 if p_size is null or p_size<=0 or p_name is null or length(p_name) not between 1 and 240 then raise exception 'Invalid file'; end if;
 if p_mime is null or p_mime<>all(array['application/epub+zip','application/pdf','text/plain','image/jpeg','image/png','image/webp',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) then raise exception 'File type not allowed'; end if;
 -- Serialize reservations globally; deletion/finalization also take this lock.
 perform pg_advisory_xact_lock(730041);
 select * into lim from public.storage_limits where singleton;
 if p_size>lim.file_limit_bytes then raise exception 'File exceeds 10 MB limit'; end if;
 if exists(select 1 from public.files where owner_id=auth.uid() and status='reserved') then raise exception 'Finish or delete previous upload'; end if;
 if public.library_usage_bytes()+lim.file_limit_bytes>lim.budget_bytes then raise exception 'Storage budget exceeded'; end if;
 fid:=gen_random_uuid(); path:=auth.uid()::text||'/'||fid::text||'/content';
 insert into public.files(id,owner_id,storage_path,original_name,mime_type,size_bytes)
 values(fid,auth.uid(),path,p_name,p_mime,p_size);
 insert into public.library_items(author_id,source_group_id,file_id,title)
 values(auth.uid(),p_group,fid,p_title) returning id into iid;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'library.reserved',iid);
 return query select iid,path;
end $$;
commit;

-- supabase/migrations/202610110013_board_series.sql
begin;
create or replace function public.save_board_series(p_group uuid,p_course uuid,p_title text,p_body text,p_location text,p_start timestamptz,p_end timestamptz,p_weeks integer) returns uuid[]
language plpgsql security definer set search_path=pg_catalog as $$
declare ids uuid[]:='{}'; i integer;
begin
 if p_weeks is null or p_weeks not between 1 and 16 or p_start is null or p_end is null then raise exception 'Invalid repeat';end if;
 for i in 0..p_weeks-1 loop
  ids:=array_append(ids,public.save_group_board(p_group,p_course,'schedule',p_title,p_body,p_location,p_start+i*interval '7 days',p_end+i*interval '7 days',null));
 end loop;
 return ids;
end $$;
revoke all on function public.save_board_series(uuid,uuid,text,text,text,timestamptz,timestamptz,integer) from public,anon;
grant execute on function public.save_board_series(uuid,uuid,text,text,text,timestamptz,timestamptz,integer) to authenticated;
commit;

