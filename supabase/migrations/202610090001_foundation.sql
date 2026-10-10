-- Foundation only. No client grants/policies: intentionally inaccessible until reviewed RLS is added.
begin;
create extension if not exists pgcrypto;
create type public.group_role as enum ('student','leader','teacher');
create type public.content_kind as enum ('lecture','presentation','material','assignment');
create table public.profiles (
 id uuid primary key references auth.users(id),
 full_name text not null check (length(trim(full_name)) between 1 and 150),
 blocked boolean not null default false,
 created_at timestamptz not null default now()
);
-- Owner assigned only by trusted bootstrap, never via signup metadata.
create table public.platform_owners (
 user_id uuid primary key references public.profiles(id)
);
create table public.study_groups (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 1 and 100),
 created_by uuid not null references public.profiles(id),
 blocked boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.group_memberships (
 group_id uuid not null references public.study_groups(id),
 user_id uuid not null references public.profiles(id),
 role public.group_role not null,
 active boolean not null default true,
 primary key (group_id,user_id,role)
);
create table public.courses (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.study_groups(id),
 title text not null check (length(trim(title)) between 1 and 200),
 archived boolean not null default false,
 unique(id,group_id)
);
create table public.teaching_assignments (
 course_id uuid not null,
 group_id uuid not null,
 teacher_id uuid not null,
 teacher_role public.group_role not null default 'teacher' check (teacher_role='teacher'),
 primary key(course_id,teacher_id),
 foreign key(course_id,group_id) references public.courses(id,group_id),
 foreign key(group_id,teacher_id,teacher_role) references public.group_memberships(group_id,user_id,role)
);
create table public.invitations (
 id uuid primary key default gen_random_uuid(),
 token_hash text not null unique,
 role public.group_role not null,
 group_id uuid references public.study_groups(id),
 created_by uuid not null references public.profiles(id),
 expires_at timestamptz not null,
 max_uses integer not null check(max_uses>0),
 used_count integer not null default 0 check(used_count>=0 and used_count<=max_uses),
 revoked boolean not null default false,
 check(group_id is not null or role='leader')
);
create table public.invitation_courses (
 invitation_id uuid not null references public.invitations(id),
 course_id uuid not null references public.courses(id),
 primary key(invitation_id,course_id)
);
-- Server must check that each course belongs to invitation's group during redemption.
create table public.access_denials (
 id uuid primary key default gen_random_uuid(),
 user_id uuid references public.profiles(id),
 group_id uuid references public.study_groups(id),
 section text not null check(section in ('library','lectures','presentations','materials','assignments','course')),
 course_id uuid references public.courses(id),
 reason text,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 check ((user_id is not null)::integer + (group_id is not null)::integer = 1),
 check((section='course')=(course_id is not null))
);
create table public.files (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id),
 storage_path text not null unique,
 original_name text not null,
 mime_type text not null,
 size_bytes bigint not null check(size_bytes>0),
 created_at timestamptz not null default now()
);
create table public.library_items (
 id uuid primary key default gen_random_uuid(),
 author_id uuid not null references public.profiles(id),
 source_group_id uuid not null references public.study_groups(id),
 file_id uuid not null references public.files(id),
 title text not null,
 created_at timestamptz not null default now()
);
create table public.course_content (
 id uuid primary key default gen_random_uuid(),
 course_id uuid not null references public.courses(id),
 author_id uuid not null references public.profiles(id),
 kind public.content_kind not null,
 title text not null,
 body text,
 file_id uuid references public.files(id),
 published_at timestamptz
);
create table public.audit_events (
 id bigint generated always as identity primary key,
 actor_id uuid references public.profiles(id),
 action text not null,
 entity_id uuid,
 details jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create index memberships_by_user on public.group_memberships(user_id,group_id);
create index courses_by_group on public.courses(group_id);
create index denials_by_user on public.access_denials(user_id,section);
create index denials_by_group on public.access_denials(group_id,section);
create index content_by_course on public.course_content(course_id,kind);
do $$ declare t text; begin
 foreach t in array array['profiles','platform_owners','study_groups','group_memberships','courses','teaching_assignments','invitations','invitation_courses','access_denials','files','library_items','course_content','audit_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on table public.%I from anon, authenticated',t);
 end loop;
end $$;
commit;
