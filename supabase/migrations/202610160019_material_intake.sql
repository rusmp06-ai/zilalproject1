begin;
-- Gemini receives suggestions-only context; publication continues through existing RLS/RPC checks.
create or replace function public.can_publish_library_group(g uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select public.is_active_user() and exists(select 1 from public.study_groups where id=g and not blocked) and (public.is_owner() or public.has_section_access('library') and (public.is_group_leader(g) or exists(select 1 from public.courses c where c.group_id=g and public.active_teaching_course(c.id))));
$$;
create or replace function public.manage_library_item(p_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select public.is_owner() or exists(select 1 from public.library_items i where i.id=p_id and i.author_id=auth.uid() and public.can_publish_library_group(i.source_group_id));
$$;
create or replace function public.material_intake_context() returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 if not public.is_active_user() then raise exception 'Account unavailable';end if;
 select jsonb_build_object('courses',coalesce((select jsonb_agg(to_jsonb(q) order by q.group_name,q.title) from (
 select c.id,c.title,c.group_id,g.name as group_name,array_remove(array[
 case when public.manage_course_material(c.id,'lecture') then 'lecture' end,
 case when public.manage_course_material(c.id,'presentation') then 'presentation' end,
 case when public.manage_course_material(c.id,'material') then 'material' end,
 case when public.can_grade_course(c.id) and public.manage_course_material(c.id,'material') then 'assignment' end],null) as kinds
 from public.courses c join public.study_groups g on g.id=c.group_id where not c.archived and not g.blocked and (public.manage_course_material(c.id,'lecture') or public.manage_course_material(c.id,'presentation') or public.manage_course_material(c.id,'material'))
 )q),'[]'::jsonb),'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.name) from public.study_groups g where public.can_publish_library_group(g.id)),'[]'::jsonb)) into result;
 if jsonb_array_length(result->'courses')=0 and jsonb_array_length(result->'groups')=0 then raise exception 'Publisher required';end if;
 return result;
end $$;
create table if not exists public.material_ai_usage(user_id uuid not null references public.profiles(id),day date not null,requests integer not null check(requests>0),primary key(user_id,day));
alter table public.material_ai_usage enable row level security;
revoke all on public.material_ai_usage from public,anon,authenticated;
create or replace function public.begin_material_analysis() returns void language plpgsql security definer set search_path=pg_catalog as $$
declare today date:=(now() at time zone 'Asia/Bishkek')::date;used integer;
begin
 perform public.material_intake_context();perform pg_advisory_xact_lock(730049);
 select requests into used from public.material_ai_usage where user_id=auth.uid() and day=today;
 if coalesce(used,0)>=10 or (select coalesce(sum(requests),0) from public.material_ai_usage where day=today)>=100 then raise exception 'Analysis daily quota exceeded';end if;
 insert into public.material_ai_usage values(auth.uid(),today,1) on conflict(user_id,day) do update set requests=public.material_ai_usage.requests+1;
 delete from public.material_ai_usage where day<today-31;
end $$;
alter table public.assignments add column if not exists source_material_id uuid references public.course_content(id) on delete set null;
-- Assignment instructions belong to assignment access, including when general materials are denied.
create or replace function public.read_course_material(p_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.course_content i join public.courses c on c.id=i.course_id where i.id=p_id and public.can_view_course(c.id) and
 ((public.has_section_access(public.content_section(i.kind),c.group_id,c.id) and public.manage_course_material(c.id,i.kind)) or
 (i.published_at<=now() and (i.file_id is null or exists(select 1 from public.files f where f.id=i.file_id and f.status='ready')) and
 (public.has_section_access(public.content_section(i.kind),c.group_id,c.id) or exists(select 1 from public.assignments a where a.source_material_id=i.id and public.can_read_assignment(a.id))))));
$$;
-- The instruction attachment must not disappear through the ordinary material delete button.
create or replace function public.protect_assignment_source() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if exists(select 1 from public.assignments where source_material_id=old.id) then
  if TG_OP='DELETE' then raise exception 'Файл прикреплён к заданию. Его нельзя удалить как обычный материал.';end if;
  if new.file_id is distinct from old.file_id or new.published_at is null then raise exception 'Файл прикреплён к заданию. Его нельзя удалить как обычный материал.';end if;
 end if;
 if TG_OP='DELETE' then return old;end if;return new;
end $$;
revoke all on function public.protect_assignment_source() from public,anon,authenticated;
drop trigger if exists course_assignment_source_guard on public.course_content;
create trigger course_assignment_source_guard before update or delete on public.course_content for each row execute function public.protect_assignment_source();
create table if not exists public.material_intakes(request_id uuid primary key,user_id uuid not null references public.profiles(id),payload jsonb not null,item_id uuid not null,bucket text not null,path text not null,result_id uuid,created_at timestamptz not null default now());
alter table public.material_intakes enable row level security;
revoke all on public.material_intakes from public,anon,authenticated;
create or replace function public.prepare_material_intake(p_request uuid,p_kind text,p_course uuid,p_group uuid,p_title text,p_description text,p_due timestamptz,p_max integer,p_late boolean,p_name text,p_mime text,p_size bigint,p_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare payload jsonb;old public.material_intakes%rowtype;iid uuid;path text;bucket text;fid uuid;lim public.storage_limits%rowtype;
begin
 perform public.material_intake_context();perform pg_advisory_xact_lock(730041);
 if p_request is null or p_kind is null or p_kind not in ('lecture','presentation','material','assignment','book') or p_title is null or length(trim(p_title)) not between 1 and 200 or p_description is null or length(p_description)>50000 or p_hash is null or p_hash!~'^[a-f0-9]{64}$' then raise exception 'Invalid intake';end if;
 if p_kind='book' then if not public.can_publish_library_group(p_group) then raise exception 'Access denied';end if;
 else if p_course is null or not public.manage_course_material(p_course,(case when p_kind='assignment' then 'material' else p_kind end)::public.content_kind) then raise exception 'Access denied';end if;
 if p_kind='assignment' and (not public.can_grade_course(p_course) or length(trim(p_description))=0 or p_max is null or p_max not between 1 and 1000 or p_late is null) then raise exception 'Assignment unavailable';end if;end if;
 payload:=jsonb_build_object('kind',p_kind,'course',p_course,'group',p_group,'title',trim(p_title),'description',p_description,'due',p_due,'max',p_max,'late',p_late,'name',p_name,'mime',p_mime,'size',p_size,'hash',p_hash);
 select * into old from public.material_intakes where request_id=p_request;
 if found then
  if old.user_id<>auth.uid() or old.payload<>payload then raise exception 'Intake changed';end if;
  return jsonb_build_object('item_id',old.item_id,'path',old.path,'bucket',old.bucket,'published',old.result_id is not null,'result_id',old.result_id);
 end if;
 if p_kind='book' then
  -- Mirror library reservation invariants while allowing active teachers to publish their own books.
  select * into lim from public.storage_limits where singleton;
  if p_size is null or p_size<=0 or p_size>lim.file_limit_bytes or p_name is null or length(p_name) not between 1 and 240 or not coalesce((select p_mime=any(allowed_mime_types) from storage.buckets where id='studyhub-library'),false) then raise exception 'Invalid file';end if;
  if exists(select 1 from public.files where owner_id=auth.uid() and status='reserved') then raise exception 'Finish or delete previous upload';end if;
  if public.library_usage_bytes()+lim.file_limit_bytes>lim.budget_bytes then raise exception 'Storage budget exceeded';end if;
  fid:=gen_random_uuid();path:=auth.uid()::text||'/'||fid::text||'/content';
  insert into public.files(id,owner_id,storage_path,original_name,mime_type,size_bytes) values(fid,auth.uid(),path,p_name,p_mime,p_size);
  insert into public.library_items(title,author_id,source_group_id,file_id) values(trim(p_title),auth.uid(),p_group,fid) returning id into iid;bucket:='studyhub-library';
 else
  select r.item_id,r.storage_path into iid,path from public.reserve_course_upload(p_course,(case when p_kind='assignment' then 'material' else p_kind end)::public.content_kind,p_title,p_description,p_name,p_mime,p_size)r;bucket:='studyhub-courses';
 end if;
 insert into public.material_intakes(request_id,user_id,payload,item_id,bucket,path) values(p_request,auth.uid(),payload,iid,bucket,path);
 return jsonb_build_object('item_id',iid,'path',path,'bucket',bucket,'published',false,'result_id',null);
end $$;
create or replace function public.finish_material_intake(p_request uuid) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare job public.material_intakes%rowtype;result uuid;c uuid;
begin
 perform pg_advisory_xact_lock(730041);select * into job from public.material_intakes where request_id=p_request for update;
 if not found or job.user_id<>auth.uid() then raise exception 'Intake unavailable';end if;
 perform public.material_intake_context();
 if job.bucket='studyhub-library' then
  if not public.can_publish_library_group((job.payload->>'group')::uuid) then raise exception 'Access denied';end if;
 else
  c:=(job.payload->>'course')::uuid;
  if not public.manage_course_material(c,(case when job.payload->>'kind'='assignment' then 'material' else job.payload->>'kind' end)::public.content_kind) or (job.payload->>'kind'='assignment' and not public.can_grade_course(c)) then raise exception 'Access denied';end if;
 end if;
 if job.result_id is not null then return job.result_id;end if;
 if job.bucket='studyhub-library' then perform public.publish_library_upload(job.item_id);result:=job.item_id;
 else
  perform public.publish_course_upload(job.item_id);result:=job.item_id;
  if job.payload->>'kind'='assignment' then
   result:=public.create_assignment(c,job.payload->>'title',job.payload->>'description',(job.payload->>'due')::timestamptz,(job.payload->>'max')::integer,(job.payload->>'late')::boolean);
   update public.assignments set source_material_id=job.item_id where id=result;
  end if;
 end if;
 update public.material_intakes set result_id=result where request_id=p_request;
 insert into public.audit_events(actor_id,action,entity_id,details) values(auth.uid(),'material.intake_published',result,jsonb_build_object('kind',job.payload->>'kind','source',job.item_id));
 return result;
end $$;
do $$declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('can_publish_library_group','material_intake_context','begin_material_analysis','prepare_material_intake','finish_material_intake') loop execute 'revoke all on function '||f.signature||' from public,anon';execute 'grant execute on function '||f.signature||' to authenticated';end loop;end $$;
commit;
