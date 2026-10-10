begin;
alter table public.files add column status text not null default 'reserved' check(status in ('reserved','ready','deleting'));
alter table public.library_items add column status text not null default 'pending' check(status in ('pending','published','deleting'));
alter table public.library_items add constraint library_title_length check(length(trim(title)) between 1 and 200);
create table public.storage_limits (
 singleton boolean primary key default true check(singleton),
 budget_bytes bigint not null check(budget_bytes>0),
 file_limit_bytes bigint not null check(file_limit_bytes>0)
);
insert into public.storage_limits values(true,838860800,10485760);
alter table public.storage_limits enable row level security;
revoke all on public.storage_limits from anon,authenticated;
-- Charges pending reservations at the full per-file limit, preventing understated sizes from bypassing quota.
create function public.library_usage_bytes() returns bigint
language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(sum(case when f.status<>'ready' then greatest(f.size_bytes,l.file_limit_bytes) else f.size_bytes end),0)::bigint
 from public.files f cross join public.storage_limits l;
$$;
create function public.manage_library_item(p_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select public.is_owner() or exists(select 1 from public.library_items i
 where i.id=p_id and i.author_id=auth.uid() and public.is_group_leader(i.source_group_id) and public.has_section_access('library'));
$$;
create function public.read_library_file(p_path text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.files f join public.library_items i on i.file_id=f.id
 where f.storage_path=p_path and (
 (i.status='published' and f.status='ready' and public.has_section_access('library'))
 or public.manage_library_item(i.id)));
$$;
create function public.insert_library_file(p_path text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.files f join public.library_items i on i.file_id=f.id
 where f.storage_path=p_path and f.owner_id=auth.uid() and f.status='reserved' and i.status='pending'
 and public.manage_library_item(i.id));
$$;
create function public.delete_library_file(p_path text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.files f join public.library_items i on i.file_id=f.id
 where f.storage_path=p_path and f.status='deleting' and i.status='deleting' and public.manage_library_item(i.id));
$$;

drop policy library_read on public.library_items;
create policy library_read on public.library_items for select to authenticated
 using((status='published' and public.has_section_access('library')) or public.manage_library_item(id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('studyhub-library','studyhub-library',false,10485760,array[
 'application/pdf','text/plain','image/jpeg','image/png','image/webp',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy studyhub_library_read on storage.objects for select to authenticated
 using(bucket_id='studyhub-library' and public.read_library_file(name));
create policy studyhub_library_insert on storage.objects for insert to authenticated
 with check(bucket_id='studyhub-library' and public.insert_library_file(name));
create policy studyhub_library_delete on storage.objects for delete to authenticated
 using(bucket_id='studyhub-library' and public.delete_library_file(name));
-- No UPDATE policy: files cannot be replaced via upsert.

create function public.reserve_library_upload(p_group uuid,p_title text,p_name text,p_mime text,p_size bigint)
returns table(item_id uuid,storage_path text) language plpgsql security definer set search_path=pg_catalog as $$
declare fid uuid; iid uuid; path text; lim public.storage_limits%rowtype;
begin
 if not(public.is_owner() or (public.is_group_leader(p_group) and public.has_section_access('library'))) then raise exception 'Access denied'; end if;
 if not exists(select 1 from public.study_groups where id=p_group and not blocked) then raise exception 'Group unavailable'; end if;
 if p_size is null or p_size<=0 or p_name is null or length(p_name) not between 1 and 240 then raise exception 'Invalid file'; end if;
 if p_mime is null or p_mime<>all(array['application/pdf','text/plain','image/jpeg','image/png','image/webp',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) then raise exception 'File type not allowed'; end if;
 -- Serialize reservations globally; deletion/finalization also take this lock.
 perform pg_advisory_xact_lock(730041);
 select * into lim from public.storage_limits where singleton;
 if p_size>lim.file_limit_bytes then raise exception 'File exceeds 10 MB limit'; end if;
 if exists(select 1 from public.files where owner_id=auth.uid() and status='reserved') then raise exception 'Finish or delete previous upload'; end if;
 if public.library_usage_bytes()+lim.file_limit_bytes>lim.budget_bytes then raise exception 'Storage budget exceeded'; end if;
 fid:=gen_random_uuid(); path:=auth.uid()::text||'/'||fid::text||'/content';
 insert into public.files(id,owner_id,storage_path,original_name,mime_type,size_bytes)
 values(fid,auth.uid(),path,p_name,p_mime,p_size);
 insert into public.library_items(author_id,source_group_id,file_id,title)
 values(auth.uid(),p_group,fid,p_title) returning id into iid;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'library.reserved',iid);
 return query select iid,path;
end $$;
create function public.publish_library_upload(p_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare i public.library_items%rowtype; f public.files%rowtype; meta jsonb;
begin
 perform pg_advisory_xact_lock(730041);
 select * into i from public.library_items where id=p_id for update;
 if not found or not public.manage_library_item(p_id) then raise exception 'Access denied'; end if;
 if i.status='published' then return; end if;
 if i.status<>'pending' then raise exception 'Upload unavailable'; end if;
 select * into f from public.files where id=i.file_id for update;
 select metadata into meta from storage.objects where bucket_id='studyhub-library' and name=f.storage_path;
 if not found or meta is null or (meta->>'size') is null or (meta->>'size')::bigint<>f.size_bytes
 or (meta->>'mimetype') is distinct from f.mime_type then raise exception 'Uploaded file does not match reservation'; end if;
 update public.files set status='ready' where id=f.id;
 update public.library_items set status='published' where id=p_id;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'library.published',p_id);
end $$;
create function public.rename_library_item(p_id uuid,p_title text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not public.manage_library_item(p_id) then raise exception 'Access denied'; end if;
 update public.library_items set title=p_title where id=p_id and status='published';
 if not found then raise exception 'Publication unavailable'; end if;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'library.renamed',p_id);
end $$;
-- Mark -> Storage API remove -> finish. Never delete storage.objects directly: that would orphan bytes.
create function public.begin_library_delete(p_id uuid) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare i public.library_items%rowtype; path text;
begin
 perform pg_advisory_xact_lock(730041);
 select * into i from public.library_items where id=p_id for update;
 if not found or not public.manage_library_item(p_id) then raise exception 'Access denied'; end if;
 update public.library_items set status='deleting' where id=p_id;
 update public.files set status='deleting' where id=i.file_id returning storage_path into path;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'library.delete_started',p_id);
 return path;
end $$;
create function public.finish_library_delete(p_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare i public.library_items%rowtype; f public.files%rowtype;
begin
 perform pg_advisory_xact_lock(730041);
 select * into i from public.library_items where id=p_id for update;
 if not found or not public.manage_library_item(p_id) then raise exception 'Access denied'; end if;
 select * into f from public.files where id=i.file_id for update;
 if i.status<>'deleting' or f.status<>'deleting' then raise exception 'Deletion not started'; end if;
 if exists(select 1 from storage.objects where bucket_id='studyhub-library' and name=f.storage_path) then raise exception 'Remove object through Storage API first'; end if;
 delete from public.library_items where id=p_id;
 delete from public.files where id=f.id;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'library.deleted',p_id);
end $$;
create function public.library_catalog(p_search text default '',p_offset integer default 0)
returns table(id uuid,title text,author_id uuid,author_name text,source_group_id uuid,group_name text,created_at timestamptz,status text,storage_path text,original_name text,mime_type text,size_bytes bigint,can_manage boolean)
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not public.has_section_access('library') then raise exception 'Library access denied'; end if;
 if p_offset is null or p_offset<0 or p_offset>100000 or p_search is null or length(p_search)>200 then raise exception 'Invalid page'; end if;
 return query select i.id,i.title,i.author_id,p.full_name,i.source_group_id,g.name,i.created_at,i.status,
 f.storage_path,f.original_name,f.mime_type,f.size_bytes,public.manage_library_item(i.id)
 from public.library_items i join public.files f on f.id=i.file_id join public.profiles p on p.id=i.author_id join public.study_groups g on g.id=i.source_group_id
 where (i.status='published' or public.manage_library_item(i.id)) and (p_search='' or i.title ilike '%'||p_search||'%' or f.original_name ilike '%'||p_search||'%')
 order by i.created_at desc,i.id limit 50 offset p_offset;
end $$;
create function public.library_quota() returns table(used_bytes bigint,budget_bytes bigint,file_limit_bytes bigint)
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not public.is_owner() then return; end if;
 return query select public.library_usage_bytes(),l.budget_bytes,l.file_limit_bytes from public.storage_limits l;
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('library_usage_bytes','manage_library_item','read_library_file','insert_library_file','delete_library_file','reserve_library_upload','publish_library_upload','rename_library_item','begin_library_delete','finish_library_delete','library_catalog','library_quota') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 if f.signature::text not like '%library_usage_bytes%' then execute format('grant execute on function %s to authenticated',f.signature); end if;
 end loop;
end $$;
commit;
