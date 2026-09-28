-- members_members: members, their positions, and the helpers every policy
-- starts from (AD-5).
--
-- - `members.id` is the `auth.users` id. A trigger on `auth.users` creates
--   the row, always `pending` with no position. Nothing else inserts members:
--   seed.sql and scripts/staging-personas.mjs create auth users and then
--   update these rows.
-- - `members.role` follows from the positions held: none is `pending`, only
--   Staff positions is `staff`, any Board position is `editorial_admin`.
--   Triggers on `member_positions` and on `positions.is_board` keep it in
--   step, and any write that would make it disagree raises
--   `members.role_follows_positions`.
-- - The `private` helpers read role and positions from these tables, never
--   from JWT claims. Story 2.1 adds `declined_at` and `deactivated_at`, and
--   these helpers change with it.
-- - Clients read through RLS (their own row, or every row for admins) and
--   write nothing: later stories add commands.

create type public.member_role as enum ('pending', 'staff', 'editorial_admin');

create table public.members (
  id uuid primary key references auth.users (id) on delete cascade,
  -- Not blank: whitespace of any kind (tabs and newlines too) doesn't count.
  name text not null
    constraint members_name_length check (
      char_length(name) <= 200
      and regexp_replace(name, '^[[:space:]]+|[[:space:]]+$', '', 'g') <> ''
    ),
  -- Only a short http(s) URL; the new-user trigger drops anything else.
  avatar_url text
    constraint members_avatar_url_format
      check (avatar_url ~ '^https?://\S+$' and char_length(avatar_url) <= 100),
  email text not null
    constraint members_email_normalized check (email = lower(btrim(email))),
  role public.member_role not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.members (id) on delete set null
);

-- A member's positions: none while pending, and exactly one primary once
-- active (pgTAP asserts the second; a mid-transaction change can't hold it).
create table public.member_positions (
  member_id uuid not null references public.members (id) on delete cascade,
  position text not null references public.positions (id),
  is_primary boolean not null default false,
  primary key (member_id, position)
);

create index member_positions_position_idx on public.member_positions (position);

-- At most one primary position per member.
create unique index member_positions_one_primary
  on public.member_positions (member_id)
  where is_primary;

-- At most one Editor-in-Chief.
create unique index member_positions_one_editor_in_chief
  on public.member_positions (position)
  where position = 'editor_in_chief';

-- The role a set of positions implies.
create function private.role_for_positions(p_member_id uuid)
returns public.member_role
language sql
stable
set search_path = ''
as $$
  select case
    when coalesce(bool_or(p.is_board), false) then 'editorial_admin'::public.member_role
    when count(*) > 0 then 'staff'::public.member_role
    else 'pending'::public.member_role
  end
  from public.member_positions mp
  join public.positions p on p.id = mp.position
  where mp.member_id = p_member_id
$$;

-- A new auth user becomes a pending member with no position. Only the name
-- and a short avatar URL come from metadata; any role or positions there
-- are ignored. The name, trimmed of any whitespace (tabs and newlines too),
-- falls back from `full_name` to `name` to the email's local part, capped at
-- 200 characters.
--
-- Supabase Auth inserts users as `supabase_auth_admin`, so this must be a
-- `security definer` function owned by `postgres` with an empty search_path;
-- supabase/tests/members/members.test.sql pins all three, and that the
-- trigger is enabled.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(new.email));
  v_avatar text := new.raw_user_meta_data ->> 'avatar_url';
  v_trim constant text := '^[[:space:]]+|[[:space:]]+$';
begin
  insert into public.members (id, name, avatar_url, email)
  values (
    new.id,
    left(
      coalesce(
        nullif(regexp_replace(new.raw_user_meta_data ->> 'full_name', v_trim, '', 'g'), ''),
        nullif(regexp_replace(new.raw_user_meta_data ->> 'name', v_trim, '', 'g'), ''),
        nullif(regexp_replace(split_part(v_email, '@', 1), v_trim, '', 'g'), ''),
        'Member'
      ),
      200
    ),
    case
      when v_avatar ~ '^https?://\S+$' and char_length(v_avatar) <= 100
        then v_avatar
    end,
    v_email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Keeps `members.role` equal to the role the positions imply, for the old and
-- the new member of each changed row.
create function private.sync_member_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
begin
  for v_member_id in
    select distinct affected.id
    from (
      select old.member_id as id where tg_op in ('UPDATE', 'DELETE')
      union all
      select new.member_id where tg_op in ('INSERT', 'UPDATE')
    ) as affected
  loop
    update public.members m
    set role = private.role_for_positions(v_member_id),
        updated_at = now()
    where m.id = v_member_id
      and m.role is distinct from private.role_for_positions(v_member_id);
  end loop;
  return null;
end;
$$;

create trigger member_positions_sync_role
  after insert or update or delete on public.member_positions
  for each row execute function private.sync_member_role();

-- Re-syncs the holders of a position whose Board flag changes, since that
-- changes the role their positions imply. Reference data changes only by
-- migration, but a migration that moved a position on or off the Board would
-- otherwise leave roles stale.
create function private.sync_position_holders_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.members m
  set role = private.role_for_positions(m.id),
      updated_at = now()
  where m.id in (
      select mp.member_id
      from public.member_positions mp
      where mp.position = new.id
    )
    and m.role is distinct from private.role_for_positions(m.id);
  return null;
end;
$$;

create trigger positions_sync_holders_role
  after update of is_board on public.positions
  for each row
  when (old.is_board is distinct from new.is_board)
  execute function private.sync_position_holders_role();

-- The rule itself: a member's role is always the role their positions imply.
-- A new member has no positions, so they start `pending`; the syncs above
-- write the implied role, and any other value raises. Writing the value it
-- already has is a no-op.
create function private.guard_member_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from private.role_for_positions(new.id) then
    raise exception using
      errcode = 'P0001',
      message = 'members.role_follows_positions';
  end if;
  return new;
end;
$$;

create trigger members_role_follows_positions
  before insert or update of role on public.members
  for each row execute function private.guard_member_role();

-- The helpers every policy and command starts from. Each returns false or
-- null for a caller who isn't an active member.

-- The caller's member id, only if they are active.
create function private.current_member_id()
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select m.id
  from public.members m
  where m.id = (select auth.uid())
    and m.role <> 'pending'
$$;

-- The caller is an active member (role `staff` or `editorial_admin`).
create function private.is_active_member()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    where m.id = (select auth.uid())
      and m.role <> 'pending'
  )
$$;

-- The caller is an active Editorial Board member.
create function private.is_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    where m.id = (select auth.uid())
      and m.role = 'editorial_admin'
  )
$$;

-- The caller is active and holds Editor-in-Chief, Associate Editor or
-- Managing Editor.
create function private.is_top_editor()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    join public.member_positions mp on mp.member_id = m.id
    join public.positions p on p.id = mp.position
    where m.id = (select auth.uid())
      and m.role <> 'pending'
      and p.is_top_editor
  )
$$;

grant execute on function
  private.current_member_id(),
  private.is_active_member(),
  private.is_admin(),
  private.is_top_editor()
to authenticated;

alter table public.members enable row level security;
alter table public.member_positions enable row level security;

-- Everyone reads their own row and positions; admins read every row. Active
-- members see other members only through `member_directory` (Story 1.7).
create policy members_select_self_or_admin
  on public.members
  for select
  to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

create policy member_positions_select_self_or_admin
  on public.member_positions
  for select
  to authenticated
  using (member_id = (select auth.uid()) or (select private.is_admin()));

grant select on public.members, public.member_positions to authenticated;
