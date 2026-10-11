begin;
create table public.course_reader_states (
 user_id uuid not null references public.profiles(id),
 item_id uuid not null references public.course_content(id) on delete cascade,
 page integer not null default 1 check(page between 1 and 100000),
 total_pages integer not null default 0 check(total_pages between 0 and 100000),
 favorite boolean not null default false,
 bookmarks integer[] not null default '{}',
 version integer not null default 1,
 updated_at timestamptz not null default now(),
 primary key(user_id,item_id),check(total_pages=0 or page<=total_pages)
);
alter table public.course_reader_states enable row level security;
revoke all on public.course_reader_states from anon,authenticated;
grant select on public.course_reader_states to authenticated;
create function public.can_read_course_document(p_item uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select public.is_active_user() and public.read_course_material(p_item) and exists(
 select 1 from public.course_content i join public.files f on f.id=i.file_id
 join public.course_uploads u on u.content_id=i.id
 where i.id=p_item and i.kind<>'assignment' and u.status='published' and f.status='ready');
$$;
create policy reader_own on public.course_reader_states for select to authenticated
 using(user_id=auth.uid() and public.can_read_course_document(item_id));
create function public.course_reader_state(p_item uuid) returns setof public.course_reader_states
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not public.can_read_course_document(p_item) then raise exception 'Reading access denied'; end if;
 return query select * from public.course_reader_states where item_id=p_item and user_id=auth.uid();
end $$;
create function public.save_course_reader_state(p_item uuid,p_page integer,p_total integer,p_favorite boolean,p_bookmarks integer[],p_version integer)
returns public.course_reader_states language plpgsql security definer set search_path=pg_catalog as $$
declare result public.course_reader_states; marks integer[];
begin
 -- The same lock serializes quotas and writes from this user's devices.
 if not public.can_read_course_document(p_item) then raise exception 'Reading access denied'; end if;
 if p_page is null or p_page not between 1 and 100000 or p_total is null or p_total not between 0 and 100000
 or (p_total=0 and p_page<>1) or (p_total>0 and p_page>p_total)
 or p_favorite is distinct from false or p_bookmarks is null or cardinality(p_bookmarks)>100
 or exists(select 1 from unnest(p_bookmarks) b where b is null or b<1 or b>p_total)
 or p_version is null or p_version<0 then raise exception 'Invalid reading state'; end if;
 select coalesce(array_agg(distinct b order by b),'{}') into marks from unnest(p_bookmarks) b;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,742));
 -- Lock the item against concurrent deletion before saving its metadata.
 perform 1 from public.course_content where id=p_item for share;
 if not found or not public.can_read_course_document(p_item) then raise exception 'Reading access denied'; end if;
 if p_version=0 then
  if exists(select 1 from public.course_reader_states where user_id=auth.uid() and item_id=p_item) then raise exception 'Reading state changed. Refresh before saving'; end if;
  if (select count(*) from public.course_reader_states where user_id=auth.uid())>=1000 then raise exception 'Reading state limit reached'; end if;
  insert into public.course_reader_states(user_id,item_id,page,total_pages,favorite,bookmarks)
   values(auth.uid(),p_item,p_page,p_total,p_favorite,marks) returning * into result;
 else
  update public.course_reader_states set page=p_page,total_pages=p_total,favorite=p_favorite,bookmarks=marks,version=version+1,updated_at=clock_timestamp()
   where user_id=auth.uid() and item_id=p_item and version=p_version returning * into result;
  if not found then raise exception 'Reading state changed. Refresh before saving'; end if;
 end if;
 return result;
end $$;
revoke all on function public.can_read_course_document(uuid),public.course_reader_state(uuid),public.save_course_reader_state(uuid,integer,integer,boolean,integer[],integer) from public,anon;
grant execute on function public.can_read_course_document(uuid),public.course_reader_state(uuid),public.save_course_reader_state(uuid,integer,integer,boolean,integer[],integer) to authenticated;
commit;
