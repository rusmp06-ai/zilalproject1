begin;
create function public.is_plan_record(body text) returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare p jsonb;
begin
 p:=body::jsonb;
 return coalesce(p->>'studyhub_plan'='1' and jsonb_typeof(p->'done')='boolean' and jsonb_typeof(p->'details')='string'
 and length(p->>'details')<=20000 and (p->'due'='null'::jsonb or (jsonb_typeof(p->'due')='string' and (p->>'due') ~ '^\d{4}-\d{2}-\d{2}$' and to_char((p->>'due')::date,'YYYY-MM-DD')=p->>'due'))
 and (p->'link'='null'::jsonb or (jsonb_typeof(p->'link')='object' and p->'link'->>'kind' in ('course','document','note') and length(p->'link'->>'id')>0 and jsonb_typeof(p->'link'->'title')='string')),false);
exception when others then return false;
end $$;

create table public.private_tasks (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),
 title text not null check(length(trim(title)) between 1 and 200),body text not null default '' check(length(body)<=50000),
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index tasks_by_user on public.private_tasks(user_id,updated_at desc,id);
alter table public.private_tasks enable row level security;
revoke all on public.private_tasks from anon,authenticated;
grant select on public.private_tasks to authenticated;
create policy notes_own on public.private_tasks for select to authenticated using(user_id=auth.uid() and public.is_active_user());
create function public.task_catalog(p_search text default '',p_offset integer default 0) returns setof public.private_tasks
language sql stable security definer set search_path=pg_catalog as $$
 select * from public.private_tasks n where n.user_id=auth.uid() and public.is_active_user()
 and (position(lower(coalesce(p_search,'')) in lower(n.title))>0 or position(lower(coalesce(p_search,'')) in lower(n.body))>0)
 order by n.updated_at desc,n.id limit 50 offset greatest(0,least(coalesce(p_offset,0),100000));
$$;
create function public.save_private_task(p_title text,p_body text,p_id uuid default null,p_version integer default null) returns uuid
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
create function public.delete_private_task(p_id uuid,p_version integer) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not public.is_active_user() then raise exception 'Access denied'; end if;
 delete from public.private_tasks where id=p_id and user_id=auth.uid() and version=p_version;
 if not found then raise exception 'Task unavailable or changed. Refresh before deleting'; end if;
end $$;
revoke all on function public.task_catalog(text,integer),public.save_private_task(text,text,uuid,integer),public.delete_private_task(uuid,integer) from public,anon;
grant execute on function public.task_catalog(text,integer),public.save_private_task(text,text,uuid,integer),public.delete_private_task(uuid,integer) to authenticated;
-- Move existing plan records without changing their IDs, versions or timestamps.
insert into public.private_tasks select * from public.private_notes where public.is_plan_record(body);
delete from public.private_notes where public.is_plan_record(body);
revoke all on function public.is_plan_record(text) from public,anon;
grant execute on function public.is_plan_record(text) to authenticated;
commit;
