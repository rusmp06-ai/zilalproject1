begin;
insert into auth.users(id) values
 ('00000000-0000-0000-0000-000000000401'),('00000000-0000-0000-0000-000000000402'),('00000000-0000-0000-0000-000000000403'),('00000000-0000-0000-0000-000000000404'),('00000000-0000-0000-0000-000000000405');
insert into public.profiles(id,full_name) select id,'Course test' from auth.users where id::text like '%00000000040_';
insert into public.platform_owners values('00000000-0000-0000-0000-000000000405');
insert into public.study_groups(id,name,created_by) values
 ('00000000-0000-0000-0000-000000000301','A','00000000-0000-0000-0000-000000000401'),
 ('00000000-0000-0000-0000-000000000302','B','00000000-0000-0000-0000-000000000401');
insert into public.group_memberships(group_id,user_id,role) values
 ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000401','leader'),
 ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000402','teacher'),
 ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000403','student'),
 ('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000404','student');
insert into public.courses(id,group_id,title) values
 ('00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-000000000301','Finance'),
 ('00000000-0000-0000-0000-000000000502','00000000-0000-0000-0000-000000000301','Unassigned');
insert into public.teaching_assignments(course_id,group_id,teacher_id) values('00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000402');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',true);
do $$
declare c uuid:='00000000-0000-0000-0000-000000000501'; txt uuid; material uuid; fid uuid; path text; restriction uuid;
begin
 txt:=public.save_course_text(c,'lecture','Lecture text','Financial statements');
 material:=public.save_course_text(c,'material','Reference','Reference text');
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000402',true);
 begin
  perform public.save_course_text('00000000-0000-0000-0000-000000000502','lecture','Forbidden','');
  raise exception 'TEST FAILED: unassigned teacher publishes';
 exception when raise_exception then if sqlerrm<>'Access denied' then raise; end if; end;
 select item_id,storage_path into fid,path from public.reserve_course_upload(c,'lecture','Lecture file','','lecture.txt','text/plain',3);
 insert into storage.objects(bucket_id,name,metadata) values('studyhub-courses',path,'{"size":3,"mimetype":"text/plain"}');
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000403',true);
 if exists(select 1 from storage.objects where name=path) then raise exception 'TEST FAILED: student reads pending file'; end if;
 begin
  perform public.save_course_text(c,'lecture','Student edit','',txt);
  raise exception 'TEST FAILED: student edits content';
 exception when raise_exception then if sqlerrm<>'Access denied' then raise; end if; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000402',true);
 perform public.publish_course_upload(fid);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000403',true);
 if not exists(select 1 from storage.objects where name=path) then raise exception 'TEST FAILED: published file unreadable'; end if;
 if (select count(*) from public.course_catalog(c,'lecture'))<>2 then raise exception 'TEST FAILED: course catalog'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000404',true);
 if exists(select 1 from storage.objects where name=path) then raise exception 'TEST FAILED: foreign group reads file'; end if;
 if exists(select 1 from public.course_content where id=txt) then raise exception 'TEST FAILED: foreign group reads text'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000405',true);
 restriction:=public.deny_section('lectures',null,'00000000-0000-0000-0000-000000000301');
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000403',true);
 if public.read_course_material(txt) or exists(select 1 from storage.objects where name=path) then raise exception 'TEST FAILED: lecture denial ignored'; end if;
 if not public.read_course_material(material) then raise exception 'TEST FAILED: lecture denial affects materials'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000405',true);
 perform public.remove_denial(restriction);
 if (select used_bytes from public.library_quota())<>3 then raise exception 'TEST FAILED: shared quota excludes course files'; end if;
 perform public.begin_course_delete(fid);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000403',true);
 if exists(select 1 from storage.objects where name=path) then raise exception 'TEST FAILED: deleting file still published'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000405',true);
 delete from storage.objects where name=path;
 perform public.finish_course_delete(fid);
 perform public.begin_course_delete(txt);
 if exists(select 1 from public.course_content where id in (txt,fid)) then raise exception 'TEST FAILED: material deletion'; end if;
 raise notice 'Course contract assertions passed';
end $$;
rollback;
