-- members_account_states: declined and deactivated members, and sign-up
-- refused for everything but Google (Story 2.1).
--
-- - `declined_at` is set by Story 2.2's decline command, on a pending member
--   only (the CHECK). The row is kept, so the same Google account signing in
--   again finds its old member and is never queued twice: the new-user
--   trigger fires on `auth.users` inserts only.
-- - `deactivated_at` is set by Epic 5's deactivate command. Role and
--   positions stay as they were, so history still reads right.
-- - `private.is_member_active` is still the one definition of active: a role
--   other than `pending`, and neither timestamp set. Every helper, policy,
--   `member_directory` and `create_task` follow it unchanged.
-- - A caller who isn't active reads their own `members` row and nothing else:
--   `member_directory` and their own `member_positions` rows close to them.
-- - `private.before_user_created` is the Auth hook that refuses every new
--   account not coming from Google, so email self sign-up stays closed while
--   `[auth] enable_signup` is on (Google needs it) and `[auth.email]
--   enable_signup` stays on (persona password sign-in needs it).

alter table public.members
  add column declined_at timestamptz,
  add column deactivated_at timestamptz,
  add constraint members_declined_only_pending
    check (declined_at is null or role = 'pending');

create or replace function private.is_member_active(p_member_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    where m.id = p_member_id
      and m.role <> 'pending'
      and m.declined_at is null
      and m.deactivated_at is null
  )
$$;

-- A view reads tables with its owner's rights but checks EXECUTE on the
-- functions it calls against the querying role. Story 1.13 granted
-- is_member_active to nobody, so every `authenticated` read of
-- member_directory failed with "permission denied for function
-- is_member_active". `private` isn't exposed through the Data API, so this
-- doesn't make the helper callable as an RPC; it is granted like the other
-- helpers policies and views call.
grant execute on function private.is_member_active(uuid) to authenticated;

-- Unchanged but for the last line: only an active caller reads the
-- directory. It runs with its owner's rights, so the caller check is here
-- rather than in a policy.
create or replace view public.member_directory
  with (security_barrier = true) as
select
  m.id,
  m.name,
  m.avatar_url,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'position', mp.position,
        'is_primary', mp.is_primary,
        'desk_id', p.desk_id
      )
      order by mp.is_primary desc, mp.position
    ) filter (where mp.position is not null),
    '[]'::jsonb
  ) as positions
from public.members m
left join public.member_positions mp on mp.member_id = m.id
left join public.positions p on p.id = mp.position
where private.is_member_active(m.id)
  and (select private.is_active_member())
group by m.id, m.name, m.avatar_url;

-- A member reads their own positions only while active (a deactivated former
-- Head still holds theirs); admins read every row.
alter policy member_positions_select_self_or_admin
  on public.member_positions
  using (
    (member_id = (select auth.uid()) and (select private.is_active_member()))
    or (select private.is_admin())
  );

-- Supabase Auth calls this before it creates any user: a sign-up, an OTP or
-- magic link for a new address, an invite, or a first OAuth sign-in. Only a
-- Google sign-in gets through. Auth's admin API (scripts/staging-personas.mjs)
-- doesn't call the hook, and seed.sql inserts users directly. A returning or
-- linked account isn't a new user, so the hook never sees it.
--
-- Auth commits the hook's transaction even when it refuses, so this writes
-- nothing. It runs as `supabase_auth_admin`, the only role granted it.
create function private.before_user_created(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if event -> 'user' -> 'app_metadata' ->> 'provider' = 'google' then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error',
    jsonb_build_object('http_code', 403, 'message', 'Sign-up is closed.')
  );
end;
$$;

grant usage on schema private to supabase_auth_admin;
revoke execute on function private.before_user_created(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.before_user_created(jsonb)
  to supabase_auth_admin;
