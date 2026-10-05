-- hand_back_slot (AD-1, AD-4, Story 1.11): the command's and helper's
-- definer/owner/search_path pins, the lock, every row of the story's I/O
-- Matrix, the reason read matrix and hand_back_slot_ids in task_capabilities.
--
-- Fixtures are created here and rolled back, so the test doesn't depend on
-- seed.sql. It runs locally and on staging (`supabase test db --linked`).

begin;

set local role postgres;
set local search_path = "$user", public, extensions;

select plan(29);

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
  p_id uuid, p_task uuid, p_member uuid,
  p_role public.production_role, p_state public.slot_state
)
returns void
language sql as $$
  insert into public.task_assignments (id, task_id, member_id, role, state)
  values (p_id, p_task, p_member, p_role, p_state)
$$;

-- Hand a slot back as the caller; the role is reset on success (a raised
-- exception is rolled back by throws_ok's savepoint).
create function pg_temp.hand_back_as(p_caller uuid, p_slot uuid, p_reason text default null)
returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_caller, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.hand_back_slot(p_slot, p_reason);
  set local role postgres;
end;
$$;

-- Run a query returning one text value as the caller.
create function pg_temp.q_as(p_caller uuid, p_query text)
returns text
language plpgsql as $$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_caller, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute p_query into v_out;
  set local role postgres;
  return v_out;
end;
$$;

delete from public.member_positions where position = 'editor_in_chief';

-- a..01 pending, 02 assignee, 03 other staff, 04 Layout head
select pg_temp.new_member('00000000-0000-4000-a000-000000000001', 'hb-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-000000000002', 'hb-assignee@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000003', 'hb-staff@example.com', 'staff_writer');
select pg_temp.new_member('00000000-0000-4000-a000-000000000004', 'hb-head@example.com', 'head_layout_artist');

-- b01 Doing (the hand-back tasks), b02 Done
select pg_temp.new_task('00000000-0000-4000-b000-000000000001', 'doing');
select pg_temp.new_task('00000000-0000-4000-b000-000000000002', 'done');
-- c01 happy, c02 replace, c03 blank, c04 awaiting, c05 already handed back,
-- c06 another member's, c07 on a Done task, c08 the pending member's
select pg_temp.new_slot('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'cartoonist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000003', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'photojournalist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000004', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'writer', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000005', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'videojournalist', 'needs_reassignment');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000006', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000003', 'writer', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000007', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000008', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001', 'cartoonist', 'on_it');
insert into public.assignment_reasons (assignment_id, reason) values
  ('00000000-0000-4000-c000-000000000002', 'Old reason'),
  ('00000000-0000-4000-c000-000000000003', 'Stale reason');

-- Pins.
select is_definer('public', 'hand_back_slot', array['uuid', 'text'], 'hand_back_slot is security definer');
select function_owner_is('public', 'hand_back_slot', array['uuid', 'text'], 'postgres', 'hand_back_slot is owned by postgres');
select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.hand_back_slot(uuid, text)'::regprocedure),
  array['search_path=""'], 'hand_back_slot sets search_path = ''''');
select is_definer('private', 'can_hand_back_slot', array['uuid'], 'can_hand_back_slot is security definer');
select is(
  (select p.proconfig from pg_proc p where p.oid = 'private.can_hand_back_slot(uuid)'::regprocedure),
  array['search_path=""'], 'can_hand_back_slot sets search_path = ''''');
select ok(
  (select p.prosrc ~* 'for update' from pg_proc p where p.oid = 'public.hand_back_slot(uuid, text)'::regprocedure),
  'hand_back_slot locks the slot FOR UPDATE');

-- Capabilities before anything changes: only the caller's own On it slots on
-- tasks that aren't Done, in creation order.
select is(
  pg_temp.q_as('00000000-0000-4000-a000-000000000002',
    $q$ select array_agg(x::text order by x) from public.task_capabilities(
          array['00000000-0000-4000-b000-000000000001', '00000000-0000-4000-b000-000000000002']::uuid[]) k,
          unnest(k.hand_back_slot_ids) x $q$),
  '{00000000-0000-4000-c000-000000000001,00000000-0000-4000-c000-000000000002,00000000-0000-4000-c000-000000000003}',
  'hand_back_slot_ids: the assignee''s On it slots on a task that isn''t Done');
select is(
  pg_temp.q_as('00000000-0000-4000-a000-000000000004',
    $q$ select count(*)::text from public.task_capabilities(
          array['00000000-0000-4000-b000-000000000001']::uuid[]) k, unnest(k.hand_back_slot_ids) x $q$),
  '0', 'a head is offered no hand-back on another member''s slot');
select is(
  pg_temp.q_as('00000000-0000-4000-a000-000000000001',
    $q$ select count(*)::text from public.task_capabilities(
          array['00000000-0000-4000-b000-000000000001']::uuid[]) k, unnest(k.hand_back_slot_ids) x $q$),
  '0', 'a pending member is offered nothing');

-- Happy path, with the reason trimmed.
select lives_ok(
  $$ select pg_temp.hand_back_as('00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-c000-000000000001', '  Out sick ') $$,
  'the assignee hands back an On it slot');
select is(
  (select state::text from public.task_assignments where id = '00000000-0000-4000-c000-000000000001'),
  'needs_reassignment', 'the slot needs reassignment');
select is(
  (select reason from public.assignment_reasons where assignment_id = '00000000-0000-4000-c000-000000000001'),
  'Out sick', 'the trimmed reason is stored');
select is(
  (select "column"::text from public.tasks where id = '00000000-0000-4000-b000-000000000001'),
  'doing', 'the task''s column is unchanged');
select is(
  (select count(*) from public.activity
   where entity_id = '00000000-0000-4000-c000-000000000001'
     and action = 'slot_needs_reassignment'),
  1::bigint, 'one activity row is logged');
select is(
  (select count(*) from public.activity where to_jsonb(activity)::text like '%Out sick%'),
  0::bigint, 'activity never holds the reason');

-- Replace and blank.
select lives_ok(
  $$ select pg_temp.hand_back_as('00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-c000-000000000002', 'New reason') $$,
  'a hand-back replaces an earlier reason');
select is(
  (select reason from public.assignment_reasons where assignment_id = '00000000-0000-4000-c000-000000000002'),
  'New reason', 'the row holds the new reason');
select lives_ok(
  $$ select pg_temp.hand_back_as('00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-c000-000000000003', '   ') $$,
  'a blank reason is accepted');
select is(
  (select count(*) from public.assignment_reasons where assignment_id = '00000000-0000-4000-c000-000000000003'),
  0::bigint, 'a blank reason leaves no row');

-- Refusals.
select throws_ok(
  $$ select pg_temp.hand_back_as('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-c000-000000000004') $$,
  'P0001', 'tasks.not_allowed', 'an awaiting slot can''t be handed back');
select throws_ok(
  $$ select pg_temp.hand_back_as('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-c000-000000000005') $$,
  'P0001', 'tasks.not_allowed', 'a slot already handed back can''t be handed back again');
select throws_ok(
  $$ select pg_temp.hand_back_as('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-c000-000000000006') $$,
  'P0001', 'tasks.not_allowed', 'another member''s slot can''t be handed back');
select throws_ok(
  $$ select pg_temp.hand_back_as('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-c000-000000000007') $$,
  'P0001', 'tasks.not_allowed', 'a slot on a Done task can''t be handed back');
select throws_ok(
  $$ select pg_temp.hand_back_as('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000008') $$,
  'P0001', 'auth.not_active', 'a pending caller is refused');
select throws_ok(
  $$ select pg_temp.hand_back_as('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-c000-0000000000ff') $$,
  'P0001', 'tasks.not_found', 'an unknown slot is not found');

-- Who reads the reason: the assignee and the Layout head, nobody else.
select is(
  pg_temp.q_as('00000000-0000-4000-a000-000000000002',
    $q$ select reason from public.assignment_reasons where assignment_id = '00000000-0000-4000-c000-000000000001' $q$),
  'Out sick', 'the assignee reads the reason');
select is(
  pg_temp.q_as('00000000-0000-4000-a000-000000000004',
    $q$ select reason from public.assignment_reasons where assignment_id = '00000000-0000-4000-c000-000000000001' $q$),
  'Out sick', 'the task''s head reads the reason');
select is(
  pg_temp.q_as('00000000-0000-4000-a000-000000000003',
    $q$ select reason from public.assignment_reasons where assignment_id = '00000000-0000-4000-c000-000000000001' $q$),
  null, 'another staff member doesn''t');

create function pg_temp.probe()
returns text[]
language plpgsql as $$
declare
  v_members uuid[] := array[
    '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002',
    '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000004']::uuid[];
  v_tasks uuid[] := array['00000000-0000-4000-b000-000000000001', '00000000-0000-4000-b000-000000000002']::uuid[];
  v_member uuid;
  v_slot uuid;
  v_offered boolean;
  v_accepted boolean;
  v_bad text[] := '{}';
begin
  foreach v_member in array v_members loop
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', v_member, 'role', 'authenticated')::text, true);
    set local role authenticated;
    for v_slot in select id from public.task_assignments loop
      v_offered := coalesce((select bool_or(v_slot = any (k.hand_back_slot_ids))
                             from public.task_capabilities(v_tasks) k), false);
      begin
        perform public.hand_back_slot(v_slot, 'Probe');
        raise exception using errcode = 'P0001', message = 'probe.accepted';
      exception when raise_exception then
        v_accepted := sqlerrm = 'probe.accepted';
      end;
      if v_offered is distinct from v_accepted then
        v_bad := v_bad || format('%s on %s: offered %s, accepted %s', v_member, v_slot, v_offered, v_accepted);
      end if;
    end loop;
    set local role postgres;
  end loop;
  return v_bad;
end;
$$;

-- Agreement: for every caller and slot, hand_back_slot_ids offers a slot
-- exactly when the command accepts it (each attempt rolled back by raising).
select is(
  (
    pg_temp.probe()::text
  ),
  '{}', 'what is offered and what the command accepts agree');

select * from finish();
rollback;
