begin;
insert into auth.users values('00000000-0000-0000-0000-000000000901'),('00000000-0000-0000-0000-000000000902'),('00000000-0000-0000-0000-000000000903');
insert into public.profiles(id,full_name) values('00000000-0000-0000-0000-000000000901','Leader'),('00000000-0000-0000-0000-000000000902','New student'),('00000000-0000-0000-0000-000000000903','Stranger');
insert into public.study_groups(id,name,created_by) values('00000000-0000-0000-0000-000000000904','Requested group','00000000-0000-0000-0000-000000000901');
insert into public.group_memberships(user_id,group_id,role) values('00000000-0000-0000-0000-000000000901','00000000-0000-0000-0000-000000000904','leader');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000902',true);
select public.join_group('00000000-0000-0000-0000-000000000904');
select public.cancel_group_request();
do $$begin if exists(select 1 from public.group_request_catalog(null,0) where status='pending') then raise exception 'Cancelled request retained';end if;end $$;
select public.request_group_access('00000000-0000-0000-0000-000000000904');
do $$begin
 if not public.has_section_access('library') then raise exception 'Shared library unavailable';end if;
 if public.is_group_member('00000000-0000-0000-0000-000000000904') then raise exception 'Unapproved access';end if;
 if (select count(*) from public.group_request_catalog(null,0))<>1 then raise exception 'Missing request';end if;
 begin perform public.resolve_group_request('00000000-0000-0000-0000-000000000902','00000000-0000-0000-0000-000000000904',true);raise exception 'Self approval allowed';exception when raise_exception then if sqlerrm='Self approval allowed' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000903',true);
do $$begin
 if exists(select 1 from public.group_request_catalog(null,0)) then raise exception 'Other request visible';end if;
 begin perform public.group_request_catalog('00000000-0000-0000-0000-000000000904',0);raise exception 'Stranger catalog allowed';exception when raise_exception then if sqlerrm='Stranger catalog allowed' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000901',true);
select public.resolve_group_request('00000000-0000-0000-0000-000000000902','00000000-0000-0000-0000-000000000904',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000902',true);
do $$begin
 if not public.is_group_member('00000000-0000-0000-0000-000000000904') then raise exception 'Approval did not grant membership';end if;
 if (select status from public.group_request_catalog(null,0))<>'approved' then raise exception 'Approval status missing';end if;
end $$;
rollback;
