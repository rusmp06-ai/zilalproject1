begin;
insert into auth.users values('00000000-0000-0000-0000-000000000801'),('00000000-0000-0000-0000-000000000802');
insert into public.profiles(id,full_name) values('00000000-0000-0000-0000-000000000801','Student'),('00000000-0000-0000-0000-000000000802','Other');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000801',true);
do $$ declare id uuid; body text:='{"studyhub_plan":1,"due":"2026-10-15","done":false,"details":"Chapter","link":null}'; begin
 id:=public.save_private_task('Read',body);
 if (select count(*) from public.task_catalog())<>1 or (select count(*) from public.note_catalog())<>0 then raise exception 'Task separation failed'; end if;
 perform public.save_private_task('Read',body,id,1);
 begin perform public.save_private_task('Stale',body,id,1);raise exception 'Stale accepted';exception when raise_exception then if sqlerrm<>'Task unavailable or changed. Refresh before editing' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000802',true);
 if exists(select 1 from public.task_catalog()) then raise exception 'Private tasks exposed';end if;
 begin perform public.delete_private_task(id,2);raise exception 'Foreign delete accepted';exception when raise_exception then if sqlerrm<>'Task unavailable or changed. Refresh before deleting' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000801',true);
 begin perform public.save_private_task('Bad','{"studyhub_plan":1}');raise exception 'Invalid record accepted';exception when raise_exception then if sqlerrm<>'Invalid task record' then raise;end if;end;
 perform public.delete_private_task(id,2);
 if exists(select 1 from public.task_catalog()) then raise exception 'Delete failed';end if;
end $$;
rollback;
