begin;
create function public.transfer_student(p_user uuid,p_from uuid,p_to uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not public.is_owner() then raise exception 'Owner required'; end if;
 perform 1 from public.profiles where id=p_user for update;
 if not found then raise exception 'Student not found'; end if;
 if p_from is null or p_to is null or p_from=p_to then raise exception 'Choose a different group'; end if;
 perform 1 from public.study_groups where id=p_to and not blocked for share;
 if not found then raise exception 'Destination group unavailable'; end if;
 update public.group_memberships set active=false where user_id=p_user and group_id=p_from and role='student' and active;
 if not found then raise exception 'Student membership changed. Refresh before transferring'; end if;
 insert into public.group_memberships(group_id,user_id,role,active) values(p_to,p_user,'student',true)
 on conflict(group_id,user_id,role) do update set active=true;
 insert into public.audit_events(actor_id,action,entity_id,details) values(auth.uid(),'student.transferred',p_user,jsonb_build_object('from',p_from,'to',p_to));
end $$;
create function public.remove_teaching_assignment(p_course uuid,p_teacher uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare g uuid;
begin
 select group_id into g from public.courses where id=p_course;
 if not found or not(public.is_owner() or public.is_group_leader(g)) then raise exception 'Access denied'; end if;
 delete from public.teaching_assignments where course_id=p_course and teacher_id=p_teacher;
 if not found then raise exception 'Teaching assignment not found'; end if;
 insert into public.audit_events(actor_id,action,entity_id,details) values(auth.uid(),'teacher.unassigned',p_course,jsonb_build_object('teacher',p_teacher,'group',g));
end $$;
create function public.teaching_catalog(p_group uuid,p_offset integer default 0)
returns table(course_id uuid,teacher_id uuid,teacher_name text)
language sql stable security definer set search_path=pg_catalog as $$
 select a.course_id,a.teacher_id,p.full_name from public.teaching_assignments a join public.profiles p on p.id=a.teacher_id
 where a.group_id=p_group and (public.is_owner() or public.is_group_leader(p_group))
 order by p.full_name,a.course_id,a.teacher_id limit 50 offset greatest(0,least(coalesce(p_offset,0),100000));
$$;
create function public.invitation_catalog(p_offset integer default 0)
returns table(id uuid,role public.group_role,group_id uuid,expires_at timestamptz,max_uses integer,used_count integer,revoked boolean)
language sql stable security definer set search_path=pg_catalog as $$
 select i.id,i.role,i.group_id,i.expires_at,i.max_uses,i.used_count,i.revoked from public.invitations i
 where public.is_owner() or (i.created_by=auth.uid() and public.is_group_leader(i.group_id))
 order by i.expires_at desc,i.id limit 50 offset greatest(0,least(coalesce(p_offset,0),100000));
$$;
revoke all on function public.transfer_student(uuid,uuid,uuid),public.remove_teaching_assignment(uuid,uuid),public.teaching_catalog(uuid,integer),public.invitation_catalog(integer) from public,anon;
grant execute on function public.transfer_student(uuid,uuid,uuid),public.remove_teaching_assignment(uuid,uuid),public.teaching_catalog(uuid,integer),public.invitation_catalog(integer) to authenticated;
commit;
