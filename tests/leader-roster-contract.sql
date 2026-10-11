begin;
insert into auth.users(id) select ('00000000-0000-0000-0000-00000000150'||n)::uuid from generate_series(1,4) n;
insert into public.profiles(id,full_name) select id,'Roster '||id from auth.users where id::text like '%00000000150_';
insert into public.platform_owners values('00000000-0000-0000-0000-000000001501');
insert into public.study_groups(id,name,created_by) values
 ('00000000-0000-0000-0000-000000001511','Roster A','00000000-0000-0000-0000-000000001501'),
 ('00000000-0000-0000-0000-000000001512','Roster B','00000000-0000-0000-0000-000000001501');
insert into public.group_memberships(group_id,user_id,role) values
 ('00000000-0000-0000-0000-000000001511','00000000-0000-0000-0000-000000001502','leader'),
 ('00000000-0000-0000-0000-000000001511','00000000-0000-0000-0000-000000001503','student'),
 ('00000000-0000-0000-0000-000000001512','00000000-0000-0000-0000-000000001504','student');
insert into public.courses(id,group_id,title) values('00000000-0000-0000-0000-000000001521','00000000-0000-0000-0000-000000001511','Leader learning');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001501',true);
do $$ declare a uuid; w uuid; begin
 a:=public.create_assignment('00000000-0000-0000-0000-000000001521','Student and leader answers','',null,100,false);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001503',true);
 perform public.submit_work(a,'Private student answer');
 begin perform public.group_member_catalog('00000000-0000-0000-0000-000000001511');raise exception 'TEST FAILED: student sees roster';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001502',true);
 if (select count(*) from public.group_member_catalog('00000000-0000-0000-0000-000000001511'))<>2 then raise exception 'TEST FAILED: own roster';end if;
 if (select count(*) from public.group_member_catalog('00000000-0000-0000-0000-000000001511',1))<>1 then raise exception 'TEST FAILED: roster offset';end if;
 begin perform public.group_member_catalog('00000000-0000-0000-0000-000000001512');raise exception 'TEST FAILED: foreign roster';exception when insufficient_privilege then null;end;
 select submission_id into w from public.submit_work(a,'Leader personal answer');
 if (select count(*) from public.work_catalog(a))<>1 then raise exception 'TEST FAILED: leader reads other work';end if;
 if public.can_grade_course('00000000-0000-0000-0000-000000001521') then raise exception 'TEST FAILED: leader grading';end if;
 perform public.save_private_note('Leader note','Private');
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001503',true);
 if exists(select 1 from public.private_notes where title='Leader note') then raise exception 'TEST FAILED: private note leak';end if;
end $$;
reset role;
update public.group_memberships set active=false where user_id='00000000-0000-0000-0000-000000001502';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001502',true);
do $$ begin
 begin perform public.group_member_catalog('00000000-0000-0000-0000-000000001511');raise exception 'TEST FAILED: revoked leader roster';exception when insufficient_privilege then null;end;
end $$;
rollback;
