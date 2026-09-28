-- Tasks (AD-1, AD-2, AD-4, AD-19): create_task's definer/owner/search_path
-- pins, the caller matrix (pending/staff/admin), RLS allow/deny on
-- tasks/task_assignments/activity, and the owner/slot validation the I/O
-- Matrix (spec-1-5-admin-task-creation.md) requires.
--
-- Fixture auth users are created here, so the test doesn't depend on
-- seed.sql; everything is rolled back. It runs locally and on staging
-- (`supabase test db --linked`), seeded or not.

begin;

-- `supabase test db --linked` connects as the CLI's login role
-- (`cli_login_postgres`), which can't use the `extensions` schema where pgTAP
-- lives and has the default "$user", public search_path. Run as `postgres`,
-- as locally, with `extensions` on the path, rather than rely on how the
-- session was opened.
set local role postgres;
set local search_path = "$user", public, extensions;

select plan(32);

-- Fixtures.

create function pg_temp.new_auth_user(p_id uuid, p_email text, p_meta jsonb)
returns void
language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated',
          'authenticated', p_email, p_meta)
$$;

create function pg_temp.add_position(p_member uuid, p_position text, p_primary boolean)
returns void
language sql as $$
  insert into public.member_positions (member_id, position, is_primary)
  values (p_member, p_position, p_primary)
$$;

-- A pending caller (no position), an active staff member (Staff Layout
-- Artist, on the Layout desk) and an active admin (Head Layout Artist, heads
-- Layout, so an editorial_admin per role_for_positions).
select pg_temp.new_auth_user(
  '00000000-0000-4000-9000-000000000001', 'task-pending@example.com', '{}'
);
select pg_temp.new_auth_user(
  '00000000-0000-4000-9000-000000000002', 'task-staff@example.com', '{}'
);
select pg_temp.new_auth_user(
  '00000000-0000-4000-9000-000000000003', 'task-admin@example.com', '{}'
);
select pg_temp.add_position(
  '00000000-0000-4000-9000-000000000002', 'staff_layout_artist', true
);
select pg_temp.add_position(
  '00000000-0000-4000-9000-000000000003', 'head_layout_artist', true
);

-- A second active member to use as a valid slot assignee (also on Layout),
-- and note the pending caller above doubles as an invalid slot member.
select pg_temp.new_auth_user(
  '00000000-0000-4000-9000-000000000004', 'task-assignee@example.com', '{}'
);
select pg_temp.add_position(
  '00000000-0000-4000-9000-000000000004', 'staff_layout_artist', true
);

-- Runs create_task as the given caller (via the request.jwt.claims GUC, as
-- RLS and private.current_member_id() read it). On success, role/claims are
-- reset to postgres/none before returning. On a raised exception, pgTAP's
-- throws_ok() (which invokes this through its own EXCEPTION block) rolls
-- back its own savepoint when it catches it, which undoes every SET LOCAL
-- and set_config() made during the call, including the ones here — so
-- nothing extra is needed to restore the role in that case.
create function pg_temp.create_task_as(
  p_caller uuid,
  p_title text,
  p_owning_section_id text,
  p_owning_desk_id text,
  p_slots jsonb,
  p_reference_url text default null,
  p_description text default null
) returns uuid
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
    p_title, p_description, p_owning_section_id, p_owning_desk_id,
    '2026-11-01T00:00:00+08'::timestamptz, p_reference_url, p_slots
  ) into v_id;
  set local role postgres;
  return v_id;
end;
$$;

-- One valid slot naming the active staff assignee, for reuse across cases.
create function pg_temp.one_slot(p_member uuid)
returns jsonb
language sql as $$
  select jsonb_build_array(
    jsonb_build_object('role', 'layout_artist', 'member_id', p_member)
  )
$$;

-- create_task's definer/owner/search_path pins (mirrors
-- supabase/tests/members/members.test.sql's handle_new_user pins).

select is_definer(
  'public', 'create_task',
  array['text', 'text', 'text', 'text', 'timestamptz', 'text', 'jsonb'],
  'public.create_task(...) is security definer'
);

select function_owner_is(
  'public', 'create_task',
  array['text', 'text', 'text', 'text', 'timestamptz', 'text', 'jsonb'],
  'postgres',
  'public.create_task(...) is owned by postgres'
);

select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'public.create_task(text, text, text, text, timestamptz, text, jsonb)'::regprocedure),
  array['search_path=""'],
  'public.create_task(...) sets search_path = '''''
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_task(text, text, text, text, timestamptz, text, jsonb)'::regprocedure,
    'EXECUTE'
  ),
  'authenticated may EXECUTE create_task'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_task(text, text, text, text, timestamptz, text, jsonb)'::regprocedure,
    'EXECUTE'
  ),
  'anon may not EXECUTE create_task'
);

-- The caller matrix: pending and staff are refused, admin succeeds.

select throws_ok(
  $$ select pg_temp.create_task_as(
       '00000000-0000-4000-9000-000000000001', 'Pending caller task',
       null, 'layout',
       pg_temp.one_slot('00000000-0000-4000-9000-000000000004')) $$,
  'P0001', 'auth.not_active',
  'a pending caller gets auth.not_active'
);

select throws_ok(
  $$ select pg_temp.create_task_as(
       '00000000-4000-4000-9000-000000000099', 'Signed-out caller task',
       null, 'layout',
       pg_temp.one_slot('00000000-0000-4000-9000-000000000004')) $$,
  'P0001', 'auth.not_active',
  'a signed-out caller (no members row) gets auth.not_active'
);

select throws_ok(
  $$ select pg_temp.create_task_as(
       '00000000-0000-4000-9000-000000000002', 'Staff caller task',
       null, 'layout',
       pg_temp.one_slot('00000000-0000-4000-9000-000000000004')) $$,
  'P0001', 'tasks.not_admin',
  'an active staff caller (not admin) gets tasks.not_admin'
);

select lives_ok(
  $$ select pg_temp.create_task_as(
       '00000000-0000-4000-9000-000000000003', 'Admin caller task',
       null, 'layout',
       pg_temp.one_slot('00000000-0000-4000-9000-000000000004')) $$,
  'an active admin caller succeeds'
);

-- The created task and its slot.

select results_eq(
  $$ select title, "column", owning_section_id, owning_desk_id
     from public.tasks where title = 'Admin caller task' $$,
  $$ values ('Admin caller task', 'to_do'::public.task_column,
             null::text, 'layout') $$,
  'the task is created in to_do with the given owner'
);

select results_eq(
  $$ select ta.role::text, ta.state::text
     from public.task_assignments ta
     join public.tasks t on t.id = ta.task_id
     where t.title = 'Admin caller task' $$,
  $$ values ('layout_artist', 'awaiting_response') $$,
  'the slot is created awaiting_response'
);

select results_eq(
  $$ select a.entity_type, a.action, a.actor_id,
            count(distinct a.op_id)::int
     from public.activity a
     join public.tasks t on t.id = a.entity_id
     where t.title = 'Admin caller task'
     group by a.entity_type, a.action, a.actor_id $$,
  $$ values ('task', 'created', '00000000-0000-4000-9000-000000000003'::uuid, 1) $$,
  'one activity row is logged for the task, sharing one op_id'
);

-- Owner validation: two owners, no owner, and the Writers desk.

select throws_ok(
  $$ select pg_temp.create_task_as(
       '00000000-0000-4000-9000-000000000003', 'Two owners',
       'news', 'layout',
       pg_temp.one_slot('00000000-0000-4000-9000-000000000004')) $$,
  '23514', null,
  'two owners (section and desk both set) is rejected by tasks_owner_xor'
);

select throws_ok(
  $$ select pg_temp.create_task_as(
       '00000000-0000-4000-9000-000000000003', 'No owner',
       null, null,
       pg_temp.one_slot('00000000-0000-4000-9000-000000000004')) $$,
  '23514', null,
  'no owner (neither section nor desk set) is rejected by tasks_owner_xor'
);

select throws_ok(
  $$ select pg_temp.create_task_as(
       '00000000-0000-4000-9000-000000000003', 'Writers desk owner',
       null, 'writers',
       pg_temp.one_slot('00000000-0000-4000-9000-000000000004')) $$,
  '23514', null,
  'the Writers desk as owner is rejected by tasks_owner_not_writers'
);

-- Slot validation: no slots, and a slot naming an inactive/pending member.

select throws_ok(
  $$ select pg_temp.create_task_as(
       '00000000-0000-4000-9000-000000000003', 'No slots',
       null, 'layout', '[]'::jsonb) $$,
  'P0001', 'tasks.no_slots',
  'no slots is rejected with tasks.no_slots'
);

select throws_ok(
  $$ select pg_temp.create_task_as(
       '00000000-0000-4000-9000-000000000003', 'Pending slot member',
       null, 'layout',
       pg_temp.one_slot('00000000-0000-4000-9000-000000000001')) $$,
  'P0001', 'tasks.invalid_slot_member',
  'a slot naming a pending member is rejected with tasks.invalid_slot_member'
);

select throws_ok(
  $$ select pg_temp.create_task_as(
       '00000000-0000-4000-9000-000000000003', 'Nonexistent slot member',
       null, 'layout',
       pg_temp.one_slot('00000000-0000-4000-9999-000000000000')) $$,
  'P0001', 'tasks.invalid_slot_member',
  'a slot naming an id with no members row is rejected with tasks.invalid_slot_member'
);

-- The database CHECK backstops on title, description, and reference_url
-- (Zod blocks all three first; the I/O Matrix names the last one the
-- backstop, and the same reasoning covers the other two mirrored limits).

select throws_ok(
  $$ select pg_temp.create_task_as(
       '00000000-0000-4000-9000-000000000003', repeat('x', 201),
       null, 'layout',
       pg_temp.one_slot('00000000-0000-4000-9000-000000000004')) $$,
  '23514', null,
  'a title over 200 characters is rejected by tasks_title_length'
);

select throws_ok(
  $$ select pg_temp.create_task_as(
       '00000000-0000-4000-9000-000000000003', 'Long description',
       null, 'layout',
       pg_temp.one_slot('00000000-0000-4000-9000-000000000004'),
       null, repeat('x', 5001)) $$,
  '23514', null,
  'a description over 5000 characters is rejected by tasks_description_length'
);

select throws_ok(
  $$ select pg_temp.create_task_as(
       '00000000-0000-4000-9000-000000000003', 'Bad URL',
       null, 'layout',
       pg_temp.one_slot('00000000-0000-4000-9000-000000000004'),
       'not-a-url') $$,
  '23514', null,
  'a malformed reference_url is rejected by tasks_reference_url_format'
);

-- RLS: active members (staff and admin) read every row of tasks,
-- task_assignments and task-type activity; a pending caller reads none;
-- nobody writes any of the three directly.
--
-- pgTAP's assertion functions must be invoked with a top-level `select` (the
-- harness captures the query's result row as the TAP line); calling them
-- with `perform` inside a DO block would silently drop the assertion. So the
-- DO block below only captures what each caller sees/can do into a temp
-- table, and the `select is(...)`/`select ok(...)` assertions run after it,
-- back as postgres.

create temp table rls_observed (
  pending_tasks int,
  pending_assignments int,
  pending_activity int,
  staff_tasks int,
  staff_assignments int,
  staff_activity int,
  insert_denied boolean,
  update_denied boolean,
  delete_denied boolean,
  assignment_insert_denied boolean,
  activity_insert_denied boolean
);

do $$
declare
  v_pending constant uuid := '00000000-0000-4000-9000-000000000001';
  v_staff constant uuid := '00000000-0000-4000-9000-000000000002';
  v_admin constant uuid := '00000000-0000-4000-9000-000000000003';
  v_task_id uuid;
  r rls_observed;
begin
  select t.id into v_task_id from public.tasks t
  where t.title = 'Admin caller task';

  -- Pending: sees nothing.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_pending, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
  select count(*) into r.pending_tasks from public.tasks;
  select count(*) into r.pending_assignments from public.task_assignments;
  select count(*) into r.pending_activity
    from public.activity where entity_type = 'task';
  set local role postgres;

  -- Staff: sees every row.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_staff, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
  select count(*) into r.staff_tasks from public.tasks;
  select count(*) into r.staff_assignments from public.task_assignments;
  select count(*) into r.staff_activity
    from public.activity where entity_type = 'task';
  set local role postgres;

  -- No caller writes any of the three directly, whatever their role.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  r.insert_denied := true;
  begin
    insert into public.tasks (title, owning_desk_id, due_at)
    values ('Direct insert', 'layout', now());
    r.insert_denied := false;
  exception when insufficient_privilege then null;
  end;

  r.update_denied := true;
  begin
    update public.tasks set title = 'Changed' where id = v_task_id;
    r.update_denied := false;
  exception when insufficient_privilege then null;
  end;

  r.delete_denied := true;
  begin
    delete from public.tasks where id = v_task_id;
    r.delete_denied := false;
  exception when insufficient_privilege then null;
  end;

  r.assignment_insert_denied := true;
  begin
    insert into public.task_assignments (task_id, member_id, role)
    values (v_task_id, v_admin, 'layout_artist');
    r.assignment_insert_denied := false;
  exception when insufficient_privilege then null;
  end;

  r.activity_insert_denied := true;
  begin
    insert into public.activity (op_id, entity_type, entity_id, actor_id, action)
    values (gen_random_uuid(), 'task', v_task_id, v_admin, 'forged');
    r.activity_insert_denied := false;
  exception when insufficient_privilege then null;
  end;

  set local role postgres;
  insert into rls_observed select r.*;
end
$$;

select is(
  (select pending_tasks from rls_observed), 0,
  'a pending caller reads no tasks'
);
select is(
  (select pending_assignments from rls_observed), 0,
  'a pending caller reads no task_assignments'
);
select is(
  (select pending_activity from rls_observed), 0,
  'a pending caller reads no task-type activity'
);
select is(
  (select staff_tasks from rls_observed),
  (select count(*)::int from public.tasks),
  'an active staff member reads every task'
);
select is(
  (select staff_assignments from rls_observed),
  (select count(*)::int from public.task_assignments),
  'an active staff member reads every task_assignment'
);
select is(
  (select staff_activity from rls_observed),
  (select count(*)::int from public.activity where entity_type = 'task'),
  'an active staff member reads every task-type activity row'
);
select ok(
  (select insert_denied from rls_observed),
  'an admin can''t insert into tasks directly'
);
select ok(
  (select update_denied from rls_observed),
  'an admin can''t update tasks directly'
);
select ok(
  (select delete_denied from rls_observed),
  'an admin can''t delete from tasks directly'
);
select ok(
  (select assignment_insert_denied from rls_observed),
  'an admin can''t insert into task_assignments directly'
);
select ok(
  (select activity_insert_denied from rls_observed),
  'an admin can''t insert into activity directly'
);

select * from finish();

rollback;
