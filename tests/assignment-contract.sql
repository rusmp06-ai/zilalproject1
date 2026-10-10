begin;
insert into auth.users(id) values
 ('00000000-0000-0000-0000-000000000401'),('00000000-0000-0000-0000-000000000402'),('00000000-0000-0000-0000-000000000403'),('00000000-0000-0000-0000-000000000404'),('00000000-0000-0000-0000-000000000405');
insert into public.profiles(id,full_name) select id,'Course test' from auth.users where id::text like '%00000000040_';
insert into public.platform_owners values('00000000-0000-0000-0000-000000000405');
insert into public.study_groups(id,name,created_by) values
 ('00000000-0000-0000-0000-000000000301','A','00000000-0000-0000-0000-000000000401'),
 ('00000000-0000-0000-0000-000000000302','B','00000000-0000-0000-0000-000000000401');
insert into public.group_memberships(group_id,user_id,role) values
 ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000401','leader'),
 ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000402','teacher'),
 ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000403','student'),
 ('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000404','student');
insert into public.courses(id,group_id,title) values
 ('00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-000000000301','Finance'),
 ('00000000-0000-0000-0000-000000000502','00000000-0000-0000-0000-000000000301','Unassigned');
insert into public.teaching_assignments(course_id,group_id,teacher_id) values('00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000402');
insert into auth.users(id) values('00000000-0000-0000-0000-000000000406');
insert into public.profiles(id,full_name) values('00000000-0000-0000-0000-000000000406','Other student');
insert into public.group_memberships(group_id,user_id,role) values('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000406','student');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',true);
do $$
declare c uuid:='00000000-0000-0000-0000-000000000501'; a uuid; old uuid; current_work uuid; path text; restriction uuid; expired uuid;
begin
 begin
  perform public.create_assignment(c,'Forbidden','',null,100,false);
  raise exception 'TEST FAILED: leader issues assignment';
 exception when raise_exception then if sqlerrm<>'Teacher required' then raise; end if; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000402',true);
 a:=public.create_assignment(c,'Financial analysis','Explain results',null,100,false);
 expired:=public.create_assignment(c,'Expired','',now()-interval '1 day',100,false);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000403',true);
 begin
  perform public.submit_work(expired,'Late');
  raise exception 'TEST FAILED: deadline ignored';
 exception when raise_exception then if sqlerrm<>'Deadline passed' then raise; end if; end;
 select submission_id into old from public.submit_work(a,'First attempt');
 begin
  perform public.submit_work(a,'Duplicate');
  raise exception 'TEST FAILED: duplicate submission';
 exception when raise_exception then if sqlerrm<>'Wait for review or return' then raise; end if; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000402',true);
 perform public.save_grade(old,70,'Private draft feedback',false);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000403',true);
 if exists(select 1 from public.grades where submission_id=old) then raise exception 'TEST FAILED: draft visible in table'; end if;
 if exists(select 1 from public.work_catalog(a) where score is not null or feedback is not null) then raise exception 'TEST FAILED: draft leaked in RPC'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000406',true);
 if exists(select 1 from public.submissions where id=old) or exists(select 1 from public.work_catalog(a)) then raise exception 'TEST FAILED: peer submission leaked'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',true);
 begin
  perform public.save_grade(old,99,'Leader grade',true);
  raise exception 'TEST FAILED: leader grades';
 exception when raise_exception then if sqlerrm<>'Teacher required' then raise; end if; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000402',true);
 perform public.return_submission(old,'Add calculations');
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000403',true);
 select submission_id,storage_path into current_work,path from public.submit_work(a,'Revised','work.txt','text/plain',4);
 insert into storage.objects(bucket_id,name,metadata) values('studyhub-submissions',path,'{"size":4,"mimetype":"text/plain"}');
 perform public.publish_submission(current_work);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000406',true);
 if exists(select 1 from storage.objects where name=path) then raise exception 'TEST FAILED: peer file leaked'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000402',true);
 if not exists(select 1 from storage.objects where name=path) then raise exception 'TEST FAILED: teacher cannot read work'; end if;
 begin
  perform public.save_grade(current_work,101,'Too high',true);
  raise exception 'TEST FAILED: invalid score accepted';
 exception when raise_exception then if sqlerrm<>'Invalid grade or status' then raise; end if; end;
 perform public.save_grade(current_work,90,'Good work',true);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000403',true);
 if not exists(select 1 from public.work_catalog(a) where id=current_work and score=90 and feedback='Good work') then raise exception 'TEST FAILED: published grade hidden'; end if;
 if (select count(*) from public.work_catalog(a))<>2 then raise exception 'TEST FAILED: attempt history lost'; end if;
 begin
  perform public.submit_work(a,'Change graded answer');
  raise exception 'TEST FAILED: graded answer replaced';
 exception when raise_exception then if sqlerrm<>'Wait for review or return' then raise; end if; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000405',true);
 restriction:=public.deny_section('assignments',null,'00000000-0000-0000-0000-000000000301');
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000403',true);
 if exists(select 1 from storage.objects where name=path) or exists(select 1 from public.grades where submission_id=current_work) then raise exception 'TEST FAILED: assignment restriction ignored'; end if;
 raise notice 'Assignment contract assertions passed';
end $$;
rollback;
