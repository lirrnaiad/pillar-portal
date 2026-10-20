-- members_approval: an admin approves a pending member with their positions,
-- or declines them (Story 2.2, AD-4, AD-5, AD-21).
--
-- - Both commands follow hand_back_slot's shape: resolve the actor
--   (`auth.not_active`), check they are an admin (`members.not_admin`), lock
--   the target `for update`, check the locked row, then write and log in the
--   same transaction. A target that is no longer pending (approved, declined
--   or deactivated meanwhile, e.g. by another admin) raises `members.stale`;
--   a missing one `members.not_found`.
-- - Pending means role `pending` with neither `declined_at` nor
--   `deactivated_at` set, as in `private.is_member_active`.
-- - approve_member never writes `members.role`: the positions it writes
--   decide the role, through `private.role_for_positions`, which the
--   `member_positions_sync_role` trigger applies (`staff` for Staff positions
--   only, `editorial_admin` for any Board position). It is the one role
--   helper that Story 2.4's bootstrap and Epic 5's position changes also go
--   through. Neither command writes the role itself;
--   `members_role_follows_positions` would refuse any other value.
-- - Editor-in-Chief is never granted here (Epic 5 transfers it). There is no
--   Technical Adviser position, so nobody can be approved as one.
-- - Activity is `('member', member_id, 'approved' | 'declined')`. There is no
--   SELECT policy for `member` rows: nobody reads them yet.
-- - Neither asks for a two-factor code.

-- Raises `auth.not_active`, `members.not_admin`, `members.no_positions` (no
-- position once duplicates are dropped), `members.invalid_position` (an
-- unknown position, a null, or Editor-in-Chief), `members.invalid_primary`
-- (the primary isn't among the positions), `members.not_found` or
-- `members.stale`. The position checks come before the lock: they don't
-- depend on the target.
create function public.approve_member(
  member_id uuid,
  positions text[],
  primary_position text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_member_id();
  v_op uuid := gen_random_uuid();
  v_positions text[];
  v_target record;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  if not private.is_admin() then
    raise exception using errcode = 'P0001', message = 'members.not_admin';
  end if;

  v_positions := array(
    select distinct p.id
    from unnest(coalesce(approve_member.positions, '{}'::text[])) as p (id)
  );

  if cardinality(v_positions) = 0 then
    raise exception using errcode = 'P0001', message = 'members.no_positions';
  end if;

  if exists (
    select 1
    from unnest(v_positions) as p (id)
    where p.id is null
      or p.id = 'editor_in_chief'
      or not exists (select 1 from public.positions pos where pos.id = p.id)
  ) then
    raise exception using errcode = 'P0001', message = 'members.invalid_position';
  end if;

  if not coalesce(approve_member.primary_position = any (v_positions), false) then
    raise exception using errcode = 'P0001', message = 'members.invalid_primary';
  end if;

  select m.id, m.role, m.declined_at, m.deactivated_at into v_target
  from public.members m
  where m.id = approve_member.member_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'members.not_found';
  end if;

  if v_target.role <> 'pending'
    or v_target.declined_at is not null
    or v_target.deactivated_at is not null
  then
    raise exception using errcode = 'P0001', message = 'members.stale';
  end if;

  insert into public.member_positions (member_id, position, is_primary)
  select v_target.id, p.id, p.id = approve_member.primary_position
  from unnest(v_positions) as p (id);

  update public.members m
  set updated_at = now(),
      updated_by = v_actor
  where m.id = v_target.id;

  perform private.log_activity(v_op, 'member', v_target.id, v_actor, 'approved');
end;
$$;

-- Raises `auth.not_active`, `members.not_admin`, `members.not_found` or
-- `members.stale`. The row is kept, still `pending` with no positions, so the
-- same Google account signing in again finds it and sees Access declined.
create function public.decline_member(member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_member_id();
  v_op uuid := gen_random_uuid();
  v_target record;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  if not private.is_admin() then
    raise exception using errcode = 'P0001', message = 'members.not_admin';
  end if;

  select m.id, m.role, m.declined_at, m.deactivated_at into v_target
  from public.members m
  where m.id = decline_member.member_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'members.not_found';
  end if;

  if v_target.role <> 'pending'
    or v_target.declined_at is not null
    or v_target.deactivated_at is not null
  then
    raise exception using errcode = 'P0001', message = 'members.stale';
  end if;

  update public.members m
  set declined_at = now(),
      updated_at = now(),
      updated_by = v_actor
  where m.id = v_target.id;

  perform private.log_activity(v_op, 'member', v_target.id, v_actor, 'declined');
end;
$$;

grant execute on function
  public.approve_member(uuid, text[], text),
  public.decline_member(uuid)
to authenticated;
