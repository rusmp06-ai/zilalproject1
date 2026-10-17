begin;
do $$ begin if to_regclass('public.material_intakes') is null then raise exception 'Existing StudyHub v0.35 database required';end if;end $$;
create table if not exists public.weekly_schedule_days(group_id uuid references public.study_groups(id),weekday integer check(weekday between 1 and 7),version integer not null default 0,request_id uuid,payload jsonb,primary key(group_id,weekday));
create table if not exists public.weekly_schedule_slots(id uuid primary key,group_id uuid not null references public.study_groups(id),weekday integer not null check(weekday between 1 and 7),course_id uuid not null references public.courses(id),start_time time not null,end_time time not null,location text not null default '' check(length(location)<=200),starts_on date not null,author_id uuid not null references public.profiles(id),created_at timestamptz not null default now(),check(end_time>start_time));
create index if not exists weekly_slots_by_group on public.weekly_schedule_slots(group_id,weekday);
create table if not exists public.schedule_exceptions(slot_id uuid references public.weekly_schedule_slots(id) on delete cascade,day date not null,cancelled boolean not null,course_id uuid not null references public.courses(id),start_time time not null,end_time time not null,location text not null default '' check(length(location)<=200),version integer not null default 1,primary key(slot_id,day),check(end_time>start_time));
alter table public.weekly_schedule_days enable row level security;alter table public.weekly_schedule_slots enable row level security;alter table public.schedule_exceptions enable row level security;
revoke all on public.weekly_schedule_days,public.weekly_schedule_slots,public.schedule_exceptions from anon,authenticated;
create or replace function public.weekly_schedule_day(p_group uuid,p_day integer) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not public.write_group_board(p_group,null,'schedule') then raise exception 'Schedule management denied';end if;
 if exists(select 1 from public.weekly_schedule_slots where group_id=p_group and weekday=p_day and not public.write_group_board(p_group,course_id,'schedule')) then raise exception 'Schedule management denied';end if;
 return jsonb_build_object('version',coalesce((select version from public.weekly_schedule_days where group_id=p_group and weekday=p_day),0),'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'course_id',course_id,'start_time',to_char(start_time,'HH24:MI'),'end_time',to_char(end_time,'HH24:MI'),'location',location) order by start_time,id) from public.weekly_schedule_slots where group_id=p_group and weekday=p_day),'[]'::jsonb));
end $$;
create or replace function public.save_weekly_schedule(p_group uuid,p_day integer,p_items jsonb,p_version integer,p_request uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare state public.weekly_schedule_days; r jsonb; slot_id uuid; course uuid; start_at time; end_at time; seen uuid[]:='{}';last_end time;check_day date;
begin
 if not public.write_group_board(p_group,null,'schedule') then raise exception 'Schedule management denied';end if;
 if p_day is null or p_day not between 1 and 7 or p_request is null or p_version is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>24 then raise exception 'Invalid weekly schedule';end if;
 insert into public.weekly_schedule_days(group_id,weekday) values(p_group,p_day) on conflict do nothing;
 select * into state from public.weekly_schedule_days where group_id=p_group and weekday=p_day for update;
 if state.request_id=p_request then if state.payload=p_items then return;else raise exception 'Request changed';end if;end if;
 if exists(select 1 from public.weekly_schedule_slots where group_id=p_group and weekday=p_day and not public.write_group_board(p_group,course_id,'schedule')) then raise exception 'Schedule management denied';end if;
 if state.version<>p_version then raise exception 'Schedule changed. Refresh before saving';end if;
 for r in select value from jsonb_array_elements(p_items) order by value->>'start_time' loop
  slot_id:=(r->>'id')::uuid;course:=(r->>'course_id')::uuid;
  if slot_id is null or course is null or slot_id=any(seen) or coalesce(r->>'start_time','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(r->>'end_time','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or length(coalesce(r->>'location',''))>200 then raise exception 'Invalid lesson';end if;
  if not public.write_group_board(p_group,course,'schedule') or not exists(select 1 from public.courses where id=course and group_id=p_group and not archived) then raise exception 'Course unavailable in group';end if;
  if exists(select 1 from public.weekly_schedule_slots where id=slot_id and (group_id<>p_group or weekday<>p_day)) then raise exception 'Foreign lesson';end if;
  start_at:=(r->>'start_time')::time;end_at:=(r->>'end_time')::time;
  if end_at<=start_at or (last_end is not null and start_at<last_end) then raise exception 'Lessons overlap or invalid time';end if;
  last_end:=end_at;seen:=array_append(seen,slot_id);
  insert into public.weekly_schedule_slots(id,group_id,weekday,course_id,start_time,end_time,location,starts_on,author_id) values(slot_id,p_group,p_day,course,start_at,end_at,coalesce(r->>'location',''),date_trunc('week',now() at time zone 'Asia/Bishkek')::date,auth.uid()) on conflict(id) do update set course_id=excluded.course_id,start_time=excluded.start_time,end_time=excluded.end_time,location=excluded.location where weekly_schedule_slots.group_id=p_group and weekly_schedule_slots.weekday=p_day;
  if not found then raise exception 'Foreign lesson';end if;
 end loop;
 delete from public.weekly_schedule_slots where group_id=p_group and weekday=p_day and not(id=any(seen));
 -- A changed weekly pattern must remain compatible with dated exceptions.
 for check_day in select distinct e.day from public.schedule_exceptions e join public.weekly_schedule_slots t on t.id=e.slot_id where t.group_id=p_group and extract(isodow from e.day)=p_day and e.day>=(now() at time zone 'Asia/Bishkek')::date loop
  if exists(with entries as(select * from public.schedule_rows(p_group,check_day::timestamp at time zone 'Asia/Bishkek',(check_day+1)::timestamp at time zone 'Asia/Bishkek')) select 1 from entries a join entries b on a.id<b.id and a.starts_at<b.ends_at and a.ends_at>b.starts_at where not a.cancelled and not b.cancelled and a.template_id is not null and b.template_id is not null) then raise exception 'Lessons overlap or invalid time';end if;
 end loop;
 update public.weekly_schedule_days set version=version+1,request_id=p_request,payload=p_items where group_id=p_group and weekday=p_day;
 insert into public.audit_events(actor_id,action,entity_id,details) values(auth.uid(),'schedule.weekly.saved',p_group,jsonb_build_object('weekday',p_day,'lessons',jsonb_array_length(p_items)));
end $$;
-- A common expansion feeds the day, home screen, calendar and subject pages.
create or replace function public.schedule_rows(p_group uuid,p_from timestamptz,p_to timestamptz)
returns table(id uuid,group_id uuid,course_id uuid,kind text,title text,body text,location text,starts_at timestamptz,ends_at timestamptz,author_name text,created_at timestamptz,can_manage boolean,template_id uuid,occurrence_date date,cancelled boolean,version integer)
language sql stable security definer set search_path=pg_catalog as $$
 with dates as(select d::date as occurrence_day from generate_series((p_from at time zone 'Asia/Bishkek')::date::timestamp-interval '1 day',(p_to at time zone 'Asia/Bishkek')::date::timestamp,interval '1 day')d),occurrences as (
 select s.*,d.occurrence_day,e.cancelled,coalesce(e.course_id,s.course_id) effective_course,coalesce(e.start_time,s.start_time) effective_start,coalesce(e.end_time,s.end_time) effective_end,coalesce(e.location,s.location) effective_location,coalesce(e.version,0) exception_version
 from public.weekly_schedule_slots s join dates d on extract(isodow from d.occurrence_day)=s.weekday and d.occurrence_day>=s.starts_on left join public.schedule_exceptions e on e.slot_id=s.id and e.day=d.occurrence_day where s.group_id=p_group
 ), entries as (
 select b.id,b.group_id,b.course_id,b.kind,b.title,b.body,b.location,b.starts_at,b.ends_at,p.full_name author_name,b.created_at,public.write_group_board(b.group_id,b.course_id,b.kind,b.author_id) can_manage,null::uuid template_id,null::date occurrence_date,false cancelled,0 version
 from public.group_board b join public.profiles p on p.id=b.author_id where b.group_id=p_group and b.kind='schedule' and public.read_group_board(b.group_id,b.course_id,'schedule')
 union all
 select md5(o.id::text||o.occurrence_day::text)::uuid,o.group_id,o.effective_course,'schedule',c.title,case when coalesce(o.cancelled,false) then 'Занятие отменено' else '' end,o.effective_location,(o.occurrence_day+o.effective_start) at time zone 'Asia/Bishkek',(o.occurrence_day+o.effective_end) at time zone 'Asia/Bishkek',p.full_name,o.created_at,public.write_group_board(o.group_id,o.course_id,'schedule'),o.id,o.occurrence_day,coalesce(o.cancelled,false),o.exception_version
 from occurrences o join public.courses c on c.id=o.effective_course and not c.archived join public.courses original on original.id=o.course_id and not original.archived join public.profiles p on p.id=o.author_id where public.read_group_board(o.group_id,o.course_id,'schedule') and public.read_group_board(o.group_id,o.effective_course,'schedule')
 )select * from entries where ends_at>p_from and starts_at<p_to;
$$;
create or replace function public.schedule_catalog(p_group uuid,p_from timestamptz,p_to timestamptz,p_offset integer default 0)
returns table(id uuid,group_id uuid,course_id uuid,kind text,title text,body text,location text,starts_at timestamptz,ends_at timestamptz,author_name text,created_at timestamptz,can_manage boolean,template_id uuid,occurrence_date date,cancelled boolean,version integer) language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '370 days' then raise exception 'Invalid schedule window';end if;
 return query select r.* from public.schedule_rows(p_group,p_from,p_to) r order by r.starts_at,r.created_at desc,r.id limit 50 offset greatest(0,least(coalesce(p_offset,0),100000));
end $$;
create or replace function public.save_schedule_exception(p_slot uuid,p_date date,p_cancelled boolean,p_course uuid,p_start time,p_end time,p_location text,p_version integer,p_reset boolean default false) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare slot public.weekly_schedule_slots;current_version integer;from_at timestamptz;to_at timestamptz;
begin
 select * into slot from public.weekly_schedule_slots where id=p_slot;
 if not found or not public.write_group_board(slot.group_id,slot.course_id,'schedule') then raise exception 'Schedule management denied';end if;
 perform 1 from public.weekly_schedule_days where group_id=slot.group_id and weekday=slot.weekday for update;
 if p_date is null or extract(isodow from p_date)<>slot.weekday or p_date<slot.starts_on then raise exception 'Invalid occurrence date';end if;
 select coalesce((select version from public.schedule_exceptions where slot_id=p_slot and day=p_date),0) into current_version;
 if p_version is distinct from current_version then raise exception 'Schedule changed. Refresh before saving';end if;
 if p_reset then delete from public.schedule_exceptions where slot_id=p_slot and day=p_date;else
  if p_cancelled is null or p_start is null or p_end is null or p_end<=p_start or p_location is null or length(p_location)>200 or not exists(select 1 from public.courses where id=p_course and group_id=slot.group_id and not archived) then raise exception 'Invalid lesson';end if;
  from_at:=(p_date+p_start) at time zone 'Asia/Bishkek';to_at:=(p_date+p_end) at time zone 'Asia/Bishkek';
  if not p_cancelled and exists(select 1 from public.schedule_rows(slot.group_id,(p_date::timestamp at time zone 'Asia/Bishkek'),((p_date+1)::timestamp at time zone 'Asia/Bishkek')) where template_id is distinct from p_slot and not cancelled and starts_at<to_at and ends_at>from_at) then raise exception 'Lessons overlap or invalid time';end if;
  insert into public.schedule_exceptions(slot_id,day,cancelled,course_id,start_time,end_time,location,version) values(p_slot,p_date,p_cancelled,p_course,p_start,p_end,p_location,current_version+1) on conflict(slot_id,day) do update set cancelled=excluded.cancelled,course_id=excluded.course_id,start_time=excluded.start_time,end_time=excluded.end_time,location=excluded.location,version=excluded.version;
 end if;
 if p_reset and exists(with entries as(select * from public.schedule_rows(slot.group_id,p_date::timestamp at time zone 'Asia/Bishkek',(p_date+1)::timestamp at time zone 'Asia/Bishkek')) select 1 from entries a join entries b on a.starts_at<b.ends_at and a.ends_at>b.starts_at where a.template_id=p_slot and b.template_id is distinct from p_slot and not a.cancelled and not b.cancelled) then raise exception 'Lessons overlap or invalid time';end if;
 insert into public.audit_events(actor_id,action,entity_id,details) values(auth.uid(),'schedule.exception.saved',p_slot,jsonb_build_object('date',p_date,'reset',p_reset));
end $$;
revoke all on function public.weekly_schedule_day(uuid,integer),public.save_weekly_schedule(uuid,integer,jsonb,integer,uuid),public.schedule_rows(uuid,timestamptz,timestamptz),public.schedule_catalog(uuid,timestamptz,timestamptz,integer),public.save_schedule_exception(uuid,date,boolean,uuid,time,time,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.weekly_schedule_day(uuid,integer),public.save_weekly_schedule(uuid,integer,jsonb,integer,uuid),public.schedule_catalog(uuid,timestamptz,timestamptz,integer),public.save_schedule_exception(uuid,date,boolean,uuid,time,time,text,integer,boolean) to authenticated;
commit;
