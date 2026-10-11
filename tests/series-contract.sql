begin;
insert into auth.users values('00000000-0000-0000-0000-000000000901'),('00000000-0000-0000-0000-000000000902');
insert into public.profiles(id,full_name) values('00000000-0000-0000-0000-000000000901','Owner'),('00000000-0000-0000-0000-000000000902','Other');
insert into public.platform_owners values('00000000-0000-0000-0000-000000000901');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000901',true);
do $$ declare g uuid; ids uuid[]; begin
 g:=public.create_group('Series test');
 ids:=public.save_board_series(g,null,'Seminar','','204','2026-10-15T03:00Z','2026-10-15T04:00Z',4);
 if cardinality(ids)<>4 or (select max(starts_at)-min(starts_at) from public.group_board where id=any(ids))<>interval '21 days' then raise exception 'Repeat dates failed';end if;
 begin perform public.save_board_series(g,null,'Bad','','','2026-10-15T03:00Z','2026-10-15T02:00Z',4);raise exception 'Invalid series accepted';exception when raise_exception then if sqlerrm='Invalid series accepted' then raise;end if;end;
 if (select count(*) from public.group_board where group_id=g)<>4 then raise exception 'Partial series written';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000902',true);
 begin perform public.save_board_series(g,null,'Denied','','','2026-10-15T03:00Z','2026-10-15T04:00Z',2);raise exception 'Unauthorized series accepted';exception when raise_exception then if sqlerrm='Unauthorized series accepted' then raise;end if;end;
end $$;
rollback;
