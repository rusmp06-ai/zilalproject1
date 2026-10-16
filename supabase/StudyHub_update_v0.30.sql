begin;
-- Repeatable registration access update. Existing memberships are preserved.
create table if not exists public.group_access_requests(
 user_id uuid primary key references public.profiles(id),
 group_id uuid not null references public.study_groups(id),
 status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 created_at timestamptz not null default now()
);
alter table public.group_access_requests enable row level security;
alter table public.group_access_requests drop constraint if exists group_access_requests_status_check;
alter table public.group_access_requests add constraint group_access_requests_status_check check(status in ('pending','approved','rejected','cancelled'));
revoke all on public.group_access_requests from anon,authenticated;
create or replace function public.request_group_access(p_group uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not public.is_active_user() or not exists(select 1 from public.study_groups where id=p_group and not blocked) then raise exception 'Group unavailable';end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 if exists(select 1 from public.group_access_requests where user_id=auth.uid() and status='pending' and group_id<>p_group) then raise exception 'A request is already pending';end if;
 if exists(select 1 from public.group_memberships where user_id=auth.uid() and active) then raise exception 'Use owner to change existing membership';end if;
 if exists(select 1 from public.group_memberships where user_id=auth.uid() and group_id=p_group and not active) then raise exception 'Membership disabled';end if;
 insert into public.group_access_requests(user_id,group_id) values(auth.uid(),p_group)
 on conflict(user_id) do update set group_id=excluded.group_id,status='pending',created_at=now()
 where public.group_access_requests.status<>'pending';
end $$;
create or replace function public.join_group(p_group uuid) returns void language sql security definer set search_path=pg_catalog as $$select public.request_group_access(p_group)$$;
create or replace function public.group_request_catalog(p_group uuid default null,p_offset integer default 0)
returns table(user_id uuid,group_id uuid,full_name text,status text,created_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not public.is_active_user() or p_offset<0 then raise exception 'Unavailable';end if;
 if p_group is not null and not (public.is_owner() or public.is_group_leader(p_group)) then raise exception 'No rights';end if;
 return query select r.user_id,r.group_id,p.full_name,r.status,r.created_at from public.group_access_requests r join public.profiles p on p.id=r.user_id
 where (p_group is null and r.user_id=auth.uid()) or (r.group_id=p_group and r.status='pending' and not p.blocked and not exists(select 1 from public.group_memberships m where m.user_id=r.user_id and m.active))
 order by r.created_at,r.user_id limit 50 offset p_offset;
end $$;
create or replace function public.resolve_group_request(p_user uuid,p_group uuid,p_approve boolean) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not public.is_active_user() or not (public.is_owner() or public.is_group_leader(p_group)) or not exists(select 1 from public.study_groups where id=p_group and not blocked) then raise exception 'No rights';end if;
 -- Lock the account to serialize competing approvals, transfers and blocks.
 perform 1 from public.profiles where id=p_user and not blocked for update;
 if not found then raise exception 'Account unavailable';end if;
 perform 1 from public.group_access_requests where user_id=p_user and group_id=p_group and status='pending' for update;
 if not found then raise exception 'Request unavailable';end if;
 if p_approve then
  if exists(select 1 from public.group_memberships where user_id=p_user and active) then raise exception 'Account already has membership';end if;
  if exists(select 1 from public.group_memberships where user_id=p_user and group_id=p_group and not active) then raise exception 'Membership disabled';end if;
  insert into public.group_memberships(user_id,group_id,role) values(p_user,p_group,'student');
 end if;
 update public.group_access_requests set status=case when p_approve then 'approved' else 'rejected' end where user_id=p_user;
 insert into public.audit_events(actor_id,action,entity_id,details) values(auth.uid(),'student.request_resolved',p_user,jsonb_build_object('group_id',p_group,'approved',p_approve));
end $$;
revoke all on function public.request_group_access(uuid),public.join_group(uuid),public.group_request_catalog(uuid,integer),public.resolve_group_request(uuid,uuid,boolean) from public,anon;
grant execute on function public.request_group_access(uuid),public.join_group(uuid),public.group_request_catalog(uuid,integer),public.resolve_group_request(uuid,uuid,boolean) to authenticated;

create or replace function public.has_section_access(s text,g uuid default null,c uuid default null) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select public.is_active_user() and (public.is_owner() or (
 (g is null or public.is_group_member(g)) and
 -- New accounts may read the shared library; suspended memberships remain restricted.
 (g is not null or (s='library' and not exists(select 1 from public.group_memberships where user_id=auth.uid())) or exists(select 1 from public.group_memberships m where m.user_id=auth.uid() and m.active and public.is_group_member(m.group_id))) and
 not exists(select 1 from public.access_denials d where
 (d.user_id=auth.uid() or d.group_id=g or (g is null and d.group_id in (
 select group_id from public.group_memberships where user_id=auth.uid() and active)))
 and (d.section=s or (c is not null and d.section='course' and d.course_id=c)))
 ));
$$;

create or replace function public.cancel_group_request() returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not public.is_active_user() then raise exception 'Unavailable';end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 update public.group_access_requests set status='cancelled' where user_id=auth.uid() and status='pending';
end $$;
revoke all on function public.cancel_group_request() from public,anon;
grant execute on function public.cancel_group_request() to authenticated;

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

create or replace function public.active_teaching_course(c uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select public.is_active_user() and exists(select 1 from public.teaching_assignments t join public.group_memberships m on m.group_id=t.group_id and m.user_id=t.teacher_id and m.role='teacher' join public.courses x on x.id=t.course_id join public.study_groups g on g.id=x.group_id where t.teacher_id=auth.uid() and t.course_id=c and m.active and not x.archived and not g.blocked);
$$;
create or replace function public.can_grade_course(c uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select public.is_owner() or (public.active_teaching_course(c) and public.can_view_course(c) and exists(select 1 from public.courses x where x.id=c and public.has_section_access('assignments',x.group_id,c)));
$$;
create or replace function public.manage_course_material(c uuid,k public.content_kind) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select public.is_owner() or (k<>'assignment' and public.can_view_course(c) and exists(select 1 from public.courses x where x.id=c and public.has_section_access(public.content_section(k),x.group_id,c) and (public.is_group_leader(x.group_id) or public.active_teaching_course(c))));
$$;
create or replace function public.write_group_board(g uuid,c uuid,k text,a uuid default null) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select public.read_group_board(g,c,k) and (public.is_owner() or public.is_group_leader(g) or (k='announcement' and c is not null and (a is null or a=auth.uid()) and public.active_teaching_course(c)));
$$;
create table if not exists public.teacher_review_history(id uuid primary key default gen_random_uuid(),submission_id uuid not null references public.submissions(id) on delete cascade,actor_id uuid not null references public.profiles(id),action text not null check(action in ('draft','publish','return')),score numeric,previous_score numeric,previous_published boolean not null default false,created_at timestamptz not null default clock_timestamp());
alter table public.teacher_review_history enable row level security;
revoke all on public.teacher_review_history from public,anon,authenticated;
create index if not exists teacher_history_by_work on public.teacher_review_history(submission_id,created_at desc);
drop policy if exists grades_read on public.grades;
create policy grades_read on public.grades for select to authenticated using(exists(select 1 from public.submissions s join public.assignments a on a.id=s.assignment_id where s.id=submission_id and public.can_read_submission(s.id) and (public.is_owner() or public.can_grade_course(a.course_id) and s.student_id<>auth.uid() or s.student_id=auth.uid() and released_at is not null)));
alter table public.submissions add column if not exists assignment_snapshot jsonb;
create or replace function public.capture_assignment_snapshot() returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin select to_jsonb(a) into new.assignment_snapshot from public.assignments a where a.id=new.assignment_id;return new;end $$;
drop trigger if exists submission_assignment_snapshot on public.submissions;
create trigger submission_assignment_snapshot before insert on public.submissions for each row execute function public.capture_assignment_snapshot();
alter table public.submissions add column if not exists review_version integer not null default 1;
alter table public.assignments add column if not exists revision integer not null default 1;
create or replace function public.bump_review_version() returns trigger language plpgsql set search_path=pg_catalog as $$begin new.review_version:=old.review_version+1;return new;end $$;
drop trigger if exists submissions_review_version on public.submissions;
create trigger submissions_review_version before update on public.submissions for each row execute function public.bump_review_version();
create or replace function public.bump_assignment_revision() returns trigger language plpgsql set search_path=pg_catalog as $$begin new.revision:=old.revision+1;return new;end $$;
drop trigger if exists assignments_revision on public.assignments;
create trigger assignments_revision before update on public.assignments for each row execute function public.bump_assignment_revision();
create or replace function public.teacher_catalog() returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not public.is_active_user() then raise exception 'Account unavailable';end if;
 return coalesce((select jsonb_agg(to_jsonb(q) order by q.title,q.group_name,q.id) from (
 select c.id,c.group_id,c.title,c.archived,g.name as group_name,public.can_grade_course(c.id) as can_grade,
 case when public.can_grade_course(c.id) then (select count(*) from public.assignments a where a.course_id=c.id) end as assignment_count,
 case when public.can_grade_course(c.id) then (select count(*) from (select distinct on (s.assignment_id,s.student_id) s.status,s.student_id from public.submissions s join public.assignments a on a.id=s.assignment_id where a.course_id=c.id order by s.assignment_id,s.student_id,s.attempt_no desc) w where w.status='submitted' and w.student_id<>auth.uid()) end as pending,
 case when public.can_grade_course(c.id) then (select count(*) from (select distinct on (s.assignment_id,s.student_id) s.id,s.status,s.student_id from public.submissions s join public.assignments a on a.id=s.assignment_id where a.course_id=c.id order by s.assignment_id,s.student_id,s.attempt_no desc) w join public.grades r on r.submission_id=w.id where w.status='submitted' and r.released_at is null and w.student_id<>auth.uid()) end as drafts,
 case when public.can_grade_course(c.id) then (select count(distinct m.user_id) from public.group_memberships m join public.profiles p on p.id=m.user_id where m.group_id=c.group_id and m.active and m.role in ('student','leader') and not p.blocked) end as students
 from public.courses c join public.study_groups g on g.id=c.group_id where public.active_teaching_course(c.id) and public.can_view_course(c.id)
 ) q),'[]'::jsonb);
end $$;
create or replace function public.teacher_work_json(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 return (select to_jsonb(q) from (select s.id,s.student_id,(not p.blocked and exists(select 1 from public.group_memberships m join public.courses c on c.group_id=m.group_id where c.id=a.course_id and m.user_id=s.student_id and m.active and m.role in ('student','leader'))) as current_member,p.full_name as student_name,s.text_answer,s.attempt_no,s.status,s.submitted_at,s.is_late,s.return_feedback,s.review_version,f.storage_path,f.original_name,f.mime_type,f.size_bytes,case when s.student_id<>auth.uid() or r.released_at is not null or public.is_owner() then r.score end as score,case when s.student_id<>auth.uid() or r.released_at is not null or public.is_owner() then r.feedback end as feedback,r.released_at from public.submissions s join public.assignments a on a.id=s.assignment_id join public.profiles p on p.id=s.student_id left join public.files f on f.id=s.file_id left join public.grades r on r.submission_id=s.id where s.id=p_id and public.can_grade_course(a.course_id) and public.can_read_submission(s.id)) q);
end $$;
create or replace function public.teacher_review_queue(p_course uuid default null,p_assignment uuid default null,p_status text default 'pending',p_search text default '',p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 if not public.is_active_user() or p_status not in ('pending','draft','graded','returned','all') or p_search is null or length(p_search)>200 or p_offset is null or p_offset<0 then raise exception 'Invalid request';end if;
 if p_course is not null and not public.can_grade_course(p_course) then raise exception 'Teacher required';end if;
 if p_assignment is not null and not exists(select 1 from public.assignments where id=p_assignment and public.can_grade_course(course_id) and (p_course is null or course_id=p_course)) then raise exception 'Assignment unavailable';end if;
 with latest as (select distinct on (s.assignment_id,s.student_id) s.* from public.submissions s join public.assignments a on a.id=s.assignment_id where public.can_grade_course(a.course_id) and s.student_id<>auth.uid() and (p_course is null or a.course_id=p_course) and (p_assignment is null or a.id=p_assignment) order by s.assignment_id,s.student_id,s.attempt_no desc),
 eligible as (select s.id,s.assignment_id,s.student_id,(not p.blocked and exists(select 1 from public.group_memberships m where m.group_id=c.group_id and m.user_id=s.student_id and m.active and m.role in ('student','leader'))) as current_member,p.full_name as student_name,s.status,s.attempt_no,s.submitted_at,s.is_late,s.review_version,r.score,r.released_at,a.title as assignment_title,a.max_score,c.id as course_id,c.title as course_title,g.name as group_name from latest s join public.assignments a on a.id=s.assignment_id join public.courses c on c.id=a.course_id join public.study_groups g on g.id=c.group_id join public.profiles p on p.id=s.student_id left join public.grades r on r.submission_id=s.id where s.status in ('submitted','graded','returned') and (p_status='all' or p_status='pending' and s.status='submitted' or p_status='draft' and s.status='submitted' and r.score is not null and r.released_at is null or p_status='graded' and s.status='graded' or p_status='returned' and s.status='returned') and (p_search='' or position(lower(p_search) in lower(p.full_name||' '||a.title||' '||c.title||' '||g.name))>0)),
 page as (select * from eligible order by submitted_at nulls last,id limit 30 offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page) order by submitted_at nulls last,id) from page),'[]'::jsonb),'total',(select count(*) from eligible)) into result;
 return result;
end $$;
create or replace function public.teacher_submission_detail(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare s public.submissions%rowtype;a public.assignments%rowtype;latest uuid;history jsonb;
begin
 select * into s from public.submissions where id=p_id;select * into a from public.assignments where id=s.assignment_id;
 if not public.is_active_user() or s.id is null or not public.can_grade_course(a.course_id) or not public.can_read_submission(s.id) then raise exception 'Work unavailable';end if;
 select id into latest from public.submissions where assignment_id=s.assignment_id and student_id=s.student_id order by attempt_no desc limit 1;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.attempt_no desc),'[]') into history from (select id,attempt_no,status,submitted_at from public.submissions where assignment_id=s.assignment_id and student_id=s.student_id order by attempt_no desc limit 20) q;
 return jsonb_build_object('work',public.teacher_work_json(p_id),'assignment',coalesce(s.assignment_snapshot,to_jsonb(a)),'assignment_snapshot',s.assignment_snapshot is not null,'latest_id',latest,'can_review',s.id=latest and s.student_id<>auth.uid() and s.status in ('submitted','graded'),'history',history,'group_name',(select g.name from public.study_groups g join public.courses c on c.group_id=g.id where c.id=a.course_id),'course_title',(select title from public.courses where id=a.course_id));
end $$;
create or replace function public.teacher_assignment_roster(p_assignment uuid,p_search text default '',p_status text default 'all',p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare a public.assignments%rowtype;result jsonb;
begin
 select * into a from public.assignments where id=p_assignment;
 if not public.is_active_user() or a.id is null or not public.can_grade_course(a.course_id) or p_search is null or length(p_search)>200 or p_status is null or p_status not in ('all','not_submitted','submitted','returned','graded','uploading','deleting') or p_offset is null or p_offset<0 then raise exception 'Teacher required';end if;
 with students as (select distinct p.id as student_id,p.full_name as student_name from public.profiles p join public.group_memberships m on m.user_id=p.id join public.courses c on c.group_id=m.group_id where c.id=a.course_id and m.active and m.role in ('student','leader') and not p.blocked),
 eligible as (select p.*,case when s.status in ('submitted','graded','returned') or s.student_id=auth.uid() then s.id end as work_id,coalesce(s.status,'not_submitted') as status,s.attempt_no,s.submitted_at,s.is_late,case when p.student_id<>auth.uid() or r.released_at is not null or public.is_owner() then r.score end as score,r.released_at from students p left join lateral (select * from public.submissions w where w.assignment_id=p_assignment and w.student_id=p.student_id order by attempt_no desc limit 1) s on true left join public.grades r on r.submission_id=s.id where (p_search='' or position(lower(p_search) in lower(p.student_name))>0) and (p_status='all' or coalesce(s.status,'not_submitted')=p_status)),
 page as (select * from eligible order by student_name,student_id limit 30 offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page) order by student_name,student_id) from page),'[]'::jsonb),'total',(select count(*) from eligible)) into result;return result;
end $$;
create or replace function public.teacher_save_assignment(p_course uuid,p_title text,p_description text,p_due timestamptz,p_max integer,p_late boolean,p_id uuid default null,p_revision integer default null) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare a public.assignments%rowtype;
begin
 if not public.is_active_user() or not public.can_grade_course(p_course) then raise exception 'Teacher required';end if;
 if p_id is null then return public.create_assignment(p_course,p_title,p_description,p_due,p_max,p_late);end if;
 select * into a from public.assignments where id=p_id for update;
 if a.id is null or a.course_id<>p_course or p_revision is null or a.revision<>p_revision then raise exception 'Assignment changed; refresh before saving';end if;
 if p_max<>a.max_score and exists(select 1 from public.submissions where assignment_id=p_id) then raise exception 'Cannot change maximum after submissions';end if;
 update public.assignments set title=trim(p_title),description=p_description,due_at=p_due,max_score=p_max,allow_late=p_late where id=p_id;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'assignment.updated',p_id);return p_id;
end $$;
create or replace function public.teacher_review_submission(p_id uuid,p_version integer,p_action text,p_score numeric,p_feedback text) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare s public.submissions%rowtype;c uuid;old_score numeric;old_published boolean;
begin
 select * into s from public.submissions where id=p_id for update;select course_id into c from public.assignments where id=s.assignment_id;
 if not public.is_active_user() or s.id is null or not public.can_grade_course(c) or s.student_id=auth.uid() then raise exception 'Teacher required; self grading unavailable';end if;
 if p_version is null or s.review_version<>p_version or exists(select 1 from public.submissions where assignment_id=s.assignment_id and student_id=s.student_id and attempt_no>s.attempt_no) then raise exception 'Work changed; refresh before saving';end if;
 if s.status='graded' and p_action='draft' then raise exception 'Published grade cannot become draft';end if;
 select score,released_at is not null into old_score,old_published from public.grades where submission_id=p_id;
 if p_feedback is null or length(p_feedback)>50000 then raise exception 'Invalid feedback';end if;
 if p_action='return' then perform public.return_submission(p_id,p_feedback);
 elsif p_action in ('draft','publish') then perform public.save_grade(p_id,p_score,p_feedback,p_action='publish');
 else raise exception 'Unknown review action';end if;
 insert into public.teacher_review_history(submission_id,actor_id,action,score,previous_score,previous_published) values(p_id,auth.uid(),p_action,case when p_action='return' then null else p_score end,old_score,coalesce(old_published,false));
end $$;
revoke execute on function public.save_grade(uuid,numeric,text,boolean),public.return_submission(uuid,text) from authenticated,anon,public;
create or replace function public.teacher_submission_history(p_id uuid,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare s public.submissions%rowtype;c uuid;result jsonb;
begin
 select * into s from public.submissions where id=p_id;select course_id into c from public.assignments where id=s.assignment_id;
 if not public.is_active_user() or s.id is null or not public.can_grade_course(c) or not public.can_read_submission(s.id) or p_offset is null or p_offset<0 then raise exception 'Work unavailable';end if;
 with all_attempts as (select id,attempt_no,status,submitted_at from public.submissions where assignment_id=s.assignment_id and student_id=s.student_id), page as (select * from all_attempts order by attempt_no desc limit 20 offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page) order by attempt_no desc) from page),'[]'::jsonb),'total',(select count(*) from all_attempts)) into result;return result;
end $$;
revoke all on function public.teacher_submission_history(uuid,integer) from public,anon;
grant execute on function public.teacher_submission_history(uuid,integer) to authenticated;
create or replace function public.teacher_review_history_page(p_id uuid,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare s public.submissions%rowtype;c uuid;result jsonb;
begin
 select * into s from public.submissions where id=p_id;select course_id into c from public.assignments where id=s.assignment_id;
 if not public.is_active_user() or s.id is null or not public.can_grade_course(c) or not public.can_read_submission(s.id) or p_offset is null or p_offset<0 then raise exception 'Work unavailable';end if;
 with events as (select h.id,p.full_name as actor_name,h.action,h.score,case when s.student_id<>auth.uid() or public.is_owner() or h.previous_published then h.previous_score end as previous_score,h.created_at from public.teacher_review_history h join public.profiles p on p.id=h.actor_id where h.submission_id=p_id and (s.student_id<>auth.uid() or public.is_owner() or h.action<>'draft')),page as (select * from events order by created_at desc,id limit 20 offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id) from page),'[]'::jsonb),'total',(select count(*) from events)) into result;return result;
end $$;
revoke all on function public.teacher_review_history_page(uuid,integer) from public,anon;
grant execute on function public.teacher_review_history_page(uuid,integer) to authenticated;
-- Helpers remain private; public RPCs always check current permissions.
revoke all on function public.teacher_work_json(uuid),public.bump_review_version(),public.bump_assignment_revision(),public.capture_assignment_snapshot() from public,anon,authenticated;
revoke all on function public.active_teaching_course(uuid),public.teacher_catalog(),public.teacher_review_queue(uuid,uuid,text,text,integer),public.teacher_submission_detail(uuid),public.teacher_assignment_roster(uuid,text,text,integer),public.teacher_save_assignment(uuid,text,text,timestamptz,integer,boolean,uuid,integer),public.teacher_review_submission(uuid,integer,text,numeric,text) from public,anon;
grant execute on function public.active_teaching_course(uuid),public.teacher_catalog(),public.teacher_review_queue(uuid,uuid,text,text,integer),public.teacher_submission_detail(uuid),public.teacher_assignment_roster(uuid,text,text,integer),public.teacher_save_assignment(uuid,text,text,timestamptz,integer,boolean,uuid,integer),public.teacher_review_submission(uuid,integer,text,numeric,text) to authenticated;
create or replace function public.work_catalog(p_assignment uuid,p_offset integer default 0)
returns table(id uuid,student_id uuid,student_name text,text_answer text,attempt_no integer,status text,submitted_at timestamptz,is_late boolean,return_feedback text,storage_path text,original_name text,mime_type text,size_bytes bigint,score numeric,feedback text,released_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog as $$
declare grader boolean;
begin
 if not public.can_read_assignment(p_assignment) then raise exception 'Access denied'; end if;
 if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'Invalid page'; end if;
 select public.can_grade_course(a.course_id) into grader from public.assignments a where a.id=p_assignment;
 return query select s.id,s.student_id,p.full_name,s.text_answer,s.attempt_no,s.status,s.submitted_at,s.is_late,s.return_feedback,f.storage_path,f.original_name,f.mime_type,f.size_bytes,
 case when (grader and s.student_id<>auth.uid()) or public.is_owner() or g.released_at is not null then g.score end,case when (grader and s.student_id<>auth.uid()) or public.is_owner() or g.released_at is not null then g.feedback end,g.released_at
 from public.submissions s join public.profiles p on p.id=s.student_id left join public.files f on f.id=s.file_id left join public.grades g on g.submission_id=s.id
 where s.assignment_id=p_assignment and public.can_read_submission(s.id) order by s.attempt_no desc,s.submitted_at desc nulls first,s.id limit 50 offset p_offset;
end $$;
-- Teaching memberships do not consume the one registered learning group.
create or replace function public.redeem_invitation(p_token text) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare i public.invitations%rowtype;
begin
 if not public.is_active_user() then raise exception 'Access denied'; end if;
 select * into i from public.invitations where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
 if not found then raise exception 'Invitation unavailable'; end if;
 if i.revoked or i.expires_at<=now() then raise exception 'Invitation unavailable'; end if;
 -- The inviter must retain the authority used to create this link.
 if not exists(select 1 from public.profiles where id=i.created_by and not blocked) then raise exception 'Invitation unavailable'; end if;
 if i.role='leader' then
  if not exists(select 1 from public.platform_owners where user_id=i.created_by) then raise exception 'Invitation unavailable'; end if;
 else
  if not exists(select 1 from public.study_groups where id=i.group_id and not blocked) then raise exception 'Group unavailable'; end if;
  if not exists(select 1 from public.platform_owners where user_id=i.created_by) and not exists(
   select 1 from public.group_memberships where user_id=i.created_by and group_id=i.group_id and role='leader' and active) then raise exception 'Invitation unavailable'; end if;
 end if;
 if exists(select 1 from public.invitation_redemptions where invitation_id=i.id and user_id=auth.uid()) then return i.group_id; end if;
 if i.used_count>=i.max_uses then raise exception 'Invitation unavailable'; end if;
 if i.role='leader' then
  insert into public.leader_entitlements(user_id) values(auth.uid())
  on conflict(user_id) do update set available_groups=public.leader_entitlements.available_groups+1;
 else
  if i.role='student' and exists(select 1 from public.group_memberships where user_id=auth.uid() and active and role in ('student','leader') and group_id<>i.group_id) then raise exception 'Group change requires owner'; end if;
  -- An invitation cannot reactivate a membership removed by an administrator.
  if exists(select 1 from public.group_memberships where group_id=i.group_id and user_id=auth.uid() and role=i.role and not active) then raise exception 'Membership disabled'; end if;
  insert into public.group_memberships(group_id,user_id,role) values(i.group_id,auth.uid(),i.role) on conflict do nothing;
  if i.role='teacher' then
   if exists(select 1 from public.invitation_courses ic join public.courses c on c.id=ic.course_id where ic.invitation_id=i.id and (c.group_id<>i.group_id or c.archived)) then raise exception 'Course unavailable'; end if;
   insert into public.teaching_assignments(course_id,group_id,teacher_id)
   select course_id,i.group_id,auth.uid() from public.invitation_courses where invitation_id=i.id on conflict do nothing;
  end if;
 end if;
 insert into public.invitation_redemptions values(i.id,auth.uid(),now());
 update public.invitations set used_count=used_count+1 where id=i.id;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'invitation.redeemed',i.id);
 return i.group_id;
end $$;

create or replace function public.request_group_access(p_group uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not public.is_active_user() or not exists(select 1 from public.study_groups where id=p_group and not blocked) then raise exception 'Group unavailable';end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 if exists(select 1 from public.group_access_requests where user_id=auth.uid() and status='pending' and group_id<>p_group) then raise exception 'A request is already pending';end if;
 if exists(select 1 from public.group_memberships where user_id=auth.uid() and active and role in ('student','leader')) then raise exception 'Use owner to change existing membership';end if;
 if exists(select 1 from public.group_memberships where user_id=auth.uid() and group_id=p_group and role='student' and not active) then raise exception 'Membership disabled';end if;
 insert into public.group_access_requests(user_id,group_id) values(auth.uid(),p_group)
 on conflict(user_id) do update set group_id=excluded.group_id,status='pending',created_at=now()
 where public.group_access_requests.status<>'pending';
end $$;

create or replace function public.resolve_group_request(p_user uuid,p_group uuid,p_approve boolean) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not public.is_active_user() or not (public.is_owner() or public.is_group_leader(p_group)) or not exists(select 1 from public.study_groups where id=p_group and not blocked) then raise exception 'No rights';end if;
 -- Lock the account to serialize competing approvals, transfers and blocks.
 perform 1 from public.profiles where id=p_user and not blocked for update;
 if not found then raise exception 'Account unavailable';end if;
 perform 1 from public.group_access_requests where user_id=p_user and group_id=p_group and status='pending' for update;
 if not found then raise exception 'Request unavailable';end if;
 if p_approve then
  if exists(select 1 from public.group_memberships where user_id=p_user and active and role in ('student','leader')) then raise exception 'Account already has membership';end if;
  if exists(select 1 from public.group_memberships where user_id=p_user and group_id=p_group and role='student' and not active) then raise exception 'Membership disabled';end if;
  insert into public.group_memberships(user_id,group_id,role) values(p_user,p_group,'student');
 end if;
 update public.group_access_requests set status=case when p_approve then 'approved' else 'rejected' end where user_id=p_user;
 insert into public.audit_events(actor_id,action,entity_id,details) values(auth.uid(),'student.request_resolved',p_user,jsonb_build_object('group_id',p_group,'approved',p_approve));
end $$;


-- Gemini receives suggestions-only context; publication continues through existing RLS/RPC checks.
create or replace function public.can_publish_library_group(g uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select public.is_active_user() and exists(select 1 from public.study_groups where id=g and not blocked) and (public.is_owner() or public.has_section_access('library') and (public.is_group_leader(g) or exists(select 1 from public.courses c where c.group_id=g and public.active_teaching_course(c.id))));
$$;
create or replace function public.manage_library_item(p_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select public.is_owner() or exists(select 1 from public.library_items i where i.id=p_id and i.author_id=auth.uid() and public.can_publish_library_group(i.source_group_id));
$$;
create or replace function public.material_intake_context() returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 if not public.is_active_user() then raise exception 'Account unavailable';end if;
 select jsonb_build_object('courses',coalesce((select jsonb_agg(to_jsonb(q) order by q.group_name,q.title) from (
 select c.id,c.title,c.group_id,g.name as group_name,array_remove(array[
 case when public.manage_course_material(c.id,'lecture') then 'lecture' end,
 case when public.manage_course_material(c.id,'presentation') then 'presentation' end,
 case when public.manage_course_material(c.id,'material') then 'material' end,
 case when public.can_grade_course(c.id) and public.manage_course_material(c.id,'material') then 'assignment' end],null) as kinds
 from public.courses c join public.study_groups g on g.id=c.group_id where not c.archived and not g.blocked and (public.manage_course_material(c.id,'lecture') or public.manage_course_material(c.id,'presentation') or public.manage_course_material(c.id,'material'))
 )q),'[]'::jsonb),'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.name) from public.study_groups g where public.can_publish_library_group(g.id)),'[]'::jsonb)) into result;
 if jsonb_array_length(result->'courses')=0 and jsonb_array_length(result->'groups')=0 then raise exception 'Publisher required';end if;
 return result;
end $$;
create table if not exists public.material_ai_usage(user_id uuid not null references public.profiles(id),day date not null,requests integer not null check(requests>0),primary key(user_id,day));
alter table public.material_ai_usage enable row level security;
revoke all on public.material_ai_usage from public,anon,authenticated;
create or replace function public.begin_material_analysis() returns void language plpgsql security definer set search_path=pg_catalog as $$
declare today date:=(now() at time zone 'Asia/Bishkek')::date;used integer;
begin
 perform public.material_intake_context();perform pg_advisory_xact_lock(730049);
 select requests into used from public.material_ai_usage where user_id=auth.uid() and day=today;
 if coalesce(used,0)>=10 or (select coalesce(sum(requests),0) from public.material_ai_usage where day=today)>=100 then raise exception 'Analysis daily quota exceeded';end if;
 insert into public.material_ai_usage values(auth.uid(),today,1) on conflict(user_id,day) do update set requests=public.material_ai_usage.requests+1;
 delete from public.material_ai_usage where day<today-31;
end $$;
alter table public.assignments add column if not exists source_material_id uuid references public.course_content(id) on delete set null;
-- Assignment instructions belong to assignment access, including when general materials are denied.
create or replace function public.read_course_material(p_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.course_content i join public.courses c on c.id=i.course_id where i.id=p_id and public.can_view_course(c.id) and
 ((public.has_section_access(public.content_section(i.kind),c.group_id,c.id) and public.manage_course_material(c.id,i.kind)) or
 (i.published_at<=now() and (i.file_id is null or exists(select 1 from public.files f where f.id=i.file_id and f.status='ready')) and
 (public.has_section_access(public.content_section(i.kind),c.group_id,c.id) or exists(select 1 from public.assignments a where a.source_material_id=i.id and public.can_read_assignment(a.id))))));
$$;
-- The instruction attachment must not disappear through the ordinary material delete button.
create or replace function public.protect_assignment_source() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if exists(select 1 from public.assignments where source_material_id=old.id) then
  if TG_OP='DELETE' then raise exception 'Файл прикреплён к заданию. Его нельзя удалить как обычный материал.';end if;
  if new.file_id is distinct from old.file_id or new.published_at is null then raise exception 'Файл прикреплён к заданию. Его нельзя удалить как обычный материал.';end if;
 end if;
 if TG_OP='DELETE' then return old;end if;return new;
end $$;
revoke all on function public.protect_assignment_source() from public,anon,authenticated;
drop trigger if exists course_assignment_source_guard on public.course_content;
create trigger course_assignment_source_guard before update or delete on public.course_content for each row execute function public.protect_assignment_source();
create table if not exists public.material_intakes(request_id uuid primary key,user_id uuid not null references public.profiles(id),payload jsonb not null,item_id uuid not null,bucket text not null,path text not null,result_id uuid,created_at timestamptz not null default now());
alter table public.material_intakes enable row level security;
revoke all on public.material_intakes from public,anon,authenticated;
create or replace function public.prepare_material_intake(p_request uuid,p_kind text,p_course uuid,p_group uuid,p_title text,p_description text,p_due timestamptz,p_max integer,p_late boolean,p_name text,p_mime text,p_size bigint,p_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare payload jsonb;old public.material_intakes%rowtype;iid uuid;path text;bucket text;fid uuid;lim public.storage_limits%rowtype;
begin
 perform public.material_intake_context();perform pg_advisory_xact_lock(730041);
 if p_request is null or p_kind is null or p_kind not in ('lecture','presentation','material','assignment','book') or p_title is null or length(trim(p_title)) not between 1 and 200 or p_description is null or length(p_description)>50000 or p_hash is null or p_hash!~'^[a-f0-9]{64}$' then raise exception 'Invalid intake';end if;
 if p_kind='book' then if not public.can_publish_library_group(p_group) then raise exception 'Access denied';end if;
 else if p_course is null or not public.manage_course_material(p_course,(case when p_kind='assignment' then 'material' else p_kind end)::public.content_kind) then raise exception 'Access denied';end if;
 if p_kind='assignment' and (not public.can_grade_course(p_course) or length(trim(p_description))=0 or p_max is null or p_max not between 1 and 1000 or p_late is null) then raise exception 'Assignment unavailable';end if;end if;
 payload:=jsonb_build_object('kind',p_kind,'course',p_course,'group',p_group,'title',trim(p_title),'description',p_description,'due',p_due,'max',p_max,'late',p_late,'name',p_name,'mime',p_mime,'size',p_size,'hash',p_hash);
 select * into old from public.material_intakes where request_id=p_request;
 if found then
  if old.user_id<>auth.uid() or old.payload<>payload then raise exception 'Intake changed';end if;
  return jsonb_build_object('item_id',old.item_id,'path',old.path,'bucket',old.bucket,'published',old.result_id is not null,'result_id',old.result_id);
 end if;
 if p_kind='book' then
  -- Mirror library reservation invariants while allowing active teachers to publish their own books.
  select * into lim from public.storage_limits where singleton;
  if p_size is null or p_size<=0 or p_size>lim.file_limit_bytes or p_name is null or length(p_name) not between 1 and 240 or not coalesce((select p_mime=any(allowed_mime_types) from storage.buckets where id='studyhub-library'),false) then raise exception 'Invalid file';end if;
  if exists(select 1 from public.files where owner_id=auth.uid() and status='reserved') then raise exception 'Finish or delete previous upload';end if;
  if public.library_usage_bytes()+lim.file_limit_bytes>lim.budget_bytes then raise exception 'Storage budget exceeded';end if;
  fid:=gen_random_uuid();path:=auth.uid()::text||'/'||fid::text||'/content';
  insert into public.files(id,owner_id,storage_path,original_name,mime_type,size_bytes) values(fid,auth.uid(),path,p_name,p_mime,p_size);
  insert into public.library_items(title,author_id,source_group_id,file_id) values(trim(p_title),auth.uid(),p_group,fid) returning id into iid;bucket:='studyhub-library';
 else
  select r.item_id,r.storage_path into iid,path from public.reserve_course_upload(p_course,(case when p_kind='assignment' then 'material' else p_kind end)::public.content_kind,p_title,p_description,p_name,p_mime,p_size)r;bucket:='studyhub-courses';
 end if;
 insert into public.material_intakes(request_id,user_id,payload,item_id,bucket,path) values(p_request,auth.uid(),payload,iid,bucket,path);
 return jsonb_build_object('item_id',iid,'path',path,'bucket',bucket,'published',false,'result_id',null);
end $$;
create or replace function public.finish_material_intake(p_request uuid) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare job public.material_intakes%rowtype;result uuid;c uuid;
begin
 perform pg_advisory_xact_lock(730041);select * into job from public.material_intakes where request_id=p_request for update;
 if not found or job.user_id<>auth.uid() then raise exception 'Intake unavailable';end if;
 perform public.material_intake_context();
 if job.bucket='studyhub-library' then
  if not public.can_publish_library_group((job.payload->>'group')::uuid) then raise exception 'Access denied';end if;
 else
  c:=(job.payload->>'course')::uuid;
  if not public.manage_course_material(c,(case when job.payload->>'kind'='assignment' then 'material' else job.payload->>'kind' end)::public.content_kind) or (job.payload->>'kind'='assignment' and not public.can_grade_course(c)) then raise exception 'Access denied';end if;
 end if;
 if job.result_id is not null then return job.result_id;end if;
 if job.bucket='studyhub-library' then perform public.publish_library_upload(job.item_id);result:=job.item_id;
 else
  perform public.publish_course_upload(job.item_id);result:=job.item_id;
  if job.payload->>'kind'='assignment' then
   result:=public.create_assignment(c,job.payload->>'title',job.payload->>'description',(job.payload->>'due')::timestamptz,(job.payload->>'max')::integer,(job.payload->>'late')::boolean);
   update public.assignments set source_material_id=job.item_id where id=result;
  end if;
 end if;
 update public.material_intakes set result_id=result where request_id=p_request;
 insert into public.audit_events(actor_id,action,entity_id,details) values(auth.uid(),'material.intake_published',result,jsonb_build_object('kind',job.payload->>'kind','source',job.item_id));
 return result;
end $$;
do $$declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('can_publish_library_group','material_intake_context','begin_material_analysis','prepare_material_intake','finish_material_intake') loop execute 'revoke all on function '||f.signature||' from public,anon';execute 'grant execute on function '||f.signature||' to authenticated';end loop;end $$;
commit;
