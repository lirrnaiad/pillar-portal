-- Account states (Story 2.1): declined and deactivated members are not
-- active, so they read nothing but their own `members` row and every command
-- raises `auth.not_active` for them. Also the new-user trigger (insert only),
-- the declined CHECK, and the before_user_created Auth hook.
--
-- The caller matrix is table-driven, as in members.test.sql: each row of
-- `callers` is a caller, a DO block records what each one reads and what each
-- command answers, and one set_eq compares that with `expected`. The four
-- spine callers are pending, declined, a deactivated former admin who still
-- holds Head Layout Artist, and active staff; an active admin (Sports Editor)
-- and an active Head Layout Artist are the positive controls.
--
-- Fixtures are created here and rolled back, so the test doesn't depend on
-- seed.sql. It runs locally and on staging (`supabase test db --linked`).

begin;

-- See members.test.sql: run as `postgres` with `extensions` on the path,
-- whichever role `supabase test db --linked` connected as.
set local role postgres;
set local search_path = "$user", public, extensions;

select plan(18);

-- Fixtures.

create function pg_temp.new_member(p_id uuid, p_email text, p_position text)
returns void
language plpgsql as $$
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated',
          'authenticated', p_email, '{}');
  if p_position is not null then
    insert into public.member_positions (member_id, position, is_primary)
    values (p_id, p_position, true);
  end if;
end;
$$;

create function pg_temp.new_slot(
  p_id uuid, p_member uuid,
  p_role public.production_role, p_state public.slot_state
)
returns void
language sql as $$
  insert into public.task_assignments (id, task_id, member_id, role, state)
  values (p_id, '00000000-0000-4000-e100-000000000001', p_member, p_role, p_state)
$$;

-- e..01 pending, 02 declined, 03 deactivated former Head Layout Artist,
-- 04 active staff (Staff Layout Artist), 05 active admin (Sports Editor),
-- 06 active Head Layout Artist.
select pg_temp.new_member('00000000-0000-4000-e000-000000000001', 'as-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-e000-000000000002', 'as-declined@example.com', null);
select pg_temp.new_member('00000000-0000-4000-e000-000000000003', 'as-deactivated@example.com', 'head_layout_artist');
select pg_temp.new_member('00000000-0000-4000-e000-000000000004', 'as-staff@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-e000-000000000005', 'as-admin@example.com', 'sports_editor');
select pg_temp.new_member('00000000-0000-4000-e000-000000000006', 'as-head@example.com', 'head_layout_artist');

update public.members set declined_at = now()
where id = '00000000-0000-4000-e000-000000000002';
update public.members set deactivated_at = now()
where id = '00000000-0000-4000-e000-000000000003';

-- A Layout task in To Do, created by the admin, with slots for every caller
-- but the admin and the head, a hand-back reason, and its activity.
insert into public.tasks (id, title, owning_desk_id, due_at, created_by)
values ('00000000-0000-4000-e100-000000000001', 'Account states fixture',
        'layout', '2026-11-01T00:00:00+08',
        '00000000-0000-4000-e000-000000000005');

-- s01 pending's, s02 declined's, s03 deactivated's On it, s04 staff's
-- awaiting, s05 staff's On it, s06 deactivated's handed back (with a reason)
select pg_temp.new_slot('00000000-0000-4000-e200-000000000001', '00000000-0000-4000-e000-000000000001', 'layout_artist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-e200-000000000002', '00000000-0000-4000-e000-000000000002', 'layout_artist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-e200-000000000003', '00000000-0000-4000-e000-000000000003', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-e200-000000000004', '00000000-0000-4000-e000-000000000004', 'layout_artist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-e200-000000000005', '00000000-0000-4000-e000-000000000004', 'cartoonist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-e200-000000000006', '00000000-0000-4000-e000-000000000003', 'photojournalist', 'needs_reassignment');

insert into public.assignment_reasons (assignment_id, reason)
values ('00000000-0000-4000-e200-000000000006', 'Graduated');

insert into public.activity (op_id, entity_type, entity_id, actor_id, action)
values (gen_random_uuid(), 'task', '00000000-0000-4000-e100-000000000001',
        '00000000-0000-4000-e000-000000000005', 'created');

-- The caller matrix.
--
-- Each caller, the slot they answer (respond_to_slot) and the slot they hand
-- back (hand_back_slot): their own where they have one, else the staff
-- member's.
create temp table callers (
  label text primary key,
  member_id uuid not null,
  respond_slot uuid not null,
  hand_back_slot uuid not null
);

insert into callers values
  ('pending', '00000000-0000-4000-e000-000000000001',
   '00000000-0000-4000-e200-000000000001', '00000000-0000-4000-e200-000000000001'),
  ('declined', '00000000-0000-4000-e000-000000000002',
   '00000000-0000-4000-e200-000000000002', '00000000-0000-4000-e200-000000000002'),
  ('deactivated former Head Layout Artist', '00000000-0000-4000-e000-000000000003',
   '00000000-0000-4000-e200-000000000003', '00000000-0000-4000-e200-000000000003'),
  ('active staff', '00000000-0000-4000-e000-000000000004',
   '00000000-0000-4000-e200-000000000004', '00000000-0000-4000-e200-000000000005'),
  ('active admin (Sports Editor)', '00000000-0000-4000-e000-000000000005',
   '00000000-0000-4000-e200-000000000004', '00000000-0000-4000-e200-000000000005'),
  ('active Head Layout Artist', '00000000-0000-4000-e000-000000000006',
   '00000000-0000-4000-e200-000000000004', '00000000-0000-4000-e200-000000000005');

-- What each caller should get. Row counts are over the whole table (seeded
-- rows included), except `reasons`, which counts this test's fixture slots
-- only, since who reads a seeded reason depends on the seed. "Every row"
-- totals are read here as `postgres`; the directory total restates the
-- active predicate rather than calling the helper under test. Command
-- results are `ok` (accepted, then rolled back) or `<sqlstate> <message>`.
create temp table expected as
with t as (
  select
    (select count(*) from public.members)::int as members,
    (select count(*) from public.member_positions)::int as positions_held,
    ((select count(*) from public.sections)
      + (select count(*) from public.desks)
      + (select count(*) from public.positions))::int as org,
    (select count(*) from public.tasks)::int as tasks,
    (select count(*) from public.task_assignments)::int as slots,
    (select count(*) from public.activity
     where entity_type in ('task', 'task_assignment'))::int as activity,
    (select count(*) from public.members m
     where m.role <> 'pending'
       and m.declined_at is null
       and m.deactivated_at is null)::int as directory
)
select e.*
from t
cross join lateral (values
  ('pending',
   1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
   false, false, false, false,
   'P0001 auth.not_active', 'P0001 auth.not_active',
   'P0001 auth.not_active', 'P0001 auth.not_active'),
  ('declined',
   1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
   false, false, false, false,
   'P0001 auth.not_active', 'P0001 auth.not_active',
   'P0001 auth.not_active', 'P0001 auth.not_active'),
  ('deactivated former Head Layout Artist',
   1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
   false, false, false, false,
   'P0001 auth.not_active', 'P0001 auth.not_active',
   'P0001 auth.not_active', 'P0001 auth.not_active'),
  ('active staff',
   1, 1, t.org, t.tasks, t.slots, t.activity, 0, t.directory, 2, 1, 2,
   true, false, false, true,
   'P0001 tasks.not_admin', 'ok', 'ok', 'ok'),
  ('active admin (Sports Editor)',
   t.members, t.positions_held, t.org, t.tasks, t.slots, t.activity, 0,
   t.directory, 0, 1, 0,
   true, true, false, true,
   'ok', 'P0001 tasks.not_allowed', 'P0001 tasks.not_allowed',
   'P0001 tasks.not_allowed'),
  ('active Head Layout Artist',
   t.members, t.positions_held, t.org, t.tasks, t.slots, t.activity, 1,
   t.directory, 0, 1, 0,
   true, true, true, true,
   'ok', 'P0001 tasks.not_allowed', 'P0001 tasks.not_allowed',
   'P0001 tasks.not_allowed')
) as e(
  label,
  members, member_positions, org, tasks, task_assignments, activity, reasons,
  directory, my_open_slots, capabilities, open_slots,
  is_active, is_admin, is_approver, can_join,
  create_task, respond_to_slot, move_task, hand_back_slot
);

create temp table observed (like expected);

do $$
declare
  v_callers callers[];
  c callers;
  o observed;
  v_task constant uuid := '00000000-0000-4000-e100-000000000001';
  v_staff constant uuid := '00000000-0000-4000-e000-000000000004';
begin
  -- Read the fixtures while still `postgres`: `authenticated` can't read
  -- temp tables.
  select array_agg(x) into v_callers from callers x;

  foreach c in array v_callers loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', c.member_id, 'role', 'authenticated')::text,
      true
    );
    -- What Realtime sets while it authorizes a join to the Board's channel.
    perform set_config('realtime.topic', 'task-changes', true);
    set local role authenticated;

    o.label := c.label;
    o.members := (select count(*) from public.members);
    o.member_positions := (select count(*) from public.member_positions);
    o.org := (select count(*) from public.sections)
      + (select count(*) from public.desks)
      + (select count(*) from public.positions);
    o.tasks := (select count(*) from public.tasks);
    o.task_assignments := (select count(*) from public.task_assignments);
    o.activity := (select count(*) from public.activity);
    o.reasons := (
      select count(*) from public.assignment_reasons r
      where r.assignment_id::text like '00000000-0000-4000-e200-%'
    );
    o.directory := (select count(*) from public.member_directory);
    o.my_open_slots := (select count(*) from public.my_open_slots());
    o.capabilities := (
      select count(*) from public.task_capabilities(array[v_task])
    );
    o.open_slots := (select count(*) from private.open_slots(c.member_id));
    o.is_active := private.is_active_member();
    o.is_admin := private.is_admin();
    o.is_approver := private.is_task_approver(v_task);
    o.can_join := private.can_join_task_changes();

    -- Each command is attempted in its own subtransaction. One that is
    -- accepted raises a sentinel, so its writes roll back and every caller
    -- starts from the same state.
    begin
      perform public.create_task(
        'Account states probe', null, null, 'layout',
        '2026-11-02T00:00:00+08', null,
        jsonb_build_array(
          jsonb_build_object('member_id', v_staff, 'role', 'layout_artist')
        )
      );
      raise exception using errcode = 'P0001', message = 'probe.accepted';
    exception when others then
      o.create_task := case when sqlerrm = 'probe.accepted' then 'ok'
                            else sqlstate || ' ' || sqlerrm end;
    end;

    begin
      perform public.respond_to_slot(c.respond_slot, 'on_it');
      raise exception using errcode = 'P0001', message = 'probe.accepted';
    exception when others then
      o.respond_to_slot := case when sqlerrm = 'probe.accepted' then 'ok'
                                else sqlstate || ' ' || sqlerrm end;
    end;

    begin
      perform public.move_task(v_task, 'doing');
      raise exception using errcode = 'P0001', message = 'probe.accepted';
    exception when others then
      o.move_task := case when sqlerrm = 'probe.accepted' then 'ok'
                          else sqlstate || ' ' || sqlerrm end;
    end;

    begin
      perform public.hand_back_slot(c.hand_back_slot, 'Busy');
      raise exception using errcode = 'P0001', message = 'probe.accepted';
    exception when others then
      o.hand_back_slot := case when sqlerrm = 'probe.accepted' then 'ok'
                               else sqlstate || ' ' || sqlerrm end;
    end;

    set local role postgres;
    insert into observed select o.*;
  end loop;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('realtime.topic', '', true);
end
$$;

select set_eq(
  $$ select * from observed $$,
  $$ select * from expected $$,
  'each caller reads, joins and is refused exactly as expected: non-active callers read only their own members row and get auth.not_active'
);

select results_eq(
  $$ select label, is_approver from observed
     where label in ('deactivated former Head Layout Artist',
                     'active Head Layout Artist')
     order by label $$,
  $$ values ('active Head Layout Artist', true),
            ('deactivated former Head Layout Artist', false) $$,
  'a deactivated former Head is not the approver of their old desk''s task; the active Head is'
);

select is(
  (select count(*) from public.tasks where title = 'Account states probe'),
  0::bigint,
  'every accepted probe was rolled back'
);

-- The new-user trigger fires on insert only, so a declined member signing in
-- again (Auth updates their existing auth.users row) is never queued again.

select is(
  (select t.tgtype::int from pg_trigger t
   where t.tgrelid = 'auth.users'::regclass
     and t.tgname = 'on_auth_user_created'),
  5,
  'on_auth_user_created is AFTER INSERT FOR EACH ROW only (tgtype 5)'
);

create temp table members_before as
select count(*) as members,
       (select declined_at from public.members
        where id = '00000000-0000-4000-e000-000000000002') as declined_at
from public.members;

update auth.users
set last_sign_in_at = now(),
    raw_user_meta_data = '{"full_name": "Signed In Again"}'
where id = '00000000-0000-4000-e000-000000000002';

select results_eq(
  $$ select count(*),
            (select declined_at from public.members
             where id = '00000000-0000-4000-e000-000000000002')
     from public.members $$,
  $$ select members, declined_at from members_before $$,
  'a declined member signing in again adds no member and keeps declined_at'
);

select is(
  (select name from public.members where id = '00000000-0000-4000-e000-000000000002'),
  'as-declined',
  'and their member row is unchanged'
);

-- The declined CHECK: only a pending member is declined.

select throws_ok(
  $$ update public.members set declined_at = now()
     where id = '00000000-0000-4000-e000-000000000004' $$,
  '23514',
  null,
  'an active member can''t be declined'
);

select throws_ok(
  $$ insert into public.member_positions (member_id, position, is_primary)
     values ('00000000-0000-4000-e000-000000000002', 'staff_writer', true) $$,
  '23514',
  null,
  'a declined member can''t take a position (their role would leave pending)'
);

-- The before_user_created hook.

select isnt_definer(
  'private', 'before_user_created', array['jsonb'],
  'private.before_user_created runs with the caller''s rights'
);

select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'private.before_user_created(jsonb)'::regprocedure),
  array['search_path=""'],
  'private.before_user_created sets search_path = '''''
);

select is(
  private.before_user_created(
    '{"user": {"email": "new@gmail.com", "app_metadata": {"provider": "google", "providers": ["google"]}}}'
  ),
  '{}'::jsonb,
  'the hook lets a new Google user through'
);

select is(
  private.before_user_created(
    '{"user": {"email": "new@example.com", "app_metadata": {"provider": "email", "providers": ["email"]}}}'
  ),
  '{"error": {"http_code": 403, "message": "Sign-up is closed."}}'::jsonb,
  'the hook refuses an email sign-up'
);

select is(
  private.before_user_created('{"user": {"email": "new@example.com"}}'),
  '{"error": {"http_code": 403, "message": "Sign-up is closed."}}'::jsonb,
  'the hook refuses a user with no provider'
);

select is(
  private.before_user_created('{}'),
  '{"error": {"http_code": 403, "message": "Sign-up is closed."}}'::jsonb,
  'the hook refuses an empty payload'
);

select ok(
  has_function_privilege('supabase_auth_admin', 'private.before_user_created(jsonb)', 'execute')
    and has_schema_privilege('supabase_auth_admin', 'private', 'usage'),
  'supabase_auth_admin may resolve and execute the hook'
);

select is(
  array(
    select r from unnest(array['anon', 'authenticated', 'service_role']) r
    where has_function_privilege(r, 'private.before_user_created(jsonb)', 'execute')
  ),
  array[]::text[],
  'anon, authenticated and service_role may not execute the hook'
);

select is(
  has_schema_privilege('service_role', 'private', 'usage')
    or has_schema_privilege('anon', 'private', 'usage'),
  false,
  'anon and service_role still can''t resolve names in private'
);

select is(
  (select count(*) from auth.users u
   where u.email = 'as-declined@example.com'),
  1::bigint,
  'the declined member still has exactly one auth user'
);

select * from finish();

rollback;
