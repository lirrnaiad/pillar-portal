-- Slot responses and column moves (AD-1, AD-4, AD-16, AD-19): the commands'
-- and helpers' definer/owner/search_path pins, every database row of the I/O
-- Matrix in spec-1-6-task-detail-and-slot-response.md, the hand-back reason
-- read matrix, and task_capabilities per caller and state, checked against
-- what the commands actually accept.
--
-- Fixture auth users, tasks and slots are created here (tasks and slots
-- inserted directly as `postgres`, so a test can start from any column or
-- slot state), so the test doesn't depend on seed.sql; everything is rolled
-- back. It runs locally and on staging (`supabase test db --linked`), seeded
-- or not.

begin;

-- `supabase test db --linked` connects as the CLI's login role
-- (`cli_login_postgres`), which can't use the `extensions` schema where pgTAP
-- lives and has the default "$user", public search_path. Run as `postgres`,
-- as locally, with `extensions` on the path, rather than rely on how the
-- session was opened.
set local role postgres;
set local search_path = "$user", public, extensions;

select plan(66);

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

create function pg_temp.new_task(
  p_id uuid,
  p_section text,
  p_desk text,
  p_column public.task_column
)
returns void
language sql as $$
  insert into public.tasks (id, title, owning_section_id, owning_desk_id, due_at, "column")
  values (p_id, 'Fixture task ' || p_id, p_section, p_desk,
          '2026-11-01T00:00:00+08', p_column)
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

-- Clear any seeded Editor-in-Chief (member_positions_one_editor_in_chief) so
-- the fixture one below can hold the position; rolled back with the rest.
delete from public.member_positions where position = 'editor_in_chief';

-- Callers. Each active one holds one primary position.
select pg_temp.new_member('00000000-0000-4000-a000-000000000001', 'rm-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-000000000002', 'rm-assignee@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000003', 'rm-staff@example.com', 'staff_writer');
select pg_temp.new_member('00000000-0000-4000-a000-000000000004', 'rm-head-layout@example.com', 'head_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000005', 'rm-head-cartoonist@example.com', 'head_cartoonist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000006', 'rm-news-editor@example.com', 'news_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000007', 'rm-sports-editor@example.com', 'sports_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000008', 'rm-eic@example.com', 'editor_in_chief');
select pg_temp.new_member('00000000-0000-4000-a000-000000000009', 'rm-associate@example.com', 'associate_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000010', 'rm-managing@example.com', 'managing_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000011', 'rm-finance@example.com', 'finance_manager');

-- Flow tasks, answered and moved in order below. All owned by the Layout
-- desk, all in To Do, every slot the assignee's and awaiting a response.
--   b01: one slot (c01)
--   b02: two slots (c02 Layout Artist, c03 Cartoonist)
--   b03: five slots (c04..c08) for the reason cases
select pg_temp.new_task('00000000-0000-4000-b000-000000000001', null, 'layout', 'to_do');
select pg_temp.new_task('00000000-0000-4000-b000-000000000002', null, 'layout', 'to_do');
select pg_temp.new_task('00000000-0000-4000-b000-000000000003', null, 'layout', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000003', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'cartoonist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000004', '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000005', '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000002', 'cartoonist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000006', '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000002', 'photojournalist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000007', '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000002', 'writer', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000008', '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000002', 'videojournalist', 'awaiting_response');

-- Reason-matrix tasks: one per kind of owner, each with the assignee's slot
-- handed back with a reason. The other staff member is a co-assignee on the
-- Layout task, which doesn't make them the reason's reader.
--   b11 Layout desk (c11), b12 News section (c12), b13 Opinion section (c13)
select pg_temp.new_task('00000000-0000-4000-b000-000000000011', null, 'layout', 'to_do');
select pg_temp.new_task('00000000-0000-4000-b000-000000000012', 'news', null, 'to_do');
select pg_temp.new_task('00000000-0000-4000-b000-000000000013', 'opinion', null, 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000011', '00000000-0000-4000-b000-000000000011', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'needs_reassignment');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000012', '00000000-0000-4000-b000-000000000012', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'needs_reassignment');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000013', '00000000-0000-4000-b000-000000000013', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'needs_reassignment');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000014', '00000000-0000-4000-b000-000000000011', '00000000-0000-4000-a000-000000000003', 'writer', 'on_it');
insert into public.assignment_reasons (assignment_id, reason) values
  ('00000000-0000-4000-c000-000000000011', 'Layout reason'),
  ('00000000-0000-4000-c000-000000000012', 'News reason'),
  ('00000000-0000-4000-c000-000000000013', 'Opinion reason');

-- Capability tasks, one per state, never changed (the agreement probes roll
-- each command back):
--   b21 To Do,      c21 assignee awaiting, c22 other staff awaiting,
--                   c23 pending member awaiting
--   b22 To Do,      c24 assignee on it
--   b23 Doing,      c25 assignee on it
--   b24 For Review, c26 assignee on it
--   b25 Done,       c27 assignee on it
--   b26 For Review, c28 assignee awaiting
--   b27 To Do,      c29 assignee needs reassignment
select pg_temp.new_task('00000000-0000-4000-b000-000000000021', null, 'layout', 'to_do');
select pg_temp.new_task('00000000-0000-4000-b000-000000000022', null, 'layout', 'to_do');
select pg_temp.new_task('00000000-0000-4000-b000-000000000023', null, 'layout', 'doing');
select pg_temp.new_task('00000000-0000-4000-b000-000000000024', null, 'layout', 'for_review');
select pg_temp.new_task('00000000-0000-4000-b000-000000000025', null, 'layout', 'done');
select pg_temp.new_task('00000000-0000-4000-b000-000000000026', null, 'layout', 'for_review');
select pg_temp.new_task('00000000-0000-4000-b000-000000000027', null, 'layout', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000021', '00000000-0000-4000-b000-000000000021', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000022', '00000000-0000-4000-b000-000000000021', '00000000-0000-4000-a000-000000000003', 'writer', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000023', '00000000-0000-4000-b000-000000000021', '00000000-0000-4000-a000-000000000001', 'cartoonist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000024', '00000000-0000-4000-b000-000000000022', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000025', '00000000-0000-4000-b000-000000000023', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000026', '00000000-0000-4000-b000-000000000024', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000027', '00000000-0000-4000-b000-000000000025', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000028', '00000000-0000-4000-b000-000000000026', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000029', '00000000-0000-4000-b000-000000000027', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'needs_reassignment');

-- Run a command, or a query returning one value, as the given caller (via
-- the request.jwt.claims GUC, as RLS and private.current_member_id() read
-- it). On success, the role is reset to postgres before returning. On a
-- raised exception, pgTAP's throws_ok() rolls back its own savepoint, which
-- undoes the SET LOCAL made here (see tasks.test.sql's create_task_as).
create function pg_temp.respond_as(
  p_caller uuid,
  p_slot uuid,
  p_response public.slot_state,
  p_reason text default null
)
returns void
language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_caller, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
  perform public.respond_to_slot(p_slot, p_response, p_reason);
  set local role postgres;
end;
$$;

create function pg_temp.move_as(
  p_caller uuid,
  p_task uuid,
  p_to_column public.task_column
)
returns void
language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_caller, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
  perform public.move_task(p_task, p_to_column);
  set local role postgres;
end;
$$;

create function pg_temp.create_task_as(p_caller uuid, p_title text, p_slots jsonb)
returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_caller, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
  select public.create_task(
    p_title, null, null, 'layout', '2026-11-01T00:00:00+08', null, p_slots
  ) into v_id;
  set local role postgres;
  return v_id;
end;
$$;

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

-- Pins: both commands and all three helpers are security definer, owned by
-- postgres, with an empty search_path; task_capabilities runs with the
-- caller's rights; slots' created_at advances within a transaction; both
-- commands lock the row they change.

select is_definer(
  'public', 'respond_to_slot', array['uuid', 'slot_state', 'text'],
  'public.respond_to_slot(...) is security definer'
);
select function_owner_is(
  'public', 'respond_to_slot', array['uuid', 'slot_state', 'text'], 'postgres',
  'public.respond_to_slot(...) is owned by postgres'
);
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'public.respond_to_slot(uuid, public.slot_state, text)'::regprocedure),
  array['search_path=""'],
  'public.respond_to_slot(...) sets search_path = '''''
);

select is_definer(
  'public', 'move_task', array['uuid', 'task_column'],
  'public.move_task(...) is security definer'
);
select function_owner_is(
  'public', 'move_task', array['uuid', 'task_column'], 'postgres',
  'public.move_task(...) is owned by postgres'
);
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'public.move_task(uuid, public.task_column)'::regprocedure),
  array['search_path=""'],
  'public.move_task(...) sets search_path = '''''
);

select is_definer(
  'private', 'is_task_approver', array['uuid'],
  'private.is_task_approver(uuid) is security definer'
);
select function_owner_is(
  'private', 'is_task_approver', array['uuid'], 'postgres',
  'private.is_task_approver(uuid) is owned by postgres'
);
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'private.is_task_approver(uuid)'::regprocedure),
  array['search_path=""'],
  'private.is_task_approver(uuid) sets search_path = '''''
);

select is_definer(
  'private', 'can_respond_to_slot', array['uuid'],
  'private.can_respond_to_slot(uuid) is security definer'
);
select function_owner_is(
  'private', 'can_respond_to_slot', array['uuid'], 'postgres',
  'private.can_respond_to_slot(uuid) is owned by postgres'
);
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'private.can_respond_to_slot(uuid)'::regprocedure),
  array['search_path=""'],
  'private.can_respond_to_slot(uuid) sets search_path = '''''
);

select is_definer(
  'private', 'can_move_task', array['uuid', 'task_column'],
  'private.can_move_task(...) is security definer'
);
select function_owner_is(
  'private', 'can_move_task', array['uuid', 'task_column'], 'postgres',
  'private.can_move_task(...) is owned by postgres'
);
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'private.can_move_task(uuid, public.task_column)'::regprocedure),
  array['search_path=""'],
  'private.can_move_task(...) sets search_path = '''''
);

select isnt_definer(
  'public', 'task_capabilities', array['uuid[]'],
  'public.task_capabilities(uuid[]) is security invoker'
);

-- Slots one create_task call inserts keep their order only because
-- created_at advances between the inserts (now() wouldn't); the ordering
-- assertion below can pass by chance without this, so it's pinned directly.
select col_default_is(
  'public', 'task_assignments', 'created_at', 'clock_timestamp()',
  'task_assignments.created_at defaults to clock_timestamp()'
);

select ok(
  pg_get_functiondef('public.respond_to_slot(uuid, public.slot_state, text)'::regprocedure)
    ~* 'for\s+update',
  'public.respond_to_slot(...) locks the slot FOR UPDATE'
);
select ok(
  pg_get_functiondef('public.move_task(uuid, public.task_column)'::regprocedure)
    ~* 'for\s+update',
  'public.move_task(...) locks the task FOR UPDATE'
);

-- I'm on it.

select lives_ok(
  $$ select pg_temp.respond_as(
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-c000-000000000001', 'on_it') $$,
  'I''m on it: the assignee answers their own awaiting slot'
);

select is(
  (select state::text from public.task_assignments
   where id = '00000000-0000-4000-c000-000000000001'),
  'on_it',
  'the slot is on_it'
);

select results_eq(
  $$ select entity_type, action, actor_id from public.activity
     where entity_id = '00000000-0000-4000-c000-000000000001' $$,
  $$ values ('task_assignment', 'slot_on_it',
             '00000000-0000-4000-a000-000000000002'::uuid) $$,
  'one activity row is logged for the slot: slot_on_it, by the assignee'
);

-- Someone else's slot, an answered slot, and a non-response.

select throws_ok(
  $$ select pg_temp.respond_as(
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-c000-000000000001', 'needs_reassignment') $$,
  'P0001', 'tasks.not_allowed',
  'a slot already on_it can''t be answered again'
);

select throws_ok(
  $$ select pg_temp.respond_as(
       '00000000-0000-4000-a000-000000000003',
       '00000000-0000-4000-c000-000000000002', 'on_it') $$,
  'P0001', 'tasks.not_allowed',
  'another member''s slot can''t be answered'
);

select throws_ok(
  $$ select pg_temp.respond_as(
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-c000-000000000002', 'awaiting_response') $$,
  'P0001', 'tasks.not_allowed',
  'awaiting_response isn''t a response'
);

select results_eq(
  $$ select a.state::text,
            (select count(*)::int from public.activity v where v.entity_id = a.id)
     from public.task_assignments a
     where a.id = '00000000-0000-4000-c000-000000000002' $$,
  $$ values ('awaiting_response', 0) $$,
  'a refused response writes nothing'
);

-- Pending callers, and ids that don't exist.

select throws_ok(
  $$ select pg_temp.respond_as(
       '00000000-0000-4000-a000-000000000001',
       '00000000-0000-4000-c000-000000000023', 'on_it') $$,
  'P0001', 'auth.not_active',
  'a pending caller gets auth.not_active from respond_to_slot, even on their own slot'
);

select throws_ok(
  $$ select pg_temp.move_as(
       '00000000-0000-4000-a000-000000000001',
       '00000000-0000-4000-b000-000000000024', 'done') $$,
  'P0001', 'auth.not_active',
  'a pending caller gets auth.not_active from move_task'
);

select throws_ok(
  $$ select pg_temp.respond_as(
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-9999-000000000000', 'on_it') $$,
  'P0001', 'tasks.not_found',
  'a missing slot gets tasks.not_found'
);

select throws_ok(
  $$ select pg_temp.move_as(
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-9999-000000000000', 'doing') $$,
  'P0001', 'tasks.not_found',
  'a missing task gets tasks.not_found'
);

-- Two slots, one member: each is answered separately.

select lives_ok(
  $$ select pg_temp.respond_as(
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-c000-000000000002', 'on_it') $$,
  'the assignee answers one of their two slots'
);

select results_eq(
  $$ select role::text, state::text from public.task_assignments
     where task_id = '00000000-0000-4000-b000-000000000002'
     order by id $$,
  $$ values ('layout_artist', 'on_it'), ('cartoonist', 'awaiting_response') $$,
  'answering one slot leaves the other awaiting'
);

select is(
  pg_temp.query_as(
    '00000000-0000-4000-a000-000000000002',
    $q$ select respondable_slot_ids::text from public.task_capabilities(
          '{00000000-0000-4000-b000-000000000002}') $q$
  ),
  '{00000000-0000-4000-c000-000000000003}',
  'and the other slot is still offered for a response'
);

-- Creation order: the slots one create_task call makes (one transaction)
-- come back in the order it was given them, not in the order of their ids.

select pg_temp.create_task_as(
  '00000000-0000-4000-a000-000000000008',
  'Fixture: slots in creation order',
  jsonb_build_array(
    jsonb_build_object('role', 'cartoonist', 'member_id', '00000000-0000-4000-a000-000000000002'),
    jsonb_build_object('role', 'writer', 'member_id', '00000000-0000-4000-a000-000000000002'),
    jsonb_build_object('role', 'layout_artist', 'member_id', '00000000-0000-4000-a000-000000000002')
  )
);

select is(
  pg_temp.query_as(
    '00000000-0000-4000-a000-000000000002',
    format(
      $q$ select string_agg(a.role::text, ',' order by s.n)
          from public.task_capabilities(array[%L]::uuid[]) k
          cross join lateral unnest(k.respondable_slot_ids) with ordinality as s (id, n)
          join public.task_assignments a on a.id = s.id $q$,
      (select t.id from public.tasks t
       where t.title = 'Fixture: slots in creation order')
    )
  ),
  'cartoonist,writer,layout_artist',
  'task_capabilities lists the slots one create_task call made in the order it was given them'
);

-- Moves.

select throws_ok(
  $$ select pg_temp.move_as(
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-b000-000000000003', 'doing') $$,
  'P0001', 'tasks.not_allowed',
  'an assignee whose slot is still awaiting can''t move the task'
);

select throws_ok(
  $$ select pg_temp.move_as(
       '00000000-0000-4000-a000-000000000003',
       '00000000-0000-4000-b000-000000000001', 'doing') $$,
  'P0001', 'tasks.not_allowed',
  'a non-assignee can''t move to_do -> doing'
);

select throws_ok(
  $$ select pg_temp.move_as(
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-b000-000000000001', 'done') $$,
  'P0001', 'tasks.not_allowed',
  'nobody moves to_do -> done, not even an on-it assignee'
);

select throws_ok(
  $$ select pg_temp.move_as(
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-b000-000000000001', 'to_do') $$,
  'P0001', 'tasks.not_allowed',
  'a same-column move is refused'
);

select lives_ok(
  $$ select pg_temp.move_as(
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-b000-000000000001', 'for_review') $$,
  'an on-it assignee moves to_do -> for_review'
);

select lives_ok(
  $$ select pg_temp.move_as(
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-b000-000000000001', 'to_do') $$,
  'and back, for_review -> to_do'
);

select results_eq(
  $$ select "column"::text from public.tasks
     where id = '00000000-0000-4000-b000-000000000001' $$,
  $$ values ('to_do') $$,
  'the task is back in to_do'
);

select bag_eq(
  $$ select entity_type, action, actor_id from public.activity
     where entity_id = '00000000-0000-4000-b000-000000000001' $$,
  $$ values ('task', 'moved_to_for_review', '00000000-0000-4000-a000-000000000002'::uuid),
            ('task', 'moved_to_to_do', '00000000-0000-4000-a000-000000000002'::uuid) $$,
  'each move logs one activity row for the task'
);

-- Prototype Done: any active member moves for_review -> done, then nothing
-- moves out of done and no move is offered to anyone.

select pg_temp.move_as(
  '00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-b000-000000000001', 'for_review'
);

select lives_ok(
  $$ select pg_temp.move_as(
       '00000000-0000-4000-a000-000000000003',
       '00000000-0000-4000-b000-000000000001', 'done') $$,
  'a non-assignee active member moves for_review -> done (the prototype edge)'
);

select results_eq(
  $$ select "column"::text from public.tasks
     where id = '00000000-0000-4000-b000-000000000001' $$,
  $$ values ('done') $$,
  'the task is done'
);

select throws_ok(
  $$ select pg_temp.move_as(
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-b000-000000000001', 'for_review') $$,
  'P0001', 'tasks.not_allowed',
  'nothing leaves done: the on-it assignee is refused'
);

select throws_ok(
  $$ select pg_temp.move_as(
       '00000000-0000-4000-a000-000000000008',
       '00000000-0000-4000-b000-000000000001', 'to_do') $$,
  'P0001', 'tasks.not_allowed',
  'nothing leaves done: a top editor is refused'
);

select is(
  array[
    pg_temp.query_as('00000000-0000-4000-a000-000000000002', $q$ select allowed_moves::text from public.task_capabilities('{00000000-0000-4000-b000-000000000001}') $q$),
    pg_temp.query_as('00000000-0000-4000-a000-000000000003', $q$ select allowed_moves::text from public.task_capabilities('{00000000-0000-4000-b000-000000000001}') $q$),
    pg_temp.query_as('00000000-0000-4000-a000-000000000004', $q$ select allowed_moves::text from public.task_capabilities('{00000000-0000-4000-b000-000000000001}') $q$),
    pg_temp.query_as('00000000-0000-4000-a000-000000000008', $q$ select allowed_moves::text from public.task_capabilities('{00000000-0000-4000-b000-000000000001}') $q$)
  ],
  array['{}', '{}', '{}', '{}'],
  'no move out of done is offered to the assignee, other staff, the Head or a top editor'
);

-- Can't take this: the reason is trimmed and stored only for a
-- needs_reassignment slot with a non-blank reason.

select lives_ok(
  $$ select pg_temp.respond_as(
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-c000-000000000004', 'needs_reassignment',
       E'  Exams all week \n') $$,
  'Can''t take this, with a reason'
);

select results_eq(
  $$ select a.state::text, r.reason
     from public.task_assignments a
     left join public.assignment_reasons r on r.assignment_id = a.id
     where a.id = '00000000-0000-4000-c000-000000000004' $$,
  $$ values ('needs_reassignment', 'Exams all week') $$,
  'the slot needs reassignment, and its reason is stored trimmed'
);

select lives_ok(
  $$ select pg_temp.respond_as(
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-c000-000000000005', 'needs_reassignment',
       E' \t\n ') $$,
  'Can''t take this, with a reason of only whitespace'
);

select lives_ok(
  $$ select pg_temp.respond_as(
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-c000-000000000006', 'needs_reassignment') $$,
  'Can''t take this, with no reason'
);

-- A stale row (here written directly, as nothing else can) is deleted.
insert into public.assignment_reasons (assignment_id, reason)
values ('00000000-0000-4000-c000-000000000007', 'Stale reason');

select lives_ok(
  $$ select pg_temp.respond_as(
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-c000-000000000007', 'on_it', 'Ignored reason') $$,
  'I''m on it, with a reason passed anyway'
);

select results_eq(
  $$ select a.id, a.state::text, r.reason
     from public.task_assignments a
     left join public.assignment_reasons r on r.assignment_id = a.id
     where a.id in ('00000000-0000-4000-c000-000000000005',
                    '00000000-0000-4000-c000-000000000006',
                    '00000000-0000-4000-c000-000000000007')
     order by a.id $$,
  $$ values ('00000000-0000-4000-c000-000000000005'::uuid, 'needs_reassignment', null::text),
            ('00000000-0000-4000-c000-000000000006'::uuid, 'needs_reassignment', null::text),
            ('00000000-0000-4000-c000-000000000007'::uuid, 'on_it', null::text) $$,
  'a blank or missing reason stores no row, and on_it deletes a stale one without storing its own'
);

select throws_ok(
  $$ select pg_temp.respond_as(
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-c000-000000000008', 'needs_reassignment',
       repeat('x', 281)) $$,
  '23514', null,
  'a reason over 280 characters is refused by assignment_reasons_reason_format'
);

select lives_ok(
  $$ select pg_temp.respond_as(
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-c000-000000000008', 'needs_reassignment',
       '  ' || repeat('x', 280) || E'\n') $$,
  'a reason of 280 characters once trimmed is accepted'
);

select is(
  (select char_length(reason) from public.assignment_reasons
   where assignment_id = '00000000-0000-4000-c000-000000000008'),
  280,
  'and stored at 280 characters'
);

-- Activity: one row per response, never holding the reason, readable by an
-- active member and not by a pending one.

select bag_eq(
  $$ select entity_id, entity_type, action from public.activity
     where entity_id in ('00000000-0000-4000-c000-000000000004',
                         '00000000-0000-4000-c000-000000000005',
                         '00000000-0000-4000-c000-000000000006',
                         '00000000-0000-4000-c000-000000000007',
                         '00000000-0000-4000-c000-000000000008') $$,
  $$ values ('00000000-0000-4000-c000-000000000004'::uuid, 'task_assignment', 'slot_needs_reassignment'),
            ('00000000-0000-4000-c000-000000000005'::uuid, 'task_assignment', 'slot_needs_reassignment'),
            ('00000000-0000-4000-c000-000000000006'::uuid, 'task_assignment', 'slot_needs_reassignment'),
            ('00000000-0000-4000-c000-000000000007'::uuid, 'task_assignment', 'slot_on_it'),
            ('00000000-0000-4000-c000-000000000008'::uuid, 'task_assignment', 'slot_needs_reassignment') $$,
  'each response logs one activity row, named for the new state and never holding the reason'
);

select is(
  pg_temp.query_as(
    '00000000-0000-4000-a000-000000000003',
    $q$ select count(*)::text from public.activity
        where entity_type = 'task_assignment'
          and entity_id::text like '00000000-0000-4000-c000-%' $q$
  ),
  (select count(*)::text from public.activity
   where entity_type = 'task_assignment'
     and entity_id::text like '00000000-0000-4000-c000-%'),
  'an active member (not the actor) reads every slot activity row'
);

select is(
  pg_temp.query_as(
    '00000000-0000-4000-a000-000000000001',
    $q$ select count(*)::text from public.activity
        where entity_type in ('task', 'task_assignment') $q$
  ),
  '0',
  'a pending caller reads no task or slot activity'
);

-- Nobody writes assignment_reasons directly, not even the slot's assignee.

select throws_ok(
  $$ select pg_temp.query_as(
       '00000000-0000-4000-a000-000000000002',
       $q$ insert into public.assignment_reasons (assignment_id, reason)
           values ('00000000-0000-4000-c000-000000000003', 'Forged')
           returning reason $q$) $$,
  '42501', null,
  'the assignee can''t insert into assignment_reasons directly'
);

select throws_ok(
  $$ select pg_temp.query_as(
       '00000000-0000-4000-a000-000000000002',
       $q$ delete from public.assignment_reasons
           where assignment_id = '00000000-0000-4000-c000-000000000004'
           returning reason $q$) $$,
  '42501', null,
  'the assignee can''t delete from assignment_reasons directly'
);

-- The helpers answer false, not null, for a caller who isn't active and for
-- an id that doesn't exist.

select is(
  pg_temp.query_as(
    '00000000-0000-4000-a000-000000000001',
    $q$ select (private.can_respond_to_slot('00000000-0000-4000-c000-000000000023')
                or private.can_move_task('00000000-0000-4000-b000-000000000024', 'done')
                or private.is_task_approver('00000000-0000-4000-b000-000000000024'))::text $q$
  ),
  'false',
  'a pending caller gets false from every helper, even on their own slot and the prototype edge'
);

select is(
  pg_temp.query_as(
    '00000000-0000-4000-a000-000000000008',
    $q$ select (private.can_respond_to_slot('00000000-0000-4000-9999-000000000000')
                or private.can_move_task('00000000-0000-4000-9999-000000000000', 'doing')
                or private.is_task_approver('00000000-0000-4000-9999-000000000000'))::text $q$
  ),
  'false',
  'a top editor gets false from every helper for an id that doesn''t exist'
);

-- The reason read matrix. Each caller, and whether they read the reason on
-- the Layout desk task, the News section task and the Opinion section task
-- (the assignee's handed-back slot on each). Everyone but the assignee who
-- reads it does so as the task's approver.

create temp table reason_callers (
  label text primary key,
  member_id uuid not null,
  layout boolean not null,
  news boolean not null,
  opinion boolean not null
);

insert into reason_callers values
  ('assignee', '00000000-0000-4000-a000-000000000002', true, true, true),
  ('Head Layout Artist (heads the Layout desk)',
   '00000000-0000-4000-a000-000000000004', true, false, false),
  ('News Editor (heads the News section)',
   '00000000-0000-4000-a000-000000000006', false, true, false),
  ('Editor-in-Chief', '00000000-0000-4000-a000-000000000008', true, true, true),
  ('Associate Editor', '00000000-0000-4000-a000-000000000009', true, true, true),
  ('Managing Editor', '00000000-0000-4000-a000-000000000010', true, true, true),
  ('Head Cartoonist (another desk''s Head)',
   '00000000-0000-4000-a000-000000000005', false, false, false),
  ('Sports Editor (another section''s editor)',
   '00000000-0000-4000-a000-000000000007', false, false, false),
  ('Finance Manager (on the Board, not an approver)',
   '00000000-0000-4000-a000-000000000011', false, false, false),
  ('other staff (a co-assignee on the Layout task)',
   '00000000-0000-4000-a000-000000000003', false, false, false),
  ('pending', '00000000-0000-4000-a000-000000000001', false, false, false);

create temp table reason_expected as
select c.label,
       t.task,
       t.sees as sees_reason,
       t.sees and c.label <> 'assignee' as is_approver
from reason_callers c
cross join lateral (
  values ('layout', c.layout), ('news', c.news), ('opinion', c.opinion)
) as t (task, sees);

create temp table reason_observed (like reason_expected);

do $$
declare
  v_callers reason_callers[];
  c reason_callers;
  v_tasks constant text[] := array['layout', 'news', 'opinion'];
  v_task_ids constant uuid[] := array[
    '00000000-0000-4000-b000-000000000011',
    '00000000-0000-4000-b000-000000000012',
    '00000000-0000-4000-b000-000000000013'
  ]::uuid[];
  v_slot_ids constant uuid[] := array[
    '00000000-0000-4000-c000-000000000011',
    '00000000-0000-4000-c000-000000000012',
    '00000000-0000-4000-c000-000000000013'
  ]::uuid[];
  v_sees boolean[];
  v_approver boolean[];
begin
  -- Read the fixtures while still `postgres`: `authenticated` can't read
  -- temp tables.
  select array_agg(x) into v_callers from reason_callers x;

  foreach c in array v_callers loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', c.member_id, 'role', 'authenticated')::text,
      true
    );
    set local role authenticated;

    v_sees := '{}';
    v_approver := '{}';
    for i in 1 .. array_length(v_slot_ids, 1) loop
      v_sees := v_sees || exists (
        select 1 from public.assignment_reasons r
        where r.assignment_id = v_slot_ids[i]
      );
      v_approver := v_approver || private.is_task_approver(v_task_ids[i]);
    end loop;

    set local role postgres;
    insert into reason_observed
    select c.label, t.task, t.sees, t.approver
    from unnest(v_tasks, v_sees, v_approver) as t (task, sees, approver);
  end loop;
end
$$;

select set_eq(
  $$ select * from reason_observed $$,
  $$ select * from reason_expected $$,
  'each caller reads a hand-back reason only as the slot''s assignee or the task''s approver'
);

-- task_capabilities per caller and state: the expected answers, then a probe
-- of every move and response each caller could try, checked against what
-- was offered (each probe is rolled back).

create temp table caps_expected (
  caller text not null,
  task_id uuid not null,
  allowed_moves text not null,
  respondable_slot_ids text not null
);

insert into caps_expected values
  ('assignee', '00000000-0000-4000-b000-000000000021', '{}', '{00000000-0000-4000-c000-000000000021}'),
  ('assignee', '00000000-0000-4000-b000-000000000022', '{doing,for_review}', '{}'),
  ('assignee', '00000000-0000-4000-b000-000000000023', '{to_do,for_review}', '{}'),
  ('assignee', '00000000-0000-4000-b000-000000000024', '{to_do,doing,done}', '{}'),
  ('assignee', '00000000-0000-4000-b000-000000000025', '{}', '{}'),
  ('assignee', '00000000-0000-4000-b000-000000000026', '{done}', '{00000000-0000-4000-c000-000000000028}'),
  ('assignee', '00000000-0000-4000-b000-000000000027', '{}', '{}');

-- Everyone else active: only the prototype edge on the two For Review tasks,
-- and the other staff member's own awaiting slot on b21. A pending caller
-- reads no task, so gets no row at all.
insert into caps_expected
select c.caller,
       t.id,
       case when t.id in ('00000000-0000-4000-b000-000000000024',
                          '00000000-0000-4000-b000-000000000026')
         then '{done}' else '{}' end,
       case when c.caller = 'other staff'
              and t.id = '00000000-0000-4000-b000-000000000021'
         then '{00000000-0000-4000-c000-000000000022}' else '{}' end
from (values ('other staff'), ('Head Layout Artist'), ('Editor-in-Chief')) as c (caller)
cross join (
  values ('00000000-0000-4000-b000-000000000021'::uuid),
         ('00000000-0000-4000-b000-000000000022'),
         ('00000000-0000-4000-b000-000000000023'),
         ('00000000-0000-4000-b000-000000000024'),
         ('00000000-0000-4000-b000-000000000025'),
         ('00000000-0000-4000-b000-000000000026'),
         ('00000000-0000-4000-b000-000000000027')
) as t (id);

create temp table caps_observed (like caps_expected);
create temp table caps_disagreements (disagreement text);

do $$
declare
  v_labels constant text[] := array[
    'assignee', 'other staff', 'Head Layout Artist', 'Editor-in-Chief', 'pending'
  ];
  v_members constant uuid[] := array[
    '00000000-0000-4000-a000-000000000002',
    '00000000-0000-4000-a000-000000000003',
    '00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-a000-000000000008',
    '00000000-0000-4000-a000-000000000001'
  ]::uuid[];
  v_tasks constant uuid[] := array[
    '00000000-0000-4000-b000-000000000021',
    '00000000-0000-4000-b000-000000000022',
    '00000000-0000-4000-b000-000000000023',
    '00000000-0000-4000-b000-000000000024',
    '00000000-0000-4000-b000-000000000025',
    '00000000-0000-4000-b000-000000000026',
    '00000000-0000-4000-b000-000000000027'
  ]::uuid[];
  v_slots constant uuid[] := array[
    '00000000-0000-4000-c000-000000000021',
    '00000000-0000-4000-c000-000000000022',
    '00000000-0000-4000-c000-000000000023',
    '00000000-0000-4000-c000-000000000024',
    '00000000-0000-4000-c000-000000000025',
    '00000000-0000-4000-c000-000000000026',
    '00000000-0000-4000-c000-000000000027',
    '00000000-0000-4000-c000-000000000028',
    '00000000-0000-4000-c000-000000000029'
  ]::uuid[];
  v_obs_tasks uuid[];
  v_obs_moves text[];
  v_obs_slots text[];
  v_disagreements text[] := '{}';
  v_task uuid;
  v_slot uuid;
  v_column public.task_column;
  v_response public.slot_state;
  v_offered boolean;
  v_accepted boolean;
begin
  for i in 1 .. array_length(v_members, 1) loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_members[i], 'role', 'authenticated')::text,
      true
    );
    set local role authenticated;

    select coalesce(array_agg(k.task_id order by k.task_id), '{}'),
           coalesce(array_agg(k.allowed_moves::text order by k.task_id), '{}'),
           coalesce(array_agg(k.respondable_slot_ids::text order by k.task_id), '{}')
      into v_obs_tasks, v_obs_moves, v_obs_slots
    from public.task_capabilities(v_tasks) k;

    -- Every move: offered exactly when move_task accepts it.
    foreach v_task in array v_tasks loop
      foreach v_column in array enum_range(null::public.task_column) loop
        v_offered := coalesce((
          select v_column = any (k.allowed_moves)
          from public.task_capabilities(array[v_task]) k
        ), false);
        begin
          perform public.move_task(v_task, v_column);
          raise exception using errcode = 'P0001', message = 'probe.accepted';
        exception when raise_exception then
          v_accepted := sqlerrm = 'probe.accepted';
        end;
        if v_offered is distinct from v_accepted then
          v_disagreements := v_disagreements || format(
            '%s: move %s to %s offered %s, accepted %s',
            v_labels[i], v_task, v_column, v_offered, v_accepted
          );
        end if;
      end loop;
    end loop;

    -- Every response: offered exactly when respond_to_slot accepts it.
    foreach v_slot in array v_slots loop
      v_offered := coalesce((
        select bool_or(v_slot = any (k.respondable_slot_ids))
        from public.task_capabilities(v_tasks) k
      ), false);
      foreach v_response in array
        array['on_it', 'needs_reassignment']::public.slot_state[]
      loop
        begin
          perform public.respond_to_slot(v_slot, v_response, 'Probe reason');
          raise exception using errcode = 'P0001', message = 'probe.accepted';
        exception when raise_exception then
          v_accepted := sqlerrm = 'probe.accepted';
        end;
        if v_offered is distinct from v_accepted then
          v_disagreements := v_disagreements || format(
            '%s: respond %s to slot %s offered %s, accepted %s',
            v_labels[i], v_response, v_slot, v_offered, v_accepted
          );
        end if;
      end loop;
    end loop;

    set local role postgres;
    insert into caps_observed
    select v_labels[i], o.task_id, o.moves, o.slots
    from unnest(v_obs_tasks, v_obs_moves, v_obs_slots) as o (task_id, moves, slots);
  end loop;

  insert into caps_disagreements select unnest(v_disagreements);
end
$$;

select set_eq(
  $$ select * from caps_observed $$,
  $$ select * from caps_expected $$,
  'task_capabilities offers each caller the expected moves (enum order) and respondable slots, and a pending caller no row'
);

select is_empty(
  $$ select * from caps_disagreements $$,
  'every move and response task_capabilities offers is accepted by its command, and nothing else is'
);

select * from finish();

rollback;
