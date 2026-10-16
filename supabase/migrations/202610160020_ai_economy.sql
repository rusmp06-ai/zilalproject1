begin;
create table if not exists public.material_ai_limits(singleton boolean primary key default true check(singleton),user_daily integer not null default 5 check(user_daily between 1 and 1000),project_daily integer not null default 20 check(project_daily between 1 and 10000),rpm integer not null default 2 check(rpm between 1 and 1000),tpm integer not null default 12000 check(tpm between 1000 and 1000000),max_input integer not null default 8000 check(max_input>0),max_output integer not null default 2048 check(max_output>0),blocked_until timestamptz,check(max_input+max_output<=tpm));
insert into public.material_ai_limits(singleton) values(true) on conflict do nothing;
create table if not exists public.material_ai_runs(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),cache_key text not null,started_at timestamptz not null default clock_timestamp(),tokens integer not null check(tokens>=0),status text not null default 'running' check(status in ('running','ready','failed')));
create index if not exists material_ai_runs_recent on public.material_ai_runs(started_at);
create table if not exists public.material_ai_cache(user_id uuid not null references public.profiles(id),cache_key text not null check(cache_key~'^[a-f0-9]{64}$'),result jsonb not null,expires_at timestamptz not null default now()+interval '7 days',primary key(user_id,cache_key));
alter table public.material_ai_limits enable row level security;
alter table public.material_ai_runs enable row level security;
alter table public.material_ai_cache enable row level security;
revoke all on public.material_ai_limits,public.material_ai_runs,public.material_ai_cache from public,anon,authenticated;
create or replace function public.material_ai_quota_for(p_user uuid) returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('user_daily',l.user_daily,'project_daily',l.project_daily,'rpm',l.rpm,'tpm',l.tpm,'max_input',l.max_input,'max_output',l.max_output,
 'user_remaining',greatest(0,l.user_daily-coalesce((select requests from public.material_ai_usage where user_id=p_user and day=(now() at time zone 'Asia/Bishkek')::date),0)),
 'project_remaining',greatest(0,l.project_daily-(select coalesce(sum(requests),0) from public.material_ai_usage where day=(now() at time zone 'Asia/Bishkek')::date)),
 'minute_remaining',greatest(0,l.rpm-(select count(*) from public.material_ai_runs where started_at>now()-interval '60 seconds')),
 'tokens_remaining',greatest(0,l.tpm-(select coalesce(sum(tokens),0) from public.material_ai_runs where started_at>now()-interval '60 seconds')),
 'retry_after_seconds',greatest(0,ceil(extract(epoch from coalesce(l.blocked_until,now())-now())))::integer,
 'resets_at',(((now() at time zone 'Asia/Bishkek')::date+1)::timestamp at time zone 'Asia/Bishkek')) from public.material_ai_limits l where singleton;
$$;
create or replace function public.material_ai_quota() returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$begin perform public.material_intake_context();return public.material_ai_quota_for(auth.uid());end $$;
-- Claims and completions are server-only. Browser clients cannot forge usage or poison cache.
create or replace function public.claim_material_analysis(p_user uuid,p_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare q jsonb;l public.material_ai_limits%rowtype;cached jsonb;run uuid;today date:=(now() at time zone 'Asia/Bishkek')::date;
begin
 if p_key is null or p_key!~'^[a-f0-9]{64}$' or not exists(select 1 from public.profiles where id=p_user and not blocked) then raise exception 'Account unavailable';end if;
 perform pg_advisory_xact_lock(730049);
 select result into cached from public.material_ai_cache where user_id=p_user and cache_key=p_key and expires_at>now();
 if found then return jsonb_build_object('status','cached','analysis',cached,'quota',public.material_ai_quota_for(p_user));end if;
 q:=public.material_ai_quota_for(p_user);select * into l from public.material_ai_limits where singleton;
 if exists(select 1 from public.material_ai_runs where user_id=p_user and cache_key=p_key and status='running' and started_at>now()-interval '90 seconds') then return jsonb_build_object('status','busy','quota',q);end if;
 if (q->>'user_remaining')::int=0 or (q->>'project_remaining')::int=0 or (q->>'minute_remaining')::int=0 or (q->>'tokens_remaining')::int<l.max_output+1 or (q->>'retry_after_seconds')::int>0 then return jsonb_build_object('status','limited','quota',q);end if;
 insert into public.material_ai_usage values(p_user,today,1) on conflict(user_id,day) do update set requests=public.material_ai_usage.requests+1;
 insert into public.material_ai_runs(user_id,cache_key,tokens) values(p_user,p_key,l.max_output) returning id into run;
 delete from public.material_ai_runs where started_at<now()-interval '32 days';delete from public.material_ai_cache where expires_at<now();
 return jsonb_build_object('status','claimed','reservation',run,'quota',public.material_ai_quota_for(p_user));
end $$;
create or replace function public.meter_material_analysis(p_id uuid,p_input integer) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare l public.material_ai_limits%rowtype;r public.material_ai_runs%rowtype;
begin
 perform pg_advisory_xact_lock(730049);select * into l from public.material_ai_limits where singleton;select * into r from public.material_ai_runs where id=p_id for update;
 if not found or r.status<>'running' or r.started_at<now()-interval '90 seconds' then return false;end if;
 if p_input is null or p_input<1 or p_input>l.max_input or (select coalesce(sum(tokens),0) from public.material_ai_runs where id<>p_id and started_at>now()-interval '60 seconds')+p_input+l.max_output>l.tpm then update public.material_ai_runs set status='failed' where id=p_id;return false;end if;
 update public.material_ai_runs set tokens=p_input+l.max_output,started_at=clock_timestamp() where id=p_id;return true;
end $$;
create or replace function public.finish_material_analysis(p_id uuid,p_result jsonb default null,p_pause integer default 0) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare r public.material_ai_runs%rowtype;
begin
 perform pg_advisory_xact_lock(730049);select * into r from public.material_ai_runs where id=p_id for update;if not found or r.status<>'running' then return;end if;
 if p_result is not null and r.started_at>now()-interval '90 seconds' then
  insert into public.material_ai_cache(user_id,cache_key,result) values(r.user_id,r.cache_key,p_result) on conflict(user_id,cache_key) do update set result=excluded.result,expires_at=now()+interval '7 days';
  -- Bound the amount of retained classification text per user.
  delete from public.material_ai_cache where user_id=r.user_id and cache_key in(select cache_key from public.material_ai_cache where user_id=r.user_id order by expires_at desc,cache_key offset 100);
  update public.material_ai_runs set status='ready' where id=p_id;
 else update public.material_ai_runs set status='failed' where id=p_id;end if;
 if p_pause>0 then update public.material_ai_limits set blocked_until=greatest(coalesce(blocked_until,now()),now()+make_interval(secs=>least(p_pause,3600))) where singleton;end if;
end $$;
revoke all on function public.material_ai_quota_for(uuid) from public,anon,authenticated;
grant execute on function public.material_ai_quota_for(uuid) to service_role;
revoke all on function public.material_ai_quota() from public,anon;
grant execute on function public.material_ai_quota() to authenticated;
revoke all on function public.claim_material_analysis(uuid,text),public.meter_material_analysis(uuid,integer),public.finish_material_analysis(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.claim_material_analysis(uuid,text),public.meter_material_analysis(uuid,integer),public.finish_material_analysis(uuid,jsonb,integer) to service_role;
revoke all on function public.begin_material_analysis() from public,anon,authenticated;
commit;
