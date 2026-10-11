begin;
update storage.buckets set allowed_mime_types=array_append(allowed_mime_types,'application/epub+zip') where id in ('studyhub-library','studyhub-courses') and not ('application/epub+zip'=any(allowed_mime_types));
create or replace function public.reserve_library_upload(p_group uuid,p_title text,p_name text,p_mime text,p_size bigint)
returns table(item_id uuid,storage_path text) language plpgsql security definer set search_path=pg_catalog as $$
declare fid uuid; iid uuid; path text; lim public.storage_limits%rowtype;
begin
 if not(public.is_owner() or (public.is_group_leader(p_group) and public.has_section_access('library'))) then raise exception 'Access denied'; end if;
 if not exists(select 1 from public.study_groups where id=p_group and not blocked) then raise exception 'Group unavailable'; end if;
 if p_size is null or p_size<=0 or p_name is null or length(p_name) not between 1 and 240 then raise exception 'Invalid file'; end if;
 if p_mime is null or p_mime<>all(array['application/epub+zip','application/pdf','text/plain','image/jpeg','image/png','image/webp',
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
commit;
