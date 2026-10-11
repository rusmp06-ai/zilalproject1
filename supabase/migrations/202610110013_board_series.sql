begin;
create function public.save_board_series(p_group uuid,p_course uuid,p_title text,p_body text,p_location text,p_start timestamptz,p_end timestamptz,p_weeks integer) returns uuid[]
language plpgsql security definer set search_path=pg_catalog as $$
declare ids uuid[]:='{}'; i integer;
begin
 if p_weeks is null or p_weeks not between 1 and 16 or p_start is null or p_end is null then raise exception 'Invalid repeat';end if;
 for i in 0..p_weeks-1 loop
  ids:=array_append(ids,public.save_group_board(p_group,p_course,'schedule',p_title,p_body,p_location,p_start+i*interval '7 days',p_end+i*interval '7 days',null));
 end loop;
 return ids;
end $$;
revoke all on function public.save_board_series(uuid,uuid,text,text,text,timestamptz,timestamptz,integer) from public,anon;
grant execute on function public.save_board_series(uuid,uuid,text,text,text,timestamptz,timestamptz,integer) to authenticated;
commit;
