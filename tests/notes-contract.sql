begin;
insert into auth.users values('00000000-0000-0000-0000-000000000701'),('00000000-0000-0000-0000-000000000702');
insert into public.profiles(id,full_name) values('00000000-0000-0000-0000-000000000701','Student'),('00000000-0000-0000-0000-000000000702','Owner');
insert into public.platform_owners values('00000000-0000-0000-0000-000000000702');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000701',true);
do $$
declare n uuid;
begin
 n:=public.save_private_note('Finance','Private body');
 if (select count(*) from public.note_catalog('BODY'))<>1 then raise exception 'TEST FAILED: search'; end if;
 perform public.save_private_note('Finance revised','Private body',n,1);
 begin
  perform public.save_private_note('Stale','Overwrite',n,1);
  raise exception 'TEST FAILED: stale write';
 exception when raise_exception then if sqlerrm<>'Note unavailable or changed. Refresh before editing' then raise; end if; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000702',true);
 if exists(select 1 from public.private_notes) or exists(select 1 from public.note_catalog()) then raise exception 'TEST FAILED: owner reads personal note'; end if;
 begin
  perform public.delete_private_note(n,2);
  raise exception 'TEST FAILED: owner deletes foreign note';
 exception when raise_exception then if sqlerrm<>'Note unavailable or changed. Refresh before deleting' then raise; end if; end;
 perform public.set_block('00000000-0000-0000-0000-000000000701',null,true);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000701',true);
 if exists(select 1 from public.private_notes) then raise exception 'TEST FAILED: blocked user reads'; end if;
 begin
  perform public.save_private_note('Blocked','');
  raise exception 'TEST FAILED: blocked user writes';
 exception when raise_exception then if sqlerrm<>'Access denied' then raise; end if; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000702',true);
 perform public.set_block('00000000-0000-0000-0000-000000000701',null,false);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000701',true);
 if (select version from public.private_notes where id=n)<>2 then raise exception 'TEST FAILED: restoration loses data'; end if;
 begin
  update public.private_notes set body='Direct write' where id=n;
  raise exception 'TEST FAILED: direct update';
 exception when insufficient_privilege then null; end;
 perform public.delete_private_note(n,2);
 if exists(select 1 from public.note_catalog()) then raise exception 'TEST FAILED: delete'; end if;
 for i in 1..10 loop perform public.save_private_note('Large '||i,repeat('Я',50000)); end loop;
 begin
  perform public.save_private_note('Over budget',repeat('Я',50000));
  raise exception 'TEST FAILED: UTF8 budget exceeded';
 exception when raise_exception then if sqlerrm<>'Personal notes budget reached (1 MiB)' then raise; end if; end;
end $$;
rollback;
