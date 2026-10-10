begin;
alter table public.course_content add column created_at timestamptz not null default now();
create table public.course_uploads (
 content_id uuid primary key references public.course_content(id),
 status text not null default 'pending' check(status in ('pending','published','deleting'))
);
alter table public.course_uploads enable row level security;
revoke all on public.course_uploads from anon,authenticated;
create function public.content_section(k public.content_kind) returns text language sql immutable set search_path=pg_catalog as $$
 select case k when 'lecture' then 'lectures' when 'presentation' then 'presentations' when 'assignment' then 'assignments' else 'materials' end;
$$;
create function public.manage_course_material(c uuid,k public.content_kind) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select public.is_owner() or (k<>'assignment' and public.can_view_course(c) and exists(select 1 from public.courses x where x.id=c
 and public.has_section_access(public.content_section(k),x.group_id,c)
 and (public.is_group_leader(x.group_id) or exists(select 1 from public.teaching_assignments a where a.course_id=c and a.teacher_id=auth.uid()))));
$$;
create function public.read_course_material(p_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.course_content i join public.courses c on c.id=i.course_id where i.id=p_id and
 public.can_view_course(c.id) and public.has_section_access(public.content_section(i.kind),c.group_id,c.id)
 and (public.manage_course_material(c.id,i.kind) or (i.published_at<=now() and
 (i.file_id is null or exists(select 1 from public.files f where f.id=i.file_id and f.status='ready')))));
$$;
create function public.course_file_access(p_path text,p_operation text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.files f join public.course_content i on i.file_id=f.id join public.course_uploads u on u.content_id=i.id
 where f.storage_path=p_path and case p_operation
 when 'read' then public.read_course_material(i.id)
 when 'insert' then f.owner_id=auth.uid() and f.status='reserved' and u.status='pending' and public.manage_course_material(i.course_id,i.kind)
 when 'delete' then f.status='deleting' and u.status='deleting' and public.manage_course_material(i.course_id,i.kind)
 else false end);
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
select 'studyhub-courses','studyhub-courses',false,file_size_limit,allowed_mime_types from storage.buckets where id='studyhub-library';
create policy studyhub_courses_read on storage.objects for select to authenticated using(bucket_id='studyhub-courses' and public.course_file_access(name,'read'));
create policy studyhub_courses_insert on storage.objects for insert to authenticated with check(bucket_id='studyhub-courses' and public.course_file_access(name,'insert'));
create policy studyhub_courses_delete on storage.objects for delete to authenticated using(bucket_id='studyhub-courses' and public.course_file_access(name,'delete'));

create function public.save_course_text(p_course uuid,p_kind public.content_kind,p_title text,p_body text,p_id uuid default null)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare cid uuid;
begin
 if p_kind='assignment' or not public.manage_course_material(p_course,p_kind) then raise exception 'Access denied'; end if;
 if p_title is null or length(trim(p_title)) not between 1 and 200 or p_body is null or length(p_body)>50000 then raise exception 'Invalid content'; end if;
 if p_id is null then
  insert into public.course_content(course_id,author_id,kind,title,body,published_at) values(p_course,auth.uid(),p_kind,p_title,p_body,now()) returning id into cid;
 else
  update public.course_content set title=p_title,body=p_body where id=p_id and course_id=p_course and kind=p_kind returning id into cid;
  if not found then raise exception 'Material unavailable'; end if;
 end if;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'course.material_saved',cid);
 return cid;
end $$;
create function public.reserve_course_upload(p_course uuid,p_kind public.content_kind,p_title text,p_body text,p_name text,p_mime text,p_size bigint)
returns table(item_id uuid,storage_path text) language plpgsql security definer set search_path=pg_catalog as $$
declare fid uuid; cid uuid; path text; lim public.storage_limits%rowtype;
begin
 if p_kind='assignment' or not public.manage_course_material(p_course,p_kind) then raise exception 'Access denied'; end if;
 if p_title is null or length(trim(p_title)) not between 1 and 200 or p_body is null or length(p_body)>50000 or p_name is null or length(p_name) not between 1 and 240 then raise exception 'Invalid content'; end if;
 if not coalesce((select p_mime=any(allowed_mime_types) from storage.buckets where id='studyhub-courses'),false) then raise exception 'File type not allowed'; end if;
 perform pg_advisory_xact_lock(730041);
 select * into lim from public.storage_limits where singleton;
 if p_size is null or p_size<=0 or p_size>lim.file_limit_bytes then raise exception 'File exceeds 10 MB limit'; end if;
 if exists(select 1 from public.files where owner_id=auth.uid() and status='reserved') then raise exception 'Finish or delete previous upload'; end if;
 if public.library_usage_bytes()+lim.file_limit_bytes>lim.budget_bytes then raise exception 'Storage budget exceeded'; end if;
 fid:=gen_random_uuid();path:=auth.uid()::text||'/'||fid::text||'/content';
 insert into public.files(id,owner_id,storage_path,original_name,mime_type,size_bytes) values(fid,auth.uid(),path,p_name,p_mime,p_size);
 insert into public.course_content(course_id,author_id,kind,title,body,file_id) values(p_course,auth.uid(),p_kind,p_title,p_body,fid) returning id into cid;
 insert into public.course_uploads(content_id) values(cid);
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'course.upload_reserved',cid);
 return query select cid,path;
end $$;
create function public.publish_course_upload(p_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare i public.course_content%rowtype; f public.files%rowtype; meta jsonb; state text;
begin
 perform pg_advisory_xact_lock(730041);
 select * into i from public.course_content where id=p_id for update;
 if not found or not public.manage_course_material(i.course_id,i.kind) then raise exception 'Access denied'; end if;
 select status into state from public.course_uploads where content_id=p_id for update;
 if state='published' then return; end if;
 if state is distinct from 'pending' then raise exception 'Upload unavailable'; end if;
 select * into f from public.files where id=i.file_id for update;
 select metadata into meta from storage.objects where bucket_id='studyhub-courses' and name=f.storage_path;
 if not found or meta is null or (meta->>'size') is null or (meta->>'size')::bigint<>f.size_bytes or (meta->>'mimetype') is distinct from f.mime_type then raise exception 'Uploaded file does not match reservation'; end if;
 update public.files set status='ready' where id=f.id;
 update public.course_content set published_at=now() where id=p_id;
 update public.course_uploads set status='published' where content_id=p_id;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'course.upload_published',p_id);
end $$;
create function public.begin_course_delete(p_id uuid) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare i public.course_content%rowtype; path text;
begin
 perform pg_advisory_xact_lock(730041);
 select * into i from public.course_content where id=p_id for update;
 if not found or not public.manage_course_material(i.course_id,i.kind) then raise exception 'Access denied'; end if;
 if i.file_id is null then
  delete from public.course_content where id=p_id;
 else
  update public.course_content set published_at=null where id=p_id;
  update public.course_uploads set status='deleting' where content_id=p_id;
  update public.files set status='deleting' where id=i.file_id returning storage_path into path;
 end if;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'course.delete_started',p_id);
 return path;
end $$;
create function public.finish_course_delete(p_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare i public.course_content%rowtype; f public.files%rowtype;
begin
 perform pg_advisory_xact_lock(730041);
 select * into i from public.course_content where id=p_id for update;
 if not found or not public.manage_course_material(i.course_id,i.kind) then raise exception 'Access denied'; end if;
 select * into f from public.files where id=i.file_id for update;
 if f.status is distinct from 'deleting' or not exists(select 1 from public.course_uploads where content_id=p_id and status='deleting') then raise exception 'Deletion not started'; end if;
 if exists(select 1 from storage.objects where bucket_id='studyhub-courses' and name=f.storage_path) then raise exception 'Remove object through Storage API first'; end if;
 delete from public.course_uploads where content_id=p_id;
 delete from public.course_content where id=p_id;
 delete from public.files where id=f.id;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'course.material_deleted',p_id);
end $$;
create function public.course_catalog(p_course uuid,p_kind public.content_kind,p_offset integer default 0)
returns table(id uuid,course_id uuid,kind public.content_kind,title text,body text,author_name text,created_at timestamptz,file_id uuid,storage_path text,original_name text,mime_type text,size_bytes bigint,status text,can_manage boolean)
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if p_kind='assignment' or not public.can_view_course(p_course) or not exists(select 1 from public.courses c where c.id=p_course and public.has_section_access(public.content_section(p_kind),c.group_id,c.id)) then raise exception 'Section access denied'; end if;
 if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'Invalid page'; end if;
 return query select i.id,i.course_id,i.kind,i.title,coalesce(i.body,''),p.full_name,i.created_at,i.file_id,f.storage_path,f.original_name,f.mime_type,f.size_bytes,coalesce(u.status,'published'),public.manage_course_material(i.course_id,i.kind)
 from public.course_content i join public.profiles p on p.id=i.author_id left join public.files f on f.id=i.file_id left join public.course_uploads u on u.content_id=i.id
 where i.course_id=p_course and i.kind=p_kind and public.read_course_material(i.id) order by i.created_at desc,i.id limit 50 offset p_offset;
end $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('content_section','manage_course_material','read_course_material','course_file_access','save_course_text','reserve_course_upload','publish_course_upload','begin_course_delete','finish_course_delete','course_catalog') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
commit;
