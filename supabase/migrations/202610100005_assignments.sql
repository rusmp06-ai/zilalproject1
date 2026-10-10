begin;
create table public.assignments (
 id uuid primary key default gen_random_uuid(),course_id uuid not null references public.courses(id),
 author_id uuid not null references public.profiles(id),title text not null check(length(trim(title)) between 1 and 200),
 description text not null check(length(description)<=50000),due_at timestamptz,
 max_score integer not null check(max_score between 1 and 1000),allow_late boolean not null default false,created_at timestamptz not null default now()
);
create table public.submissions (
 id uuid primary key default gen_random_uuid(),assignment_id uuid not null references public.assignments(id),student_id uuid not null references public.profiles(id),
 text_answer text not null check(length(text_answer)<=50000),file_id uuid references public.files(id),attempt_no integer not null check(attempt_no>0),
 status text not null check(status in ('uploading','submitted','returned','graded','deleting')),submitted_at timestamptz,is_late boolean not null default false,
 return_feedback text,unique(assignment_id,student_id,attempt_no)
);
create table public.grades (
 submission_id uuid primary key references public.submissions(id),graded_by uuid not null references public.profiles(id),
 score numeric not null check(score>=0),feedback text not null check(length(feedback)<=50000),released_at timestamptz,version integer not null default 1
);
create index submissions_by_assignment on public.submissions(assignment_id,student_id,attempt_no desc);
create function public.can_grade_course(c uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select public.is_owner() or (public.can_view_course(c) and exists(select 1 from public.courses x where x.id=c and public.has_section_access('assignments',x.group_id,c)
 and exists(select 1 from public.teaching_assignments t where t.course_id=c and t.teacher_id=auth.uid())));
$$;
create function public.can_read_assignment(a uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.assignments x join public.courses c on c.id=x.course_id where x.id=a and public.can_view_course(c.id) and public.has_section_access('assignments',c.group_id,c.id));
$$;
create function public.can_submit_assignment(a uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select public.can_read_assignment(a) and exists(select 1 from public.assignments x join public.courses c on c.id=x.course_id join public.group_memberships m on m.group_id=c.group_id
 where x.id=a and m.user_id=auth.uid() and m.active and m.role in ('student','leader'));
$$;
create function public.can_read_submission(s uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.submissions w join public.assignments a on a.id=w.assignment_id where w.id=s and public.can_read_assignment(a.id)
 and ((w.student_id=auth.uid()) or (public.can_grade_course(a.course_id) and w.status in ('submitted','returned','graded')) or public.is_owner()));
$$;
create function public.submission_file_access(path text,operation text) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.files f join public.submissions s on s.file_id=f.id where f.storage_path=path and case operation
 when 'read' then public.can_read_submission(s.id)
 when 'insert' then s.student_id=auth.uid() and s.status='uploading' and f.status='reserved' and public.can_submit_assignment(s.assignment_id)
 when 'delete' then s.status='deleting' and f.status='deleting' and public.can_read_assignment(s.assignment_id) and (s.student_id=auth.uid() or public.is_owner())
 else false end);
$$;
do $$ declare t text; begin foreach t in array array['assignments','submissions','grades'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);end loop;end $$;
create policy assignments_read on public.assignments for select to authenticated using(public.can_read_assignment(id));
create policy submissions_read on public.submissions for select to authenticated using(public.can_read_submission(id));
create policy grades_read on public.grades for select to authenticated using(exists(select 1 from public.submissions s join public.assignments a on a.id=s.assignment_id where s.id=submission_id and public.can_read_submission(s.id) and (public.can_grade_course(a.course_id) or (s.student_id=auth.uid() and released_at is not null))));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) select 'studyhub-submissions','studyhub-submissions',false,file_size_limit,allowed_mime_types from storage.buckets where id='studyhub-library';
create policy studyhub_submissions_read on storage.objects for select to authenticated using(bucket_id='studyhub-submissions' and public.submission_file_access(name,'read'));
create policy studyhub_submissions_insert on storage.objects for insert to authenticated with check(bucket_id='studyhub-submissions' and public.submission_file_access(name,'insert'));
create policy studyhub_submissions_delete on storage.objects for delete to authenticated using(bucket_id='studyhub-submissions' and public.submission_file_access(name,'delete'));

create function public.create_assignment(p_course uuid,p_title text,p_description text,p_due timestamptz,p_max integer,p_late boolean) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare id uuid;
begin
 if not public.can_grade_course(p_course) then raise exception 'Teacher required'; end if;
 insert into public.assignments(course_id,author_id,title,description,due_at,max_score,allow_late) values(p_course,auth.uid(),p_title,p_description,p_due,p_max,p_late) returning assignments.id into id;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'assignment.created',id);return id;
end $$;
create function public.submit_work(p_assignment uuid,p_text text,p_name text default null,p_mime text default null,p_size bigint default null)
returns table(submission_id uuid,storage_path text) language plpgsql security definer set search_path=pg_catalog as $$
declare a public.assignments%rowtype; previous public.submissions%rowtype; lim public.storage_limits%rowtype; fid uuid; sid uuid; path text; late boolean;
begin
 if not public.can_submit_assignment(p_assignment) then raise exception 'Student access required'; end if;
 if p_text is null or length(p_text)>50000 or (length(trim(p_text))=0 and p_name is null) then raise exception 'Answer or file required'; end if;
 perform pg_advisory_xact_lock(730041);
 perform pg_advisory_xact_lock(hashtextextended(p_assignment::text||auth.uid()::text,0));
 select * into a from public.assignments where id=p_assignment;
 late:=a.due_at is not null and now()>a.due_at;
 if late and not a.allow_late then raise exception 'Deadline passed'; end if;
 select * into previous from public.submissions where assignment_id=p_assignment and student_id=auth.uid() order by attempt_no desc limit 1 for update;
 if found and previous.status<>'returned' then raise exception 'Wait for review or return'; end if;
 if p_name is not null then
  select * into lim from public.storage_limits where singleton;
  if length(p_name) not between 1 and 240 or p_size is null or p_size<=0 or p_size>lim.file_limit_bytes then raise exception 'Invalid file size'; end if;
  if not coalesce((select p_mime=any(allowed_mime_types) from storage.buckets where id='studyhub-submissions'),false) then raise exception 'File type not allowed'; end if;
  if exists(select 1 from public.files where owner_id=auth.uid() and status='reserved') then raise exception 'Finish or delete previous upload'; end if;
  if public.library_usage_bytes()+lim.file_limit_bytes>lim.budget_bytes then raise exception 'Storage budget exceeded'; end if;
  fid:=gen_random_uuid();path:=auth.uid()::text||'/'||fid::text||'/content';
  insert into public.files(id,owner_id,storage_path,original_name,mime_type,size_bytes) values(fid,auth.uid(),path,p_name,p_mime,p_size);
 end if;
 insert into public.submissions(assignment_id,student_id,text_answer,file_id,attempt_no,status,submitted_at,is_late)
 values(p_assignment,auth.uid(),p_text,fid,coalesce(previous.attempt_no,0)+1,case when fid is null then 'submitted' else 'uploading' end,case when fid is null then now() end,late) returning id into sid;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'submission.created',sid);return query select sid,path;
end $$;
create function public.publish_submission(p_id uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare s public.submissions%rowtype; a public.assignments%rowtype; f public.files%rowtype; meta jsonb; late boolean;
begin
 perform pg_advisory_xact_lock(730041);select * into s from public.submissions where id=p_id for update;
 if not found or s.student_id<>auth.uid() or not public.can_submit_assignment(s.assignment_id) then raise exception 'Access denied'; end if;
 if s.status='submitted' then return; end if;
 if s.status<>'uploading' then raise exception 'Upload unavailable'; end if;
 select * into a from public.assignments where id=s.assignment_id;late:=a.due_at is not null and now()>a.due_at;
 if late and not a.allow_late then raise exception 'Deadline passed'; end if;
 select * into f from public.files where id=s.file_id;
 select metadata into meta from storage.objects where bucket_id='studyhub-submissions' and name=f.storage_path;
 if not found or meta is null or (meta->>'size') is null or (meta->>'size')::bigint<>f.size_bytes or (meta->>'mimetype') is distinct from f.mime_type then raise exception 'Uploaded file does not match reservation'; end if;
 update public.files set status='ready' where id=f.id;update public.submissions set status='submitted',submitted_at=now(),is_late=late where id=p_id;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'submission.submitted',p_id);
end $$;
create function public.save_grade(p_submission uuid,p_score numeric,p_feedback text,p_publish boolean) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare s public.submissions%rowtype; a public.assignments%rowtype;
begin
 select * into s from public.submissions where id=p_submission for update;select * into a from public.assignments where id=s.assignment_id;
 if s.id is null or not public.can_grade_course(a.course_id) then raise exception 'Teacher required'; end if;
 if s.status not in ('submitted','graded') or p_score is null or p_score<0 or p_score>a.max_score or p_publish is null then raise exception 'Invalid grade or status'; end if;
 insert into public.grades(submission_id,graded_by,score,feedback,released_at) values(p_submission,auth.uid(),p_score,p_feedback,case when p_publish then now() end)
 on conflict(submission_id) do update set graded_by=auth.uid(),score=excluded.score,feedback=excluded.feedback,released_at=excluded.released_at,version=grades.version+1;
 update public.submissions set status=case when p_publish then 'graded' else 'submitted' end where id=p_submission;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),case when p_publish then 'grade.published' else 'grade.draft_saved' end,p_submission);
end $$;
create function public.return_submission(p_id uuid,p_feedback text) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare s public.submissions%rowtype; c uuid;
begin
 select * into s from public.submissions where id=p_id for update;select course_id into c from public.assignments where id=s.assignment_id;
 if s.id is null or not public.can_grade_course(c) then raise exception 'Teacher required'; end if;
 if s.status<>'submitted' or p_feedback is null or length(trim(p_feedback)) not between 1 and 50000 then raise exception 'Invalid return'; end if;
 delete from public.grades where submission_id=p_id;
 update public.submissions set status='returned',return_feedback=p_feedback where id=p_id;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'submission.returned',p_id);
end $$;
create function public.begin_submission_cancel(p_id uuid) returns text language plpgsql security definer set search_path=pg_catalog as $$
declare s public.submissions%rowtype; path text;
begin
 perform pg_advisory_xact_lock(730041);select * into s from public.submissions where id=p_id for update;
 if not found or not public.can_read_assignment(s.assignment_id) or not(s.student_id=auth.uid() or public.is_owner()) then raise exception 'Access denied'; end if;
 if s.status not in ('uploading','deleting') then raise exception 'Only unfinished upload can be deleted'; end if;
 update public.submissions set status='deleting' where id=p_id;update public.files set status='deleting' where id=s.file_id returning storage_path into path;insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'submission.cancel_started',p_id);return path;
end $$;
create function public.finish_submission_cancel(p_id uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare s public.submissions%rowtype; path text;
begin
 perform pg_advisory_xact_lock(730041);select * into s from public.submissions where id=p_id for update;
 if not found or s.status<>'deleting' or not public.can_read_assignment(s.assignment_id) or not(s.student_id=auth.uid() or public.is_owner()) then raise exception 'Access denied'; end if;
 select storage_path into path from public.files where id=s.file_id;
 if exists(select 1 from storage.objects where bucket_id='studyhub-submissions' and name=path) then raise exception 'Remove object through Storage API first'; end if;
 delete from public.submissions where id=p_id;delete from public.files where id=s.file_id;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'submission.upload_cancelled',p_id);
end $$;
create function public.assignment_catalog(p_course uuid) returns setof public.assignments language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not public.can_view_course(p_course) or not exists(select 1 from public.courses c where c.id=p_course and public.has_section_access('assignments',c.group_id,c.id)) then raise exception 'Assignments access denied'; end if;
 return query select * from public.assignments a where a.course_id=p_course order by a.created_at desc,a.id limit 100;
end $$;
create function public.work_catalog(p_assignment uuid,p_offset integer default 0)
returns table(id uuid,student_id uuid,student_name text,text_answer text,attempt_no integer,status text,submitted_at timestamptz,is_late boolean,return_feedback text,storage_path text,original_name text,mime_type text,size_bytes bigint,score numeric,feedback text,released_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog as $$
declare grader boolean;
begin
 if not public.can_read_assignment(p_assignment) then raise exception 'Access denied'; end if;
 if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'Invalid page'; end if;
 select public.can_grade_course(a.course_id) into grader from public.assignments a where a.id=p_assignment;
 return query select s.id,s.student_id,p.full_name,s.text_answer,s.attempt_no,s.status,s.submitted_at,s.is_late,s.return_feedback,f.storage_path,f.original_name,f.mime_type,f.size_bytes,
 case when grader or g.released_at is not null then g.score end,case when grader or g.released_at is not null then g.feedback end,g.released_at
 from public.submissions s join public.profiles p on p.id=s.student_id left join public.files f on f.id=s.file_id left join public.grades g on g.submission_id=s.id
 where s.assignment_id=p_assignment and public.can_read_submission(s.id) order by s.attempt_no desc,s.submitted_at desc nulls first,s.id limit 50 offset p_offset;
end $$;
do $$ declare f record; begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('can_grade_course','can_read_assignment','can_submit_assignment','can_read_submission','submission_file_access','create_assignment','submit_work','publish_submission','save_grade','return_submission','begin_submission_cancel','finish_submission_cancel','assignment_catalog','work_catalog') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to authenticated',f.signature);end loop;end $$;
commit;
