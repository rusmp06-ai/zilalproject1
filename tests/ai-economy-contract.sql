begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000002001');
insert into public.profiles(id,full_name) values('00000000-0000-0000-0000-000000002001','AI economy owner');
insert into public.platform_owners values('00000000-0000-0000-0000-000000002001');
insert into public.study_groups(id,name,created_by) values('00000000-0000-0000-0000-000000002003','Economy group','00000000-0000-0000-0000-000000002001');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002001',true);
set local role authenticated;
do $$begin if public.material_ai_quota()->>'user_remaining'<>'5' then raise exception 'Wrong initial budget';end if;begin perform public.claim_material_analysis(auth.uid(),repeat('a',64));raise exception 'Client could forge claim';exception when insufficient_privilege then null;end;begin perform public.begin_material_analysis();raise exception 'Legacy budget bypass';exception when insufficient_privilege then null;end;begin perform public.material_ai_quota_for(auth.uid());raise exception 'Private quota helper exposed';exception when insufficient_privilege then null;end;end $$;
reset role;
-- Root invokes server-only helpers, as the Edge service role would do.
select set_config('test.ai_claim',public.claim_material_analysis('00000000-0000-0000-0000-000000002001',repeat('a',64))::text,true);
do $$declare x jsonb;begin x:=public.claim_material_analysis('00000000-0000-0000-0000-000000002001',repeat('a',64));if x->>'status'<>'busy' then raise exception 'Concurrent duplicate not blocked';end if;end $$;
select public.meter_material_analysis((current_setting('test.ai_claim')::jsonb->>'reservation')::uuid,1000);
select public.finish_material_analysis((current_setting('test.ai_claim')::jsonb->>'reservation')::uuid,'{"kind":"lecture","title":"Saved"}');
do $$declare x jsonb;begin x:=public.claim_material_analysis('00000000-0000-0000-0000-000000002001',repeat('a',64));if x->>'status'<>'cached' or x->'quota'->>'user_remaining'<>'4' then raise exception 'Cache spent another request';end if;end $$;
select set_config('test.ai_claim2',public.claim_material_analysis('00000000-0000-0000-0000-000000002001',repeat('b',64))::text,true);
do $$begin if public.meter_material_analysis((current_setting('test.ai_claim2')::jsonb->>'reservation')::uuid,8001) then raise exception 'Input token cap bypassed';end if;if public.claim_material_analysis('00000000-0000-0000-0000-000000002001',repeat('c',64))->>'status'<>'limited' then raise exception 'RPM exceeded';end if;end $$;
-- A cached answer remains available even with no daily capacity or a provider pause.
update public.material_ai_limits set blocked_until=now()+interval '2 minutes',user_daily=1;
do $$begin if public.claim_material_analysis('00000000-0000-0000-0000-000000002001',repeat('a',64))->>'status'<>'cached' then raise exception 'Budget blocked cached response';end if;end $$;
-- Another user must not see the same hash's cached text.
insert into auth.users(id) values('00000000-0000-0000-0000-000000002002');insert into public.profiles(id,full_name) values('00000000-0000-0000-0000-000000002002','Other');
do $$begin if public.claim_material_analysis('00000000-0000-0000-0000-000000002002',repeat('a',64))->>'status'='cached' then raise exception 'Cross-user cache leak';end if;end $$;
rollback;
