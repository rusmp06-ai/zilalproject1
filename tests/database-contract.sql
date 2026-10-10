-- Manual isolated integration test. Run ONLY on a throwaway Supabase database.
-- Existing migrated schema required. Entire fixture is rolled back.
begin;
insert into auth.users(id) values
 ('00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000002'),
 ('00000000-0000-0000-0000-000000000003'),
 ('00000000-0000-0000-0000-000000000004');
insert into public.profiles(id,full_name) values
 ('00000000-0000-0000-0000-000000000001','Owner'),
 ('00000000-0000-0000-0000-000000000002','Leader A'),
 ('00000000-0000-0000-0000-000000000003','Teacher'),
 ('00000000-0000-0000-0000-000000000004','Student');
insert into public.platform_owners values('00000000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
do $$
declare token text; g uuid; c uuid; teacher_token text; other_g uuid; other_c uuid;
begin
 other_g:=public.create_group('Other group');
 other_c:=public.create_course(other_g,'Other finance');
 token:=public.create_invitation('leader');
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
 perform public.redeem_invitation(token);
 perform public.redeem_invitation(token);
 g:=public.create_group('Test A');
 begin
  perform public.create_group('Forbidden second group');
  raise exception 'TEST FAILED: second group allowed';
 exception when raise_exception then
  if sqlerrm<>'Leader invitation required' then raise; end if;
 end;
 c:=public.create_course(g,'Finance');
 if exists(select 1 from public.study_groups where id=other_g) then raise exception 'TEST FAILED: foreign group visible through RLS'; end if;
 if exists(select 1 from public.courses where id=other_c) then raise exception 'TEST FAILED: foreign course visible through RLS'; end if;
 begin
  perform public.join_group(other_g);
  raise exception 'TEST FAILED: leader joined foreign group';
 exception when raise_exception then
  if sqlerrm<>'Group change requires owner' then raise; end if;
 end;
 begin
  perform public.create_invitation('teacher',g,array[other_c]);
  raise exception 'TEST FAILED: foreign course in invitation';
 exception when raise_exception then
  if sqlerrm<>'Course outside group' then raise; end if;
 end;
 teacher_token:=public.create_invitation('teacher',g,array[c]);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
 perform public.redeem_invitation(teacher_token);
 if not public.can_view_course(c) then raise exception 'TEST FAILED: teacher missing access'; end if;
 begin
  perform public.create_course(g,'Forbidden');
  raise exception 'TEST FAILED: teacher created course';
 exception when raise_exception then
  if sqlerrm<>'Access denied' then raise; end if;
 end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
 perform public.join_group(g);
 begin
  update public.profiles set blocked=true where id=auth.uid();
  raise exception 'TEST FAILED: protected profile column writable';
 exception when insufficient_privilege then null;
 end;
 begin
  insert into public.platform_owners(user_id) values(auth.uid());
  raise exception 'TEST FAILED: self elevation allowed';
 exception when insufficient_privilege then null;
 end;
 if not public.can_view_course(c) then raise exception 'TEST FAILED: student missing access'; end if;
 begin
  perform public.set_block(null,g,true);
  raise exception 'TEST FAILED: student blocked group';
 exception when raise_exception then
  if sqlerrm<>'Owner required' then raise; end if;
 end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 perform public.set_block(null,g,true);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
 if public.can_view_course(c) then raise exception 'TEST FAILED: blocked group accessible'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 perform public.set_block(null,g,false);
 perform public.deny_section('library',null,g);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
 if public.has_section_access('library') then raise exception 'TEST FAILED: group library denial ignored'; end if;
 if not public.can_view_course(c) then raise exception 'TEST FAILED: library denial blocked courses'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 perform public.remove_denial(id) from public.access_denials where group_id=g;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
 if not public.has_section_access('library') then raise exception 'TEST FAILED: library not restored'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 perform public.set_block('00000000-0000-0000-0000-000000000004',null,true);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
 if public.can_view_course(c) then raise exception 'TEST FAILED: blocked user accessible'; end if;
 raise notice 'Database contract assertions passed';
end $$;
rollback;
