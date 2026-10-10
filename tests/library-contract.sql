begin;
insert into auth.users(id) values
 ('00000000-0000-0000-0000-000000000101'),('00000000-0000-0000-0000-000000000102'),
 ('00000000-0000-0000-0000-000000000103'),('00000000-0000-0000-0000-000000000104');
insert into public.profiles(id,full_name) values
 ('00000000-0000-0000-0000-000000000101','Owner'),('00000000-0000-0000-0000-000000000102','Leader A'),
 ('00000000-0000-0000-0000-000000000103','Leader B'),('00000000-0000-0000-0000-000000000104','Student A');
insert into public.platform_owners values('00000000-0000-0000-0000-000000000101');
insert into public.study_groups(id,name,created_by) values
 ('00000000-0000-0000-0000-000000000201','A','00000000-0000-0000-0000-000000000102'),
 ('00000000-0000-0000-0000-000000000202','B','00000000-0000-0000-0000-000000000103');
insert into public.group_memberships(group_id,user_id,role) values
 ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000102','leader'),
 ('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000103','leader'),
 ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000104','student');
update public.storage_limits set budget_bytes=10485760;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000102',true);
do $$
declare iid uuid; path text; denial uuid; quota bigint; pending_id uuid; pending_path text;
begin
 begin
  perform public.reserve_library_upload('00000000-0000-0000-0000-000000000202','Foreign','f.txt','text/plain',10);
  raise exception 'TEST FAILED: leader writes foreign group';
 exception when raise_exception then if sqlerrm<>'Access denied' then raise; end if; end;
 begin
  perform public.reserve_library_upload('00000000-0000-0000-0000-000000000201','Oversize','f.txt','text/plain',10485761);
  raise exception 'TEST FAILED: oversized reservation';
 exception when raise_exception then if sqlerrm<>'File exceeds 10 MB limit' then raise; end if; end;
 begin
  perform public.reserve_library_upload('00000000-0000-0000-0000-000000000201','HTML','f.html','text/html',10);
  raise exception 'TEST FAILED: HTML accepted';
 exception when raise_exception then if sqlerrm<>'File type not allowed' then raise; end if; end;
 select item_id,storage_path into iid,path from public.reserve_library_upload('00000000-0000-0000-0000-000000000201','Original','f.txt','text/plain',10);
 begin
  perform public.publish_library_upload(iid);
  raise exception 'TEST FAILED: publication without object';
 exception when raise_exception then if sqlerrm<>'Uploaded file does not match reservation' then raise; end if; end;
 -- Simulates the Storage service's metadata record, not an actual byte upload.
 insert into storage.objects(bucket_id,name,metadata) values('studyhub-library',path,'{"size":10,"mimetype":"text/plain"}');
 perform public.publish_library_upload(iid);
 perform public.publish_library_upload(iid);
 perform public.rename_library_item(iid,'Renamed by author');
 if not exists(select 1 from public.library_catalog() where id=iid and title='Renamed by author') then raise exception 'TEST FAILED: catalog title'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000103',true);
 if not exists(select 1 from storage.objects where name=path) then raise exception 'TEST FAILED: shared file not readable'; end if;
 begin
  perform public.rename_library_item(iid,'Foreign edit');
  raise exception 'TEST FAILED: leader edits another author';
 exception when raise_exception then if sqlerrm<>'Access denied' then raise; end if; end;
 begin
  perform public.begin_library_delete(iid);
  raise exception 'TEST FAILED: leader deletes another author';
 exception when raise_exception then if sqlerrm<>'Access denied' then raise; end if; end;
 begin
  delete from storage.objects where name=path;
  if found then raise exception 'TEST FAILED: direct delete without marking'; end if;
 end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);
 denial:=public.deny_section('library',null,'00000000-0000-0000-0000-000000000201');
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000104',true);
 if exists(select 1 from storage.objects where name=path) then raise exception 'TEST FAILED: restricted student reads object'; end if;
 if exists(select 1 from public.library_items where id=iid) then raise exception 'TEST FAILED: restricted student reads publication'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);
 perform public.remove_denial(denial);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000104',true);
 if not exists(select 1 from storage.objects where name=path) then raise exception 'TEST FAILED: restored student cannot read'; end if;
 begin
  perform public.reserve_library_upload('00000000-0000-0000-0000-000000000201','Student upload','f.txt','text/plain',10);
  raise exception 'TEST FAILED: student uploaded';
 exception when raise_exception then if sqlerrm<>'Access denied' then raise; end if; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);
 perform public.rename_library_item(iid,'Owner edit');
 perform public.begin_library_delete(iid);
 begin
  perform public.finish_library_delete(iid);
  raise exception 'TEST FAILED: DB deleted before Storage removal';
 exception when raise_exception then if sqlerrm<>'Remove object through Storage API first' then raise; end if; end;
 delete from storage.objects where name=path;
 perform public.finish_library_delete(iid);
 if exists(select 1 from public.library_items where id=iid) then raise exception 'TEST FAILED: deleted publication survives'; end if;
 -- Reserved and deleting uploads retain full quota charge even if the declared size is one byte.
 select item_id,storage_path into pending_id,pending_path from public.reserve_library_upload('00000000-0000-0000-0000-000000000201','Pending','p.txt','text/plain',1);
 select used_bytes into quota from public.library_quota();
 if quota<>10485760 then raise exception 'TEST FAILED: reservation undercounted'; end if;
 begin
  perform public.reserve_library_upload('00000000-0000-0000-0000-000000000201','Second pending','b.txt','text/plain',1);
  raise exception 'TEST FAILED: multiple pending reservations';
 exception when raise_exception then if sqlerrm<>'Finish or delete previous upload' then raise; end if; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000103',true);
 begin
  perform public.reserve_library_upload('00000000-0000-0000-0000-000000000202','Over quota','b.txt','text/plain',1);
  raise exception 'TEST FAILED: global quota bypassed';
 exception when raise_exception then if sqlerrm<>'Storage budget exceeded' then raise; end if; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);
 insert into storage.objects(bucket_id,name,metadata) values('studyhub-library',pending_path,'{"size":2,"mimetype":"text/plain"}');
 begin
  perform public.publish_library_upload(pending_id);
  raise exception 'TEST FAILED: size mismatch published';
 exception when raise_exception then if sqlerrm<>'Uploaded file does not match reservation' then raise; end if; end;
 perform public.begin_library_delete(pending_id);
 select used_bytes into quota from public.library_quota();
 if quota<>10485760 then raise exception 'TEST FAILED: deleting reservation undercounted'; end if;
 delete from storage.objects where name=pending_path;
 perform public.finish_library_delete(pending_id);
 raise notice 'Library contract assertions passed';
end $$;
rollback;
