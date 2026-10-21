-- members_bootstrap_admin: makes the first Editor-in-Chief (Story 2.4).
--
-- Approval never grants Editor-in-Chief (Story 2.2), and only an admin can
-- approve, so on a fresh production database nobody could ever become an
-- admin. This one-time command closes that gap: the operator runs it as the
-- database owner, as SQL (OPERATIONS.md, "The bootstrap"), for the email of
-- a pending member who has signed in once with Google.
--
-- - It writes Editor-in-Chief as the member's primary position and never
--   writes `members.role`: the `member_positions_sync_role` trigger sets
--   `editorial_admin` through `private.role_for_positions`, the one role
--   helper approval also goes through.
-- - It records a `job_runs` row (`bootstrap`, `ok`), not `activity`: it is a
--   system step with no member behind it.
-- - Invoker, with no EXECUTE grant for any role: owner SQL needs no definer,
--   and no API role (`anon`, `authenticated`, `service_role`) can call it.
-- - Each refusal raises a `members.<reason>` code with an English `detail`
--   for the operator, and writes nothing.

-- Raises `members.admin_exists` (any `editorial_admin` exists),
-- `members.not_found` (no member has that email) or `members.not_pending`
-- (the member is declined, deactivated or already active). The email is
-- compared as members store it: lowercase, without surrounding whitespace.
create function private.bootstrap_admin(email text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_email text := lower(
    regexp_replace(bootstrap_admin.email, '^[[:space:]]+|[[:space:]]+$', '', 'g')
  );
  v_member record;
begin
  -- Two bootstraps at once would both see no admin.
  perform pg_advisory_xact_lock(hashtextextended('members:bootstrap_admin', 0));

  if exists (
    select 1 from public.members m where m.role = 'editorial_admin'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'members.admin_exists',
      detail = 'An Editorial Board member already exists, so the bootstrap '
        || 'is closed. An admin approves new members at /admin/members.';
  end if;

  select m.id, m.role, m.declined_at, m.deactivated_at into v_member
  from public.members m
  where m.email = v_email
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'members.not_found',
      detail = 'No member has that email. They must sign in once with '
        || 'Google first, then the bootstrap can run.';
  end if;

  if v_member.role <> 'pending'
    or v_member.declined_at is not null
    or v_member.deactivated_at is not null
  then
    raise exception using
      errcode = 'P0001',
      message = 'members.not_pending',
      detail = 'That member is declined, deactivated or already active. '
        || 'Only a member waiting for approval can be bootstrapped.';
  end if;

  insert into public.member_positions (member_id, position, is_primary)
  values (v_member.id, 'editor_in_chief', true);

  insert into public.job_runs (job, status, finished_at)
  values ('bootstrap', 'ok', now());

  return v_member.id;
end;
$$;

revoke all on function private.bootstrap_admin(text)
  from public, anon, authenticated, service_role;
