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
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',true);
do $$
declare g uuid:='00000000-0000-0000-0000-000000000301'; c uuid:='00000000-0000-0000-0000-000000000501'; event uuid; notice uuid; restriction uuid;
begin
 event:=public.save_group_board(g,c,'schedule','Finance class','Bring notes','101','2026-10-10T03:00Z','2026-10-10T04:20Z');
 begin
  perform public.save_group_board('00000000-0000-0000-0000-000000000302',null,'announcement','Foreign group','','',null,null);
  raise exception 'TEST FAILED: foreign leader writes';
 exception when raise_exception then if sqlerrm<>'Access denied' then raise; end if; end;
 begin
  perform public.save_group_board(g,c,'schedule','Invalid','','','2026-10-10T04:00Z','2026-10-10T03:00Z');
  raise exception 'TEST FAILED: reversed interval';
 exception when raise_exception then if sqlerrm<>'Invalid board entry' then raise; end if; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000402',true);
 if public.write_group_board(g,c,'schedule') then raise exception 'TEST FAILED: teacher edits schedule'; end if;
 notice:=public.save_group_board(g,c,'announcement','Exam','Prepare chapters','',null,null);
 begin
  perform public.save_group_board(g,null,'announcement','Group wide','','',null,null);
  raise exception 'TEST FAILED: teacher group wide notice';
 exception when raise_exception then if sqlerrm<>'Access denied' then raise; end if; end;
 begin
  perform public.save_group_board(g,'00000000-0000-0000-0000-000000000502','announcement','Unassigned','','',null,null);
  raise exception 'TEST FAILED: unassigned teacher';
 exception when raise_exception then if sqlerrm<>'Access denied' then raise; end if; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000403',true);
 if (select count(*) from public.board_catalog(g,'schedule','2026-10-09T18:00Z','2026-10-16T18:00Z'))<>1 then raise exception 'TEST FAILED: student schedule'; end if;
 if exists(select 1 from public.board_catalog(g,'schedule','2026-10-10T04:20Z','2026-10-11T00:00Z')) then raise exception 'TEST FAILED: half open interval'; end if;
 if (select count(*) from public.group_board)<>2 then raise exception 'TEST FAILED: read RLS'; end if;
 begin
  perform public.delete_group_board(event);
  raise exception 'TEST FAILED: student delete';
 exception when raise_exception then if sqlerrm<>'Access denied' then raise; end if; end;
 begin
  update public.group_board set title='Direct write' where id=event;
  raise exception 'TEST FAILED: direct update';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000404',true);
 if exists(select 1 from public.group_board) then raise exception 'TEST FAILED: foreign student read'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000405',true);
 restriction:=public.deny_section('schedule',null,g);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000403',true);
 if exists(select 1 from public.board_catalog(g,'schedule')) or exists(select 1 from public.group_board where kind='schedule') then raise exception 'TEST FAILED: blocked schedule'; end if;
 if (select count(*) from public.board_catalog(g,'announcement'))<>1 then raise exception 'TEST FAILED: announcements separate'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000405',true);
 perform public.remove_denial(restriction);
 restriction:=public.deny_section('course',null,g,c);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000403',true);
 if exists(select 1 from public.group_board) then raise exception 'TEST FAILED: denied course leaks board'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000405',true);
 perform public.remove_denial(restriction);
 perform public.set_block(null,g,true);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000403',true);
 if exists(select 1 from public.group_board) then raise exception 'TEST FAILED: blocked group reads'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000405',true);
 perform public.set_block(null,g,false);
 perform public.save_group_board(g,c,'schedule','Updated','Bring notes','102','2026-10-10T03:00Z','2026-10-10T04:20Z',event);
 perform public.delete_group_board(event);
 if exists(select 1 from public.group_board where id=event) then raise exception 'TEST FAILED: owner delete'; end if;
end $$;
rollback;
