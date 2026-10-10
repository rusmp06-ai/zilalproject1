begin;
insert into auth.users(id) select ('00000000-0000-0000-0000-00000000090'||n)::uuid from generate_series(1,4) n;
insert into public.profiles(id,full_name) select id,'Access user '||id from auth.users where id::text like '%00000000090_';
insert into public.platform_owners values('00000000-0000-0000-0000-000000000901');
insert into public.study_groups(id,name,created_by) values('00000000-0000-0000-0000-000000000911','A','00000000-0000-0000-0000-000000000901'),('00000000-0000-0000-0000-000000000912','B','00000000-0000-0000-0000-000000000901');
insert into public.group_memberships(group_id,user_id,role) values
 ('00000000-0000-0000-0000-000000000911','00000000-0000-0000-0000-000000000902','leader'),
 ('00000000-0000-0000-0000-000000000911','00000000-0000-0000-0000-000000000903','teacher'),
 ('00000000-0000-0000-0000-000000000912','00000000-0000-0000-0000-000000000903','teacher'),
 ('00000000-0000-0000-0000-000000000911','00000000-0000-0000-0000-000000000904','student');
insert into public.courses(id,group_id,title) values('00000000-0000-0000-0000-000000000921','00000000-0000-0000-0000-000000000911','A1'),('00000000-0000-0000-0000-000000000922','00000000-0000-0000-0000-000000000911','A2'),('00000000-0000-0000-0000-000000000923','00000000-0000-0000-0000-000000000912','B1');
insert into public.teaching_assignments(course_id,group_id,teacher_id) select id,group_id,'00000000-0000-0000-0000-000000000903' from public.courses where id::text like '%00000000092_';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000901',true);
do $$ declare a uuid; work uuid; note uuid; tok text; invitation uuid; owner_inv uuid; begin
 a:=public.create_assignment('00000000-0000-0000-0000-000000000921','Keep work','',null,100,false);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000904',true);
 select submission_id into work from public.submit_work(a,'Original answer');note:=public.save_private_note('Private','Keep note');
 if exists(select 1 from public.invitation_catalog()) or exists(select 1 from public.teaching_catalog('00000000-0000-0000-0000-000000000911')) then raise exception 'TEST FAILED: student sees administration'; end if;
 begin
  perform public.transfer_student(auth.uid(),'00000000-0000-0000-0000-000000000911','00000000-0000-0000-0000-000000000912');raise exception 'TEST FAILED: self transfer';
 exception when raise_exception then if sqlerrm<>'Owner required' then raise; end if; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000901',true);
 perform public.save_grade(work,80,'Keep grade',true);
 tok:=public.create_invitation('student','00000000-0000-0000-0000-000000000911');select id into owner_inv from public.invitation_catalog() limit 1;
 perform public.set_block(null,'00000000-0000-0000-0000-000000000912',true);
 begin
  perform public.transfer_student('00000000-0000-0000-0000-000000000904','00000000-0000-0000-0000-000000000911','00000000-0000-0000-0000-000000000912');raise exception 'TEST FAILED: blocked destination';
 exception when raise_exception then if sqlerrm<>'Destination group unavailable' then raise; end if; end;
 perform public.set_block(null,'00000000-0000-0000-0000-000000000912',false);
 perform public.transfer_student('00000000-0000-0000-0000-000000000904','00000000-0000-0000-0000-000000000911','00000000-0000-0000-0000-000000000912');
 if not exists(select 1 from public.submissions where id=work) or not exists(select 1 from public.grades where submission_id=work and score=80) then raise exception 'TEST FAILED: transfer lost work/grade'; end if;
 begin
  perform public.transfer_student('00000000-0000-0000-0000-000000000904','00000000-0000-0000-0000-000000000911','00000000-0000-0000-0000-000000000912');raise exception 'TEST FAILED: stale transfer';
 exception when raise_exception then if sqlerrm<>'Student membership changed. Refresh before transferring' then raise; end if; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000904',true);
 if public.can_view_course('00000000-0000-0000-0000-000000000921') or not public.can_view_course('00000000-0000-0000-0000-000000000923') or not exists(select 1 from public.note_catalog() where id=note) then raise exception 'TEST FAILED: transfer access/notes'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000902',true);
 begin
  perform public.revoke_invitation(owner_inv);raise exception 'TEST FAILED: leader revokes foreign invitation';
 exception when raise_exception then if sqlerrm<>'Access denied' then raise; end if; end;
 tok:=public.create_invitation('student','00000000-0000-0000-0000-000000000911');select id into invitation from public.invitation_catalog() limit 1;
 if (select count(*) from public.invitation_catalog())<>1 then raise exception 'TEST FAILED: foreign invitation catalog'; end if;
 perform public.revoke_invitation(invitation);
 begin
  perform public.remove_teaching_assignment('00000000-0000-0000-0000-000000000923','00000000-0000-0000-0000-000000000903');raise exception 'TEST FAILED: foreign group assignment';
 exception when raise_exception then if sqlerrm<>'Access denied' then raise; end if; end;
 perform public.remove_teaching_assignment('00000000-0000-0000-0000-000000000921','00000000-0000-0000-0000-000000000903');
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000903',true);
 if public.can_grade_course('00000000-0000-0000-0000-000000000921') or public.can_view_course('00000000-0000-0000-0000-000000000921') or not public.can_grade_course('00000000-0000-0000-0000-000000000922') or not public.can_grade_course('00000000-0000-0000-0000-000000000923') then raise exception 'TEST FAILED: independent teacher assignments'; end if;
 begin
  perform public.redeem_invitation(tok);raise exception 'TEST FAILED: revoked token accepted';
 exception when raise_exception then if sqlerrm<>'Invitation unavailable' then raise; end if; end;
end $$;
rollback;
