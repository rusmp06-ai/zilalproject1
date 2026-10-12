begin;
create table if not exists public.announcement_reads(
 user_id uuid not null references public.profiles(id),
 announcement_id uuid not null references public.group_board(id) on delete cascade,
 read_at timestamptz not null default now(),
 primary key(user_id,announcement_id)
);
alter table public.announcement_reads enable row level security;
revoke all on public.announcement_reads from anon,authenticated;
create or replace function public.section_notification_counts() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare announcements bigint;overdue bigint;
begin
 if not public.is_active_user() then raise exception 'Account unavailable';end if;
 if public.is_owner() then return jsonb_build_object('user_id',auth.uid(),'announcements',0,'overdue',0);end if;
 select count(*) into announcements from public.group_board b
 where b.kind='announcement' and b.author_id<>auth.uid()
 and public.read_group_board(b.group_id,b.course_id,b.kind)
 and not exists(select 1 from public.announcement_reads r where r.user_id=auth.uid() and r.announcement_id=b.id);
 select count(*) into overdue from public.assignments a
 where a.due_at<now() and public.can_submit_assignment(a.id)
 and coalesce((select s.status from public.submissions s where s.assignment_id=a.id and s.student_id=auth.uid() order by s.attempt_no desc limit 1),'not_submitted') not in ('submitted','graded');
 return jsonb_build_object('user_id',auth.uid(),'announcements',announcements,'overdue',overdue);
end $$;
create or replace function public.unread_announcements(p_ids uuid[]) returns uuid[]
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not public.is_active_user() or p_ids is null or cardinality(p_ids)>50 then raise exception 'Unavailable';end if;
 return array(select b.id from public.group_board b where b.id=any(p_ids) and b.kind='announcement' and b.author_id<>auth.uid()
 and public.read_group_board(b.group_id,b.course_id,b.kind)
 and not exists(select 1 from public.announcement_reads r where r.user_id=auth.uid() and r.announcement_id=b.id));
end $$;
create or replace function public.mark_announcement_read(p_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not public.is_active_user() or not exists(select 1 from public.group_board b where b.id=p_id and b.kind='announcement' and public.read_group_board(b.group_id,b.course_id,b.kind)) then raise exception 'Announcement unavailable';end if;
 insert into public.announcement_reads(user_id,announcement_id) values(auth.uid(),p_id) on conflict do nothing;
end $$;
revoke all on function public.section_notification_counts(),public.unread_announcements(uuid[]),public.mark_announcement_read(uuid) from public,anon;
grant execute on function public.section_notification_counts(),public.unread_announcements(uuid[]),public.mark_announcement_read(uuid) to authenticated;
commit;
