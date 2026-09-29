-- Open slots (AD-19): private.open_slots(member) and public.my_open_slots()
-- pinned invoker/stable/search_path, then the one definition checked against
-- every state and column, another member's slots, a pending caller, and
-- task_capabilities' respondable slots.
--
-- Fixture auth users, tasks and slots are created here (tasks and slots
-- inserted directly as `postgres`), so the test doesn't depend on seed.sql;
-- everything is rolled back. It runs locally and on staging
-- (`supabase test db --linked`), seeded or not.

begin;

-- See responses_and_moves.test.sql: run as `postgres` with `extensions` on the
-- path, whichever role `supabase test db --linked` connected as.
set local role postgres;
set local search_path = "$user", public, extensions;

select plan(14);

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

create function pg_temp.new_task(p_id uuid, p_column public.task_column)
returns void
language sql as $$
  insert into public.tasks (id, title, owning_desk_id, due_at, "column")
  values (p_id, 'Fixture task ' || p_id, 'layout', '2026-11-01T00:00:00+08', p_column)
$$;

create function pg_temp.new_slot(
  p_id uuid,
  p_task uuid,
  p_member uuid,
  p_role public.production_role,
  p_state public.slot_state
)
returns void
language sql as $$
  insert into public.task_assignments (id, task_id, member_id, role, state)
  values (p_id, p_task, p_member, p_role, p_state)
$$;

-- Run a query returning one value as the given caller (the
-- request.jwt.claims GUC is what private.current_member_id() reads).
create function pg_temp.query_as(p_caller uuid, p_sql text)
returns text
language plpgsql as $$
declare
  v_result text;
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_caller, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
  execute p_sql into v_result;
  set local role postgres;
  return v_result;
end;
$$;

-- Callers: a pending member (no position), the subject, another active
-- member, and a third active member who only looks.
select pg_temp.new_member('00000000-0000-4000-a000-000000000001', 'os-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-000000000002', 'os-subject@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000003', 'os-other@example.com', 'staff_writer');
select pg_temp.new_member('00000000-0000-4000-a000-000000000004', 'os-viewer@example.com', 'news_editor');

-- Tasks, one per column, plus one more for the other member.
--   b01 To Do      c01 subject awaiting (open), c02 other awaiting (other's)
--   b02 Doing      c03 subject on it (open)
--   b03 For Review c04 subject on it (open)
--   b04 To Do      c05 subject needs reassignment (not open)
--   b05 Done       c06 subject awaiting, c07 subject on it (not open: Done)
--   b06 To Do      c08 other on it (other's)
-- and c09 on b01, the pending member's awaiting slot (inserted directly, as
-- create_task refuses a pending slot member), so the pending-caller checks
-- below prove the caller is refused, not that they had nothing to read.
select pg_temp.new_task('00000000-0000-4000-b000-000000000001', 'to_do');
select pg_temp.new_task('00000000-0000-4000-b000-000000000002', 'doing');
select pg_temp.new_task('00000000-0000-4000-b000-000000000003', 'for_review');
select pg_temp.new_task('00000000-0000-4000-b000-000000000004', 'to_do');
select pg_temp.new_task('00000000-0000-4000-b000-000000000005', 'done');
select pg_temp.new_task('00000000-0000-4000-b000-000000000006', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000003', 'writer', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000003', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000004', '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000005', '00000000-0000-4000-b000-000000000004', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'needs_reassignment');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000006', '00000000-0000-4000-b000-000000000005', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000007', '00000000-0000-4000-b000-000000000005', '00000000-0000-4000-a000-000000000002', 'cartoonist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000008', '00000000-0000-4000-b000-000000000006', '00000000-0000-4000-a000-000000000003', 'writer', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000009', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001', 'layout_artist', 'awaiting_response');

-- Pins: both run with the caller's rights (RLS stays in charge), are stable,
-- and have an empty search_path.

select isnt_definer('private', 'open_slots', array['uuid'],
  'private.open_slots(uuid) is security invoker');
select isnt_definer('public', 'my_open_slots', array[]::text[],
  'public.my_open_slots() is security invoker');
select volatility_is('private', 'open_slots', array['uuid'], 'stable',
  'private.open_slots(uuid) is stable');
select volatility_is('public', 'my_open_slots', array[]::text[], 'stable',
  'public.my_open_slots() is stable');
select is(
  (select p.proconfig from pg_proc p where p.oid = 'private.open_slots(uuid)'::regprocedure),
  array['search_path=""'],
  'private.open_slots(uuid) sets search_path = '''''
);
select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.my_open_slots()'::regprocedure),
  array['search_path=""'],
  'public.my_open_slots() sets search_path = '''''
);

-- The definition: awaiting or on it, on a task that isn't Done, and only the
-- member's own.

select is(
  pg_temp.query_as('00000000-0000-4000-a000-000000000002', $q$
    select string_agg(id::text, ',' order by id) from public.my_open_slots()
  $q$),
  '00000000-0000-4000-c000-000000000001,00000000-0000-4000-c000-000000000003,00000000-0000-4000-c000-000000000004',
  'my_open_slots() gives the subject only their awaiting and on-it slots on tasks that are not Done'
);
select is(
  pg_temp.query_as('00000000-0000-4000-a000-000000000003', $q$
    select string_agg(id::text, ',' order by id) from public.my_open_slots()
  $q$),
  '00000000-0000-4000-c000-000000000002,00000000-0000-4000-c000-000000000008',
  'my_open_slots() gives the other member their own slots, never the subject''s'
);

-- A pending caller reads nothing, though they hold an open slot (c09): not
-- their own through either function, and not another member's.

select is(
  pg_temp.query_as('00000000-0000-4000-a000-000000000004', $q$
    select string_agg(id::text, ',' order by id)
    from private.open_slots('00000000-0000-4000-a000-000000000001')
  $q$),
  '00000000-0000-4000-c000-000000000009',
  'the pending member''s awaiting slot is open, as an active member reads it'
);
select is(
  pg_temp.query_as('00000000-0000-4000-a000-000000000001', $q$
    select coalesce(string_agg(id::text, ',' order by id), 'none') from public.my_open_slots()
  $q$),
  'none',
  'my_open_slots() gives a pending caller no rows, though they hold an open slot'
);
select is(
  pg_temp.query_as('00000000-0000-4000-a000-000000000001', $q$
    select coalesce(string_agg(id::text, ',' order by id), 'none')
    from private.open_slots('00000000-0000-4000-a000-000000000001')
  $q$),
  'none',
  'private.open_slots(own id) gives a pending caller no rows'
);
select is(
  pg_temp.query_as('00000000-0000-4000-a000-000000000001', $q$
    select coalesce(string_agg(id::text, ',' order by id), 'none')
    from private.open_slots('00000000-0000-4000-a000-000000000002')
  $q$),
  'none',
  'private.open_slots(another member) gives a pending caller no rows'
);
select is(
  pg_temp.query_as('00000000-0000-4000-a000-000000000004', $q$
    select string_agg(id::text, ',' order by id)
    from private.open_slots('00000000-0000-4000-a000-000000000002')
  $q$),
  '00000000-0000-4000-c000-000000000001,00000000-0000-4000-c000-000000000003,00000000-0000-4000-c000-000000000004',
  'private.open_slots(member) called by another active member gives that member''s open slots'
);

-- task_capabilities' respondable slots over the subject's open tasks are
-- exactly their open awaiting slots.
select is(
  pg_temp.query_as('00000000-0000-4000-a000-000000000002', $q$
    select string_agg(s::text, ',' order by s)
    from public.task_capabilities(
      array(select a.task_id from public.my_open_slots() a)
    ) k, unnest(k.respondable_slot_ids) as s
  $q$),
  '00000000-0000-4000-c000-000000000001',
  'respondable_slot_ids over the subject''s open tasks are their open awaiting slots'
);

select * from finish();

rollback;
