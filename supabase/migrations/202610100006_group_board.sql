begin;
alter table public.access_denials drop constraint access_denials_section_check;
alter table public.access_denials add constraint access_denials_section_check check(section in ('library','lectures','presentations','materials','assignments','course','schedule','announcements'));
create table public.group_board (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.study_groups(id),
 course_id uuid references public.courses(id),
 kind text not null check(kind in ('schedule','announcement')),
 title text not null check(length(trim(title)) between 1 and 200),
 body text not null default '' check(length(body)<=10000),
 location text not null default '' check(length(location)<=200),
 starts_at timestamptz,
 ends_at timestamptz,
 author_id uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check((kind='schedule' and starts_at is not null and ends_at is not null and ends_at>starts_at) or (kind='announcement' and starts_at is null and ends_at is null))
);
create index board_by_group on public.group_board(group_id,kind,starts_at,created_at);
alter table public.group_board enable row level security;
revoke all on public.group_board from anon,authenticated;
grant select on public.group_board to authenticated;
create function public.read_group_board(g uuid,c uuid,k text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select k in ('schedule','announcement') and (public.is_owner() or (public.has_section_access(case k when 'schedule' then 'schedule' else 'announcements' end,g,c) and (c is null or public.can_view_course(c))));
$$;
create function public.write_group_board(g uuid,c uuid,k text,a uuid default null) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select public.read_group_board(g,c,k) and (public.is_owner() or public.is_group_leader(g) or
 (k='announcement' and c is not null and (a is null or a=auth.uid()) and exists(select 1 from public.teaching_assignments t where t.teacher_id=auth.uid() and t.group_id=g and t.course_id=c)));
$$;
create policy board_read on public.group_board for select to authenticated using(public.read_group_board(group_id,course_id,kind));
create function public.save_group_board(p_group uuid,p_course uuid,p_kind text,p_title text,p_body text,p_location text,p_start timestamptz,p_end timestamptz,p_id uuid default null) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare item public.group_board; result uuid;
begin
 if not public.write_group_board(p_group,p_course,p_kind) then raise exception 'Access denied'; end if;
 if not exists(select 1 from public.study_groups where id=p_group) or (p_course is not null and not exists(select 1 from public.courses where id=p_course and group_id=p_group)) then raise exception 'Course outside group'; end if;
 if p_title is null or length(trim(p_title)) not between 1 and 200 or p_body is null or length(p_body)>10000 or p_location is null or length(p_location)>200 or
 not ((p_kind='schedule' and p_start is not null and p_end is not null and p_end>p_start) or (p_kind='announcement' and p_start is null and p_end is null)) then raise exception 'Invalid board entry'; end if;
 if p_id is null then
  insert into public.group_board(group_id,course_id,kind,title,body,location,starts_at,ends_at,author_id) values(p_group,p_course,p_kind,trim(p_title),p_body,p_location,p_start,p_end,auth.uid()) returning id into result;
 else
  select * into item from public.group_board where id=p_id for update;
  if not found or item.group_id<>p_group or item.course_id is distinct from p_course or item.kind<>p_kind or not public.write_group_board(item.group_id,item.course_id,item.kind,item.author_id) then raise exception 'Access denied'; end if;
  update public.group_board set title=trim(p_title),body=p_body,location=p_location,starts_at=p_start,ends_at=p_end,updated_at=clock_timestamp() where id=p_id returning id into result;
 end if;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'board.saved',result);
 return result;
end $$;
create function public.delete_group_board(p_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare item public.group_board;
begin
 select * into item from public.group_board where id=p_id for update;
 if not found or not public.write_group_board(item.group_id,item.course_id,item.kind,item.author_id) then raise exception 'Access denied'; end if;
 delete from public.group_board where id=p_id;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'board.deleted',p_id);
end $$;
create function public.board_catalog(p_group uuid,p_kind text,p_from timestamptz default null,p_to timestamptz default null,p_offset integer default 0)
returns table(id uuid,group_id uuid,course_id uuid,kind text,title text,body text,location text,starts_at timestamptz,ends_at timestamptz,author_name text,created_at timestamptz,can_manage boolean)
language sql stable security definer set search_path=pg_catalog as $$
 select b.id,b.group_id,b.course_id,b.kind,b.title,b.body,b.location,b.starts_at,b.ends_at,p.full_name,b.created_at,public.write_group_board(b.group_id,b.course_id,b.kind,b.author_id)
 from public.group_board b join public.profiles p on p.id=b.author_id
 where b.group_id=p_group and b.kind=p_kind and public.read_group_board(b.group_id,b.course_id,b.kind)
 and (p_kind<>'schedule' or (p_from is null or b.ends_at>p_from) and (p_to is null or b.starts_at<p_to))
 order by case when p_kind='schedule' then b.starts_at end asc,b.created_at desc,b.id
 limit 50 offset greatest(0,least(coalesce(p_offset,0),100000));
$$;
revoke all on function public.read_group_board(uuid,uuid,text),public.write_group_board(uuid,uuid,text,uuid),public.save_group_board(uuid,uuid,text,text,text,text,timestamptz,timestamptz,uuid),public.delete_group_board(uuid),public.board_catalog(uuid,text,timestamptz,timestamptz,integer) from public,anon;
grant execute on function public.read_group_board(uuid,uuid,text),public.write_group_board(uuid,uuid,text,uuid),public.save_group_board(uuid,uuid,text,text,text,text,timestamptz,timestamptz,uuid),public.delete_group_board(uuid),public.board_catalog(uuid,text,timestamptz,timestamptz,integer) to authenticated;
commit;
