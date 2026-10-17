begin;
do $$ begin
 if to_regclass('public.private_tasks') is null or to_regclass('public.material_intakes') is null then
  raise exception 'Existing StudyHub database v0.35 required. Check selected project; no changes applied.';
 end if;
end $$;
-- Only visible note text is indexed, not the JSON metadata used to link notes.
create or replace function public.study_search_text(body text) returns text
language plpgsql immutable set search_path=pg_catalog as $$
declare value jsonb;
begin
 begin value:=body::jsonb;exception when others then return coalesce(body,'');end;
 if jsonb_typeof(value)='object' then
  if value->>'studyhub_reader_note'='1' then return coalesce(value->>'text','')||' '||coalesce(value->>'quote','');end if;
  if value->>'studyhub_course_note'='1' then return coalesce(value->>'text','');end if;
  if value->>'studyhub_plan'='1' then return coalesce(value->>'details','');end if;
 end if;
 return coalesce(body,'');
end $$;
create or replace function public.study_search_vector(title text,body text) returns tsvector
language sql immutable set search_path=pg_catalog as $$
 select setweight(to_tsvector('pg_catalog.russian',coalesce(title,'')),'A')||setweight(to_tsvector('pg_catalog.russian',coalesce(body,'')),'B');
$$;
create index if not exists courses_search_gin on public.courses using gin(public.study_search_vector(title,''));
create index if not exists content_search_gin on public.course_content using gin(public.study_search_vector(title,body));
create index if not exists assignments_search_gin on public.assignments using gin(public.study_search_vector(title,description));
create index if not exists library_search_gin on public.library_items using gin(public.study_search_vector(title,''));
create index if not exists filenames_search_gin on public.files using gin(public.study_search_vector(original_name,''));
create index if not exists notes_search_gin on public.private_notes using gin(public.study_search_vector(title,public.study_search_text(body)));
create index if not exists tasks_search_gin on public.private_tasks using gin(public.study_search_vector(title,public.study_search_text(body)));
create or replace function public.study_search(p_query text,p_kind text default 'all',p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare raw text; query tsquery; lexemes text; result jsonb;
begin
 if not public.is_active_user() then raise exception 'Search access denied';end if;
 raw:=lower(trim(p_query));
 if raw is null or length(raw)<2 or length(raw)>200 or p_kind is null or p_kind not in ('all','course','material','assignment','book','note') or p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'Invalid search';end if;
 -- Lexemes come from the text parser, not from user-supplied tsquery syntax.
 select string_agg(quote_literal(word)||':*',' & ') into lexemes from unnest(tsvector_to_array(to_tsvector('pg_catalog.russian',raw))) word;
 if lexemes is null then return jsonb_build_object('items','[]'::jsonb,'hasMore',false,'issues','[]'::jsonb);end if;
 query:=to_tsquery('pg_catalog.russian',lexemes);
 with docs as (
  select 'course'::text kind,c.id,c.title,''::text body,c.id course_id,c.title course_title,false has_file,null::timestamptz due,null::text status,public.study_search_vector(c.title,'') vec
  from public.courses c where p_kind in ('all','course') and not c.archived and public.can_view_course(c.id) and public.study_search_vector(c.title,'')@@query
  union all
  select 'material',i.id,i.title,coalesce(i.body,'')||' '||coalesce(f.original_name,''),c.id,c.title,i.file_id is not null,null,null,public.study_search_vector(i.title,i.body)||public.study_search_vector(f.original_name,'')
  from public.course_content i join public.courses c on c.id=i.course_id left join public.files f on f.id=i.file_id
  where p_kind in ('all','material') and not c.archived and i.kind in ('lecture','presentation','material') and i.published_at<=now() and (i.file_id is null or f.status='ready') and public.read_course_material(i.id)
   and (public.study_search_vector(i.title,i.body)@@query or public.study_search_vector(f.original_name,'')@@query)
  union all
  select 'assignment',a.id,a.title,a.description,c.id,c.title,false,a.due_at,
   case when public.can_submit_assignment(a.id) then coalesce((select w.status from public.submissions w where w.assignment_id=a.id and w.student_id=auth.uid() order by w.attempt_no desc limit 1),'not_submitted') end,
   public.study_search_vector(a.title,a.description)
  from public.assignments a join public.courses c on c.id=a.course_id where p_kind in ('all','assignment') and not c.archived and public.can_read_assignment(a.id) and public.study_search_vector(a.title,a.description)@@query
  union all
  select 'book',i.id,i.title,f.original_name,null,null,true,null,null,public.study_search_vector(i.title,'')||public.study_search_vector(f.original_name,'')
  from public.library_items i join public.files f on f.id=i.file_id where p_kind in ('all','book') and i.status='published' and f.status='ready' and public.has_section_access('library') and public.read_library_file(f.storage_path)
   and (public.study_search_vector(i.title,'')@@query or public.study_search_vector(f.original_name,'')@@query)
  union all
  select 'note',n.id,n.title,public.study_search_text(n.body),null,null,false,null,null,public.study_search_vector(n.title,public.study_search_text(n.body))
  from public.private_notes n where p_kind in ('all','note') and n.user_id=auth.uid() and not public.is_plan_record(n.body) and public.study_search_vector(n.title,public.study_search_text(n.body))@@query
  union all
  select 'plan',n.id,n.title,public.study_search_text(n.body),null,null,false,
   case when public.is_plan_record(n.body) then ((n.body::jsonb->>'due')||'T23:59:59+06:00')::timestamptz end,
   case when public.is_plan_record(n.body) and n.body::jsonb->>'done'='true' then 'completed' else 'pending' end,
   public.study_search_vector(n.title,public.study_search_text(n.body))
  from public.private_tasks n where p_kind in ('all','assignment') and n.user_id=auth.uid() and public.is_plan_record(n.body) and public.study_search_vector(n.title,public.study_search_text(n.body))@@query
 ), ranked as (
  select *,case when lower(title)=raw then 100 when starts_with(lower(title),raw) then 70 when public.study_search_vector(title,'')@@query then 50 else 0 end+ts_rank_cd(vec,query) score from docs
 ), page as (select * from ranked order by score desc,title,kind,id limit 26 offset p_offset), numbered as (select *,row_number() over(order by score desc,title,kind,id) n from page)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'id',id,'title',title,
  'highlightedTitle',ts_headline('pg_catalog.russian',title,query,'StartSel=⟦,StopSel=⟧,HighlightAll=true'),
  'snippet',left(ts_headline('pg_catalog.russian',case when body='' then title else body end,query,'StartSel=⟦,StopSel=⟧,MaxWords=32,MinWords=12,MaxFragments=1'),500),
  'courseId',course_id,'courseTitle',course_title,'hasFile',has_file,'due',due,'status',status) order by score desc,title,kind,id) from numbered where n<=25),'[]'::jsonb),
  'hasMore',exists(select 1 from numbered where n=26),'issues','[]'::jsonb) into result;
 return result;
end $$;
create or replace function public.study_search_note(p_id uuid) returns setof public.private_notes
language sql stable security definer set search_path=pg_catalog as $$
 select * from public.private_notes n where n.id=p_id and n.user_id=auth.uid() and public.is_active_user() and not public.is_plan_record(n.body);
$$;
revoke all on function public.study_search(text,text,integer),public.study_search_note(uuid) from public,anon;
grant execute on function public.study_search(text,text,integer),public.study_search_note(uuid) to authenticated;
commit;
