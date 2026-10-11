-- Scoped roster: a leader may read names and roles only for their own active group.
-- No private notes, submissions, email addresses or global profile access are granted.
begin;
create or replace function public.group_member_catalog(p_group uuid,p_offset integer default 0)
returns table(user_id uuid,full_name text,role public.group_role,active boolean)
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not public.is_active_user() or not (public.is_owner() or public.is_group_leader(p_group)) then
  raise exception 'Group leader required' using errcode='42501';
 end if;
 if p_offset is null or p_offset<0 then raise exception 'Invalid offset'; end if;
 return query select m.user_id,p.full_name,m.role,m.active
 from public.group_memberships m join public.profiles p on p.id=m.user_id
 where m.group_id=p_group
 order by p.full_name,m.user_id,m.role limit 50 offset p_offset;
end;
$$;
revoke all on function public.group_member_catalog(uuid,integer) from public,anon;
grant execute on function public.group_member_catalog(uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
