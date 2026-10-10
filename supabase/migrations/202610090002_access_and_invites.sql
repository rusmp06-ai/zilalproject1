begin;
create unique index one_active_student_group on public.group_memberships(user_id) where role='student' and active;
-- All elevated functions have a fixed search_path and explicitly check auth.uid().
create table public.leader_entitlements (
 user_id uuid primary key references public.profiles(id),
 available_groups integer not null default 1 check(available_groups>=0)
);
alter table public.leader_entitlements enable row level security;
revoke all on public.leader_entitlements from anon,authenticated;
create table public.invitation_redemptions (
 invitation_id uuid not null references public.invitations(id),
 user_id uuid not null references public.profiles(id),
 redeemed_at timestamptz not null default now(),
 primary key(invitation_id,user_id)
);
alter table public.invitation_redemptions enable row level security;
revoke all on public.invitation_redemptions from anon,authenticated;

create function public.is_active_user() returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.profiles where id=auth.uid() and not blocked);
$$;
create function public.is_owner() returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select public.is_active_user() and exists(select 1 from public.platform_owners where user_id=auth.uid());
$$;
create function public.is_group_member(g uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select public.is_active_user() and exists(
 select 1 from public.group_memberships m join public.study_groups s on s.id=m.group_id
 where m.group_id=g and m.user_id=auth.uid() and m.active and not s.blocked);
$$;
create function public.is_group_leader(g uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select public.is_group_member(g) and exists(select 1 from public.group_memberships
 where group_id=g and user_id=auth.uid() and role='leader' and active);
$$;
create function public.has_section_access(s text,g uuid default null,c uuid default null) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select public.is_active_user() and (public.is_owner() or (
 (g is null or public.is_group_member(g)) and
 -- Personal library access requires at least one active, unblocked membership.
 (g is not null or exists(select 1 from public.group_memberships m where m.user_id=auth.uid() and m.active and public.is_group_member(m.group_id))) and
 not exists(select 1 from public.access_denials d where
 (d.user_id=auth.uid() or d.group_id=g or (g is null and d.group_id in (
 select group_id from public.group_memberships where user_id=auth.uid() and active)))
 and (d.section=s or (c is not null and d.section='course' and d.course_id=c)))
 ));
$$;
create function public.can_view_course(c uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select public.is_owner() or exists(select 1 from public.courses x
 where x.id=c and not x.archived and public.has_section_access('course',x.group_id,c)
 and (public.is_group_leader(x.group_id) or exists(select 1 from public.group_memberships m
 where m.group_id=x.group_id and m.user_id=auth.uid() and m.role='student' and m.active)
 or exists(select 1 from public.teaching_assignments a where a.course_id=c and a.teacher_id=auth.uid())));
$$;

-- Profiles can be created only for the authenticated identity. Protected columns are not writable.
grant select on public.profiles to authenticated;
grant insert(id,full_name) on public.profiles to authenticated;
grant update(full_name) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated
 using ((id=auth.uid() and not blocked) or public.is_owner());
create policy profiles_create on public.profiles for insert to authenticated
 with check(id=auth.uid() and not blocked);
create policy profiles_rename on public.profiles for update to authenticated
 using(id=auth.uid() and not blocked) with check(id=auth.uid() and not blocked);

grant select on public.study_groups,public.group_memberships,public.courses,public.teaching_assignments,public.library_items,public.course_content,public.access_denials,public.audit_events,public.leader_entitlements to authenticated;
create policy groups_read on public.study_groups for select to authenticated
 using(public.is_owner() or public.is_group_member(id));
create policy members_read on public.group_memberships for select to authenticated
 using(public.is_owner() or public.is_group_leader(group_id) or (user_id=auth.uid() and public.is_group_member(group_id)));
create policy courses_read on public.courses for select to authenticated using(public.can_view_course(id));
create policy teachers_read on public.teaching_assignments for select to authenticated
 using(public.is_owner() or public.is_group_leader(group_id) or (teacher_id=auth.uid() and public.can_view_course(course_id)));
create policy library_read on public.library_items for select to authenticated using(public.has_section_access('library'));
create policy content_read on public.course_content for select to authenticated
 using(public.can_view_course(course_id) and exists(select 1 from public.courses c where c.id=course_id
 and public.has_section_access(case kind when 'lecture' then 'lectures' when 'presentation' then 'presentations' when 'assignment' then 'assignments' else 'materials' end,c.group_id,c.id))
 and (published_at<=now() or public.is_owner() or exists(select 1 from public.courses c where c.id=course_id and public.is_group_leader(c.group_id))
 or exists(select 1 from public.teaching_assignments a where a.course_id=course_content.course_id and a.teacher_id=auth.uid())));
create policy denials_owner on public.access_denials for select to authenticated using(public.is_owner());
create policy audit_owner on public.audit_events for select to authenticated using(public.is_owner());
create policy entitlement_self on public.leader_entitlements for select to authenticated using(user_id=auth.uid() and public.is_active_user());
-- files/storage metadata and invitation hashes remain inaccessible to clients.

create function public.create_invitation(p_role public.group_role,p_group uuid default null,p_courses uuid[] default '{}',p_max_uses integer default 1,p_hours integer default 72)
returns text language plpgsql security definer set search_path=pg_catalog as $$
declare tok text; inv uuid; cid uuid;
begin
 if not public.is_active_user() then raise exception 'Access denied'; end if;
 if p_role='leader' then
  if not public.is_owner() or p_group is not null or cardinality(p_courses)>0 then raise exception 'Invalid leader invitation'; end if;
 else
  if p_group is null or not(public.is_owner() or public.is_group_leader(p_group)) then raise exception 'Access denied'; end if;
  if not exists(select 1 from public.study_groups where id=p_group and not blocked) then raise exception 'Group unavailable'; end if;
 end if;
 if p_max_uses is null or p_max_uses<1 or p_max_uses>60 or p_hours is null or p_hours<1 or p_hours>168 or p_courses is null then raise exception 'Invalid limits'; end if;
 if p_role<>'teacher' and cardinality(p_courses)>0 then raise exception 'Only teachers receive courses'; end if;
 if p_role='teacher' and (cardinality(p_courses)=0 or p_max_uses<>1) then raise exception 'Teacher invitation requires courses and one use'; end if;
 foreach cid in array p_courses loop
  if not exists(select 1 from public.courses where id=cid and group_id=p_group and not archived) then raise exception 'Course outside group'; end if;
 end loop;
 tok:=gen_random_uuid()::text || gen_random_uuid()::text;
 insert into public.invitations(token_hash,role,group_id,created_by,expires_at,max_uses)
 values(encode(sha256(convert_to(tok,'UTF8')),'hex'),p_role,p_group,auth.uid(),now()+make_interval(hours=>p_hours),p_max_uses) returning id into inv;
 insert into public.invitation_courses select inv,unnest(p_courses) on conflict do nothing;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'invitation.created',inv);
 return tok;
end $$;

create function public.redeem_invitation(p_token text) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare i public.invitations%rowtype;
begin
 if not public.is_active_user() then raise exception 'Access denied'; end if;
 select * into i from public.invitations where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
 if not found then raise exception 'Invitation unavailable'; end if;
 if i.revoked or i.expires_at<=now() then raise exception 'Invitation unavailable'; end if;
 -- The inviter must retain the authority used to create this link.
 if not exists(select 1 from public.profiles where id=i.created_by and not blocked) then raise exception 'Invitation unavailable'; end if;
 if i.role='leader' then
  if not exists(select 1 from public.platform_owners where user_id=i.created_by) then raise exception 'Invitation unavailable'; end if;
 else
  if not exists(select 1 from public.study_groups where id=i.group_id and not blocked) then raise exception 'Group unavailable'; end if;
  if not exists(select 1 from public.platform_owners where user_id=i.created_by) and not exists(
   select 1 from public.group_memberships where user_id=i.created_by and group_id=i.group_id and role='leader' and active) then raise exception 'Invitation unavailable'; end if;
 end if;
 if exists(select 1 from public.invitation_redemptions where invitation_id=i.id and user_id=auth.uid()) then return i.group_id; end if;
 if i.used_count>=i.max_uses then raise exception 'Invitation unavailable'; end if;
 if i.role='leader' then
  insert into public.leader_entitlements(user_id) values(auth.uid())
  on conflict(user_id) do update set available_groups=public.leader_entitlements.available_groups+1;
 else
  if i.role='student' and exists(select 1 from public.group_memberships where user_id=auth.uid() and active and group_id<>i.group_id) then raise exception 'Group change requires owner'; end if;
  -- An invitation cannot reactivate a membership removed by an administrator.
  if exists(select 1 from public.group_memberships where group_id=i.group_id and user_id=auth.uid() and role=i.role and not active) then raise exception 'Membership disabled'; end if;
  insert into public.group_memberships(group_id,user_id,role) values(i.group_id,auth.uid(),i.role) on conflict do nothing;
  if i.role='teacher' then
   if exists(select 1 from public.invitation_courses ic join public.courses c on c.id=ic.course_id where ic.invitation_id=i.id and (c.group_id<>i.group_id or c.archived)) then raise exception 'Course unavailable'; end if;
   insert into public.teaching_assignments(course_id,group_id,teacher_id)
   select course_id,i.group_id,auth.uid() from public.invitation_courses where invitation_id=i.id on conflict do nothing;
  end if;
 end if;
 insert into public.invitation_redemptions values(i.id,auth.uid(),now());
 update public.invitations set used_count=used_count+1 where id=i.id;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'invitation.redeemed',i.id);
 return i.group_id;
end $$;

create function public.create_group(p_name text) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare gid uuid;
begin
 if not public.is_active_user() then raise exception 'Access denied'; end if;
 if not public.is_owner() then
  update public.leader_entitlements set available_groups=available_groups-1 where user_id=auth.uid() and available_groups>0;
  if not found then raise exception 'Leader invitation required'; end if;
 end if;
 insert into public.study_groups(name,created_by) values(p_name,auth.uid()) returning id into gid;
 insert into public.group_memberships(group_id,user_id,role) values(gid,auth.uid(),'leader');
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'group.created',gid);
 return gid;
end $$;
create function public.create_course(p_group uuid,p_title text) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare cid uuid;
begin
 if not(public.is_owner() or public.is_group_leader(p_group)) then raise exception 'Access denied'; end if;
 insert into public.courses(group_id,title) values(p_group,p_title) returning id into cid;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'course.created',cid);
 return cid;
end $$;
create function public.join_group(p_group uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not public.is_active_user() or not exists(select 1 from public.study_groups where id=p_group and not blocked) then raise exception 'Group unavailable'; end if;
 if exists(select 1 from public.group_memberships where user_id=auth.uid() and active and group_id<>p_group) then raise exception 'Group change requires owner'; end if;
 if exists(select 1 from public.group_memberships where group_id=p_group and user_id=auth.uid() and role='student' and not active) then raise exception 'Membership disabled'; end if;
 insert into public.group_memberships(group_id,user_id,role) values(p_group,auth.uid(),'student') on conflict do nothing;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'student.joined',p_group);
end $$;
-- Minimal group directory for the agreed general signup; no membership data exposed.
create function public.signup_groups() returns table(id uuid,name text)
language sql stable security definer set search_path=pg_catalog as $$
 select id,name from public.study_groups where not blocked order by name;
$$;

create function public.set_block(p_user uuid default null,p_group uuid default null,p_blocked boolean default true) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not public.is_owner() then raise exception 'Owner required'; end if;
 if p_blocked is null or ((p_user is not null)::integer+(p_group is not null)::integer)<>1 then raise exception 'Select one target'; end if;
 if p_user is not null then
  if exists(select 1 from public.platform_owners where user_id=p_user) then raise exception 'Cannot block platform owner'; end if;
  update public.profiles set blocked=p_blocked where id=p_user;
 else update public.study_groups set blocked=p_blocked where id=p_group;
 end if;
 if not found then raise exception 'Target not found'; end if;
 insert into public.audit_events(actor_id,action,entity_id,details) values(auth.uid(),'access.block',coalesce(p_user,p_group),jsonb_build_object('blocked',p_blocked));
end $$;
create function public.deny_section(p_section text,p_user uuid default null,p_group uuid default null,p_course uuid default null,p_reason text default null) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare did uuid;
begin
 if not public.is_owner() then raise exception 'Owner required'; end if;
 if p_group is not null and p_course is not null and not exists(select 1 from public.courses where id=p_course and group_id=p_group) then raise exception 'Course outside group'; end if;
 insert into public.access_denials(user_id,group_id,section,course_id,reason,created_by) values(p_user,p_group,p_section,p_course,p_reason,auth.uid()) returning id into did;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'access.denied',did);
 return did;
end $$;
create function public.remove_denial(p_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not public.is_owner() then raise exception 'Owner required'; end if;
 delete from public.access_denials where id=p_id;
 if not found then raise exception 'Restriction not found'; end if;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'access.restored',p_id);
end $$;
create function public.revoke_invitation(p_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare i public.invitations%rowtype;
begin
 select * into i from public.invitations where id=p_id for update;
 if not found or not(public.is_owner() or (i.created_by=auth.uid() and public.is_group_leader(i.group_id))) then raise exception 'Access denied'; end if;
 update public.invitations set revoked=true where id=p_id;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'invitation.revoked',p_id);
end $$;

-- PostgreSQL functions default to PUBLIC EXECUTE. Remove it for every new function.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('is_active_user','is_owner','is_group_member','is_group_leader','has_section_access','can_view_course','create_invitation','redeem_invitation','create_group','create_course','join_group','signup_groups','set_block','deny_section','remove_denial','revoke_invitation') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
grant execute on function public.signup_groups() to anon;
commit;
