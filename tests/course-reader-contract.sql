begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000801'),('00000000-0000-0000-0000-000000000802');
insert into public.profiles(id,full_name) values('00000000-0000-0000-0000-000000000801','Reader'),('00000000-0000-0000-0000-000000000802','Owner');
insert into public.platform_owners values('00000000-0000-0000-0000-000000000802');
insert into public.study_groups(id,name,created_by) values('00000000-0000-0000-0000-000000000803','Reader group','00000000-0000-0000-0000-000000000802');
insert into public.group_memberships(group_id,user_id,role) values('00000000-0000-0000-0000-000000000803','00000000-0000-0000-0000-000000000801','student');
insert into public.files(id,owner_id,storage_path,original_name,mime_type,size_bytes,status) values('00000000-0000-0000-0000-000000000804','00000000-0000-0000-0000-000000000802','reader.txt','reader.txt','text/plain',30,'ready');
insert into public.courses(id,group_id,title) values('00000000-0000-0000-0000-000000000806','00000000-0000-0000-0000-000000000803','Course reading');
insert into public.course_content(id,course_id,author_id,kind,title,body,file_id,published_at)
 values('00000000-0000-0000-0000-000000000805','00000000-0000-0000-0000-000000000806','00000000-0000-0000-0000-000000000802','lecture','Reading','','00000000-0000-0000-0000-000000000804',now());
insert into public.course_uploads(content_id,status) values('00000000-0000-0000-0000-000000000805','published');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000801',true);
do $$ declare r public.course_reader_states; item uuid:='00000000-0000-0000-0000-000000000805'; begin
 r:=public.save_course_reader_state(item,2,3,false,array[2,1,2],0);
 if r.version<>1 or r.bookmarks<>array[1,2] then raise exception 'TEST FAILED: initial save'; end if;
 if (select page from public.course_reader_state(item))<>2 then raise exception 'TEST FAILED: resume'; end if;
 begin
  perform public.save_course_reader_state(item,1,3,false,'{}',0);
  raise exception 'TEST FAILED: stale insert';
 exception when raise_exception then if sqlerrm<>'Reading state changed. Refresh before saving' then raise; end if; end;
 r:=public.save_course_reader_state(item,3,3,false,array[1,3],1);
 begin
  perform public.save_course_reader_state(item,1,3,false,'{}',1);
  raise exception 'TEST FAILED: stale update';
 exception when raise_exception then if sqlerrm<>'Reading state changed. Refresh before saving' then raise; end if; end;
 begin
  perform public.save_course_reader_state(item,4,3,false,'{}',2);
  raise exception 'TEST FAILED: invalid page';
 exception when raise_exception then if sqlerrm<>'Invalid reading state' then raise; end if; end;
 begin
  perform public.save_course_reader_state(item,3,3,false,array[4],2);
  raise exception 'TEST FAILED: invalid bookmark';
 exception when raise_exception then if sqlerrm<>'Invalid reading state' then raise; end if; end;
 begin
  update public.course_reader_states set page=1;
  raise exception 'TEST FAILED: direct write';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000802',true);
 if exists(select 1 from public.course_reader_states) or exists(select 1 from public.course_reader_state(item)) then raise exception 'TEST FAILED: owner reads foreign marks'; end if;
 begin
  perform public.save_course_reader_state(item,1,3,false,'{}',2);
  raise exception 'TEST FAILED: owner overwrites foreign state';
 exception when raise_exception then if sqlerrm<>'Reading state changed. Refresh before saving' then raise; end if; end;
 perform public.deny_section('lectures','00000000-0000-0000-0000-000000000801',null);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000801',true);
 if exists(select 1 from public.course_reader_states) then raise exception 'TEST FAILED: denied reader sees marks'; end if;
 begin
  perform public.course_reader_state(item);
  raise exception 'TEST FAILED: denied read RPC';
 exception when raise_exception then if sqlerrm<>'Reading access denied' then raise; end if; end;
 begin
  perform public.save_course_reader_state(item,1,3,false,'{}',2);
  raise exception 'TEST FAILED: denied write RPC';
 exception when raise_exception then if sqlerrm<>'Reading access denied' then raise; end if; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000802',true);
 perform public.remove_denial(id) from public.access_denials where user_id='00000000-0000-0000-0000-000000000801';
 perform public.set_block('00000000-0000-0000-0000-000000000801',null,true);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000801',true);
 if exists(select 1 from public.course_reader_states) then raise exception 'TEST FAILED: blocked reader'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000802',true);
 perform public.set_block('00000000-0000-0000-0000-000000000801',null,false);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000801',true);
 if (select page from public.course_reader_state(item))<>3 then raise exception 'TEST FAILED: restoration loses position'; end if;
end $$;
reset role;
update public.course_uploads set status='deleting' where content_id='00000000-0000-0000-0000-000000000805';
set local role authenticated;
do $$ begin
 begin
  perform public.course_reader_state('00000000-0000-0000-0000-000000000805');
  raise exception 'TEST FAILED: deleting item readable';
 exception when raise_exception then if sqlerrm<>'Reading access denied' then raise; end if; end;
end $$;
reset role;
delete from public.course_uploads where content_id='00000000-0000-0000-0000-000000000805';
delete from public.course_content where id='00000000-0000-0000-0000-000000000805';
do $$ begin if exists(select 1 from public.course_reader_states) then raise exception 'TEST FAILED: orphan marks'; end if; end $$;
rollback;
