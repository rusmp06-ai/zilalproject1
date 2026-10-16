begin;
alter table public.material_intakes add column if not exists cancelled_at timestamptz;
alter table public.material_intakes add column if not exists cleaned_at timestamptz;
-- Serialize cancellation with prepare/finish and existing storage deletion operations.
create or replace function public.material_intake_status(p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare job public.material_intakes%rowtype;
begin
 if not public.is_active_user() then raise exception 'Account unavailable';end if;
 select * into job from public.material_intakes where request_id=p_request;
 if not found then return jsonb_build_object('status','none');end if;
 if job.user_id<>auth.uid() then raise exception 'Intake unavailable';end if;
 return jsonb_build_object('status',case when job.cleaned_at is not null then 'cancelled' when job.cancelled_at is not null then 'deleting' when job.result_id is not null then 'published' else 'pending' end,'result_id',job.result_id);
end $$;
create or replace function public.begin_material_intake_cancel(p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare job public.material_intakes%rowtype;
begin
 if not public.is_active_user() or p_request is null then raise exception 'Account unavailable';end if;
 perform pg_advisory_xact_lock(730041);
 select * into job from public.material_intakes where request_id=p_request for update;
 if not found then
  perform public.material_intake_context();
  -- A tombstone also prevents a delayed prepare from starting after cancellation.
  insert into public.material_intakes(request_id,user_id,payload,item_id,bucket,path,cancelled_at,cleaned_at)
   values(p_request,auth.uid(),'{}',gen_random_uuid(),'','',now(),now());
  return jsonb_build_object('status','cancelled');
 end if;
 if job.user_id<>auth.uid() then raise exception 'Intake unavailable';end if;
 if job.result_id is not null then return jsonb_build_object('status','published','result_id',job.result_id);end if;
 if job.cleaned_at is not null then return jsonb_build_object('status','cancelled');end if;
 if job.bucket='studyhub-library' and exists(select 1 from public.library_items where id=job.item_id) then perform public.begin_library_delete(job.item_id);
 elsif job.bucket='studyhub-courses' and exists(select 1 from public.course_content where id=job.item_id) then perform public.begin_course_delete(job.item_id);
 end if;
 update public.material_intakes set cancelled_at=coalesce(cancelled_at,now()) where request_id=p_request;
 return jsonb_build_object('status','deleting','bucket',job.bucket,'path',job.path);
end $$;
create or replace function public.finish_material_intake_cancel(p_request uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare job public.material_intakes%rowtype;
begin
 if not public.is_active_user() then raise exception 'Account unavailable';end if;
 perform pg_advisory_xact_lock(730041);
 select * into job from public.material_intakes where request_id=p_request for update;
 if not found or job.user_id<>auth.uid() or job.cancelled_at is null or job.result_id is not null then raise exception 'Cancellation unavailable';end if;
 if job.cleaned_at is not null then return;end if;
 if exists(select 1 from storage.objects where bucket_id=job.bucket and name=job.path) then raise exception 'Remove object through Storage API first';end if;
 if job.bucket='studyhub-library' and exists(select 1 from public.library_items where id=job.item_id) then perform public.finish_library_delete(job.item_id);
 elsif job.bucket='studyhub-courses' and exists(select 1 from public.course_content where id=job.item_id) then perform public.finish_course_delete(job.item_id);
 end if;
 update public.material_intakes set cleaned_at=now() where request_id=p_request;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'material.intake_cancelled',job.item_id);
end $$;
create or replace function public.finish_material_intake(p_request uuid) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare job public.material_intakes%rowtype;result uuid;c uuid;
begin
 perform pg_advisory_xact_lock(730041);select * into job from public.material_intakes where request_id=p_request for update;
 if not found or job.user_id<>auth.uid() then raise exception 'Intake unavailable';end if;
 if job.cancelled_at is not null then raise exception 'Intake cancelled';end if;
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

revoke all on function public.material_intake_status(uuid),public.begin_material_intake_cancel(uuid),public.finish_material_intake_cancel(uuid) from public,anon;
grant execute on function public.material_intake_status(uuid),public.begin_material_intake_cancel(uuid),public.finish_material_intake_cancel(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
