-- Task delete (Story 3.2, AD-1, AD-4, AD-16, AD-19, AD-21): delete_task, the
-- soft delete every read and command now honors, and task_capabilities'
-- can_manage. Covers delete_task along the approver matrix (a fresh task per
-- caller and owner, so every allowed delete really happens), stale (a moved
-- task, a null version) and not_found, the row afterwards, can_manage per
-- caller in every column (and that it agrees with what delete_task
-- accepts), every command and helper on two deleted tasks, the open slots,
-- the RLS reads, and the definer/owner/search_path pins.
--
-- Fixtures follow approver_review.test.sql: auth users, tasks and slots are
-- created here (tasks and slots inserted directly as `postgres`, so a test
-- can start from any column), so the test doesn't depend on seed.sql;
-- everything is rolled back. It runs locally and on staging
-- (`supabase test db --linked`), seeded or not.

begin;

-- See responses_and_moves.test.sql: run as `postgres` with `extensions` on the
-- path, whichever role `supabase test db --linked` connected as.
set local role postgres;
set local search_path = "$user", public, extensions;

select plan(37);

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

-- Every fixture task was last changed on Oct 1, so a command that touches
-- it gives it a new version (now() is the transaction's start). A Done task
-- carries done_at (tasks_done_at_matches_column).
create function pg_temp.new_task(
  p_id uuid,
  p_section text,
  p_desk text,
  p_column public.task_column
)
returns void
language sql as $$
  insert into public.tasks (
    id, title, owning_section_id, owning_desk_id, due_at, "column", done_at,
    created_at, updated_at
  )
  values (p_id, 'Fixture task ' || p_id, p_section, p_desk,
          '2026-11-01T00:00:00+08', p_column,
          case when p_column = 'done' then '2026-10-02T09:00:00+08'::timestamptz end,
          '2026-10-01T00:00:00+08', '2026-10-01T00:00:00+08')
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

create function pg_temp.new_activity(p_type text, p_id uuid, p_action text)
returns void
language sql as $$
  insert into public.activity (op_id, entity_type, entity_id, actor_id, action)
  values (gen_random_uuid(), p_type, p_id,
          '00000000-0000-4000-a000-000000000004', p_action)
$$;

-- Clear any seeded Editor-in-Chief (member_positions_one_editor_in_chief) so
-- the fixture one below can hold the position; rolled back with the rest.
delete from public.member_positions where position = 'editor_in_chief';

-- Callers, as in approver_review.test.sql. Each active one holds one primary
-- position.
select pg_temp.new_member('00000000-0000-4000-a000-000000000001', 'dl-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-000000000002', 'dl-assignee@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000003', 'dl-staff@example.com', 'staff_writer');
select pg_temp.new_member('00000000-0000-4000-a000-000000000004', 'dl-head-layout@example.com', 'head_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000005', 'dl-head-cartoonist@example.com', 'head_cartoonist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000006', 'dl-news-editor@example.com', 'news_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000007', 'dl-sports-editor@example.com', 'sports_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000008', 'dl-eic@example.com', 'editor_in_chief');
select pg_temp.new_member('00000000-0000-4000-a000-000000000009', 'dl-associate@example.com', 'associate_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000010', 'dl-managing@example.com', 'managing_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000011', 'dl-finance@example.com', 'finance_manager');

-- The two tasks deleted below, both Layout, each with the assignee's On it,
-- awaiting and handed-back (with a reason) slots:
--   b01 For Review (its slots c11, c12, c13)
--   b02 Done, with a revision note (its slots c21, c22, c23)
select pg_temp.new_task('00000000-0000-4000-b000-000000000001', null, 'layout', 'for_review');
select pg_temp.new_task('00000000-0000-4000-b000-000000000002', null, 'layout', 'done');
update public.tasks
set revision_note = 'Old note',
    revision_note_by = '00000000-0000-4000-a000-000000000004',
    revision_note_at = '2026-10-01T00:00:00+08'
where id = '00000000-0000-4000-b000-000000000002';
select pg_temp.new_slot('00000000-0000-4000-c000-000000000011', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000012', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'cartoonist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000013', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'photojournalist', 'needs_reassignment');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000021', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000022', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'cartoonist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000023', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'photojournalist', 'needs_reassignment');
insert into public.assignment_reasons (assignment_id, reason)
values ('00000000-0000-4000-c000-000000000013', 'Exams all week'),
       ('00000000-0000-4000-c000-000000000023', 'Exams all week');
select pg_temp.new_activity('task', '00000000-0000-4000-b000-000000000001', 'created');
select pg_temp.new_activity('task', '00000000-0000-4000-b000-000000000002', 'created');
select pg_temp.new_activity('task_assignment', '00000000-0000-4000-c000-000000000011', 'slot_on_it');
select pg_temp.new_activity('task_assignment', '00000000-0000-4000-c000-000000000013', 'slot_needs_reassignment');
select pg_temp.new_activity('task_assignment', '00000000-0000-4000-c000-000000000021', 'slot_on_it');
select pg_temp.new_activity('task_assignment', '00000000-0000-4000-c000-000000000023', 'slot_needs_reassignment');

-- The live control, never deleted: b31 Layout, Doing, with the assignee's
-- On it slot c31 and handed-back slot c32 (with a reason), and activity.
select pg_temp.new_task('00000000-0000-4000-b000-000000000031', null, 'layout', 'doing');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000031', '00000000-0000-4000-b000-000000000031', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000032', '00000000-0000-4000-b000-000000000031', '00000000-0000-4000-a000-000000000002', 'cartoonist', 'needs_reassignment');
insert into public.assignment_reasons (assignment_id, reason)
values ('00000000-0000-4000-c000-000000000032', 'Out sick');
select pg_temp.new_activity('task', '00000000-0000-4000-b000-000000000031', 'created');
select pg_temp.new_activity('task_assignment', '00000000-0000-4000-c000-000000000031', 'slot_on_it');

-- The stale task: b41 Layout, To Do, the assignee On it.
select pg_temp.new_task('00000000-0000-4000-b000-000000000041', null, 'layout', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000041', '00000000-0000-4000-b000-000000000041', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');

-- Run a command, or a query returning one value, as the given caller (via
-- the request.jwt.claims GUC, as RLS and private.current_member_id() read
-- it). On success, the role is reset to postgres before returning. On a
-- raised exception, pgTAP's throws_ok() rolls back its own savepoint, which
-- undoes the SET LOCAL made here.
create function pg_temp.as_caller(p_caller uuid)
returns void
language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_caller, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end;
$$;

create function pg_temp.delete_as(
  p_caller uuid,
  p_task uuid,
  p_version timestamptz
)
returns void
language plpgsql as $$
begin
  perform pg_temp.as_caller(p_caller);
  perform public.delete_task(p_task, p_version);
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
  perform pg_temp.as_caller(p_caller);
  perform public.move_task(p_task, p_to_column);
  set local role postgres;
end;
$$;

create function pg_temp.query_as(p_caller uuid, p_sql text)
returns text
language plpgsql as $$
declare
  v_result text;
begin
  perform pg_temp.as_caller(p_caller);
  execute p_sql into v_result;
  set local role postgres;
  return v_result;
end;
$$;

-- Pins.

select has_column('public', 'tasks', 'deleted_at', 'tasks has deleted_at');
select col_type_is('public', 'tasks', 'deleted_at', 'timestamp with time zone',
  'tasks.deleted_at is a timestamptz');
select col_is_null('public', 'tasks', 'deleted_at',
  'tasks.deleted_at is nullable (null while the task is live)');

select is_definer('public', 'delete_task', array['uuid', 'timestamp with time zone'],
  'public.delete_task(uuid, timestamptz) is security definer');
select function_owner_is('public', 'delete_task', array['uuid', 'timestamp with time zone'], 'postgres',
  'public.delete_task(uuid, timestamptz) is owned by postgres');
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'public.delete_task(uuid, timestamptz)'::regprocedure),
  array['search_path=""'],
  'public.delete_task(uuid, timestamptz) sets search_path = '''''
);

-- Every function this migration replaced keeps its rights, owner and empty
-- search_path.
create temp table replaced_definers (signature regprocedure primary key);
insert into replaced_definers values
  ('private.is_task_approver(uuid)'),
  ('private.can_respond_to_slot(uuid)'),
  ('private.can_hand_back_slot(uuid)'),
  ('private.can_move_task(uuid, public.task_column)'),
  ('private.can_review_task(uuid)'),
  ('private.can_reopen_task(uuid)'),
  ('public.respond_to_slot(uuid, public.slot_state, text)'),
  ('public.hand_back_slot(uuid, text)'),
  ('public.move_task(uuid, public.task_column)'),
  ('public.mark_done(uuid)'),
  ('public.send_back_task(uuid, text)'),
  ('public.reopen_task(uuid)');

select is_empty(
  $$ select r.signature::text
     from replaced_definers r
     join pg_proc p on p.oid = r.signature
     where not p.prosecdef
        or p.proowner <> 'postgres'::regrole
        or p.proconfig is distinct from array['search_path=""'] $$,
  'every replaced helper and command is still security definer, owned by postgres, with search_path = '''''
);

select is_empty(
  $$ select p.oid::regprocedure::text
     from pg_proc p
     where p.oid in ('private.open_slots(uuid)'::regprocedure,
                     'public.task_capabilities(uuid[])'::regprocedure)
       and (p.prosecdef
            or p.proowner <> 'postgres'::regrole
            or p.proconfig is distinct from array['search_path=""']) $$,
  'private.open_slots and public.task_capabilities still run with the caller''s rights, owned by postgres, with search_path = '''''
);

-- Each helper loads its task with the read predicate itself, even where
-- another helper it calls would already refuse a deleted task.
select is_empty(
  $$ select signature
     from unnest(array[
       'private.is_task_approver(uuid)',
       'private.can_respond_to_slot(uuid)',
       'private.can_hand_back_slot(uuid)',
       'private.can_move_task(uuid, public.task_column)',
       'private.can_review_task(uuid)',
       'private.can_reopen_task(uuid)',
       'private.open_slots(uuid)'
     ]) as signature
     where pg_get_functiondef(signature::regprocedure)
             !~* 't\.deleted_at\s+is\s+null' $$,
  'every helper states t.deleted_at is null'
);

select is(
  (select p.proargnames from pg_proc p
   where p.oid = 'public.task_capabilities(uuid[])'::regprocedure),
  array['ids', 'task_id', 'allowed_moves', 'respondable_slot_ids',
        'hand_back_slot_ids', 'can_review', 'can_reopen', 'can_manage'],
  'task_capabilities keeps its columns and adds can_manage last'
);

-- The approver matrix: each caller, and whether they approve the Layout,
-- News, Opinion and Editorial tasks. Opinion and Editorial have no head.

create temp table matrix_callers (
  label text primary key,
  member_id uuid not null,
  layout boolean not null,
  news boolean not null,
  opinion boolean not null,
  editorial boolean not null
);

insert into matrix_callers values
  ('Head Layout Artist (heads the Layout desk)',
   '00000000-0000-4000-a000-000000000004', true, false, false, false),
  ('News Editor (heads the News section)',
   '00000000-0000-4000-a000-000000000006', false, true, false, false),
  ('Editor-in-Chief', '00000000-0000-4000-a000-000000000008', true, true, true, true),
  ('Associate Editor', '00000000-0000-4000-a000-000000000009', true, true, true, true),
  ('Managing Editor', '00000000-0000-4000-a000-000000000010', true, true, true, true),
  ('staff assignee', '00000000-0000-4000-a000-000000000002', false, false, false, false),
  ('other staff', '00000000-0000-4000-a000-000000000003', false, false, false, false),
  ('Head Cartoonist (another desk''s Head)',
   '00000000-0000-4000-a000-000000000005', false, false, false, false),
  ('Sports Editor (another section''s editor)',
   '00000000-0000-4000-a000-000000000007', false, false, false, false),
  ('Finance Manager (on the Board, not an approver)',
   '00000000-0000-4000-a000-000000000011', false, false, false, false),
  ('pending', '00000000-0000-4000-a000-000000000001', false, false, false, false);

create temp table matrix_owners (
  owner text primary key,
  section text,
  desk text
);

insert into matrix_owners values
  ('layout', null, 'layout'),
  ('news', 'news', null),
  ('opinion', 'opinion', null),
  ('editorial', 'editorial', null);

create temp table matrix_allowed as
select c.label, c.member_id, a.owner, a.allowed
from matrix_callers c
cross join lateral (
  values ('layout', c.layout), ('news', c.news),
         ('opinion', c.opinion), ('editorial', c.editorial)
) as a (owner, allowed);

-- A fresh task for every caller and owner, so each allowed delete really
-- happens. Each owner's tasks sit in their own column, so the deletes cover
-- all four.
create temp table delete_tasks as
select m.label, m.member_id, m.owner, m.allowed,
       gen_random_uuid() as task_id,
       (case m.owner
          when 'layout' then 'to_do'
          when 'news' then 'doing'
          when 'opinion' then 'for_review'
          else 'done'
        end)::public.task_column as col
from matrix_allowed m;

do $$
begin
  perform pg_temp.new_task(d.task_id, o.section, o.desk, d.col)
  from delete_tasks d
  join matrix_owners o on o.owner = d.owner;
end
$$;

-- Results are `ok` or `<sqlstate> <message>`.
create temp table delete_expected as
select d.label, d.owner,
       case
         when d.label = 'pending' then 'P0001 auth.not_active'
         when d.allowed then 'ok'
         else 'P0001 tasks.not_approver'
       end as result
from delete_tasks d;

create temp table delete_observed (like delete_expected);

do $$
declare
  v_rows delete_tasks[];
  d delete_tasks;
  v_versions timestamptz[];
  v_labels text[] := '{}';
  v_owners text[] := '{}';
  v_results text[] := '{}';
  v_result text;
begin
  -- Read the fixtures while still `postgres`: `authenticated` can't read
  -- temp tables.
  select array_agg(x order by x.task_id), array_agg(t.updated_at order by x.task_id)
    into v_rows, v_versions
  from delete_tasks x
  join public.tasks t on t.id = x.task_id;

  for i in 1 .. array_length(v_rows, 1) loop
    d := v_rows[i];
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', d.member_id, 'role', 'authenticated')::text,
      true
    );
    set local role authenticated;
    begin
      perform public.delete_task(d.task_id, v_versions[i]);
      v_result := 'ok';
    exception when others then
      v_result := sqlstate || ' ' || sqlerrm;
    end;
    set local role postgres;
    v_labels := v_labels || d.label;
    v_owners := v_owners || d.owner;
    v_results := v_results || v_result;
  end loop;

  insert into delete_observed
  select * from unnest(v_labels, v_owners, v_results);
  perform set_config('request.jwt.claims', '', true);
end
$$;

select set_eq(
  $$ select * from delete_observed $$,
  $$ select * from delete_expected $$,
  'delete_task accepts the owner''s head and the three top editors (top editors only on Opinion and Editorial) in every column, refuses everyone else with tasks.not_approver, and a pending caller with auth.not_active'
);

select is_empty(
  $$ select d.label, d.owner
     from delete_tasks d
     join public.tasks t on t.id = d.task_id
     where d.allowed is distinct from (t.deleted_at is not null) $$,
  'exactly the accepted deletes set deleted_at'
);

select set_eq(
  $$ select v.entity_id, v.entity_type, v.actor_id, v.action
     from public.activity v
     where v.entity_id in (select task_id from delete_tasks) $$,
  $$ select d.task_id, 'task'::text as entity_type, d.member_id,
            'deleted'::text as action
     from delete_tasks d
     where d.allowed $$,
  'each accepted delete logs one deleted activity row for its task, by its actor, and a refused one logs nothing'
);

-- can_manage per caller on one task per owner and column, and whether it
-- agrees with what delete_task accepts (each probe rolled back).

create temp table caps_tasks as
select o.owner, c.col, gen_random_uuid() as task_id
from matrix_owners o
cross join unnest(enum_range(null::public.task_column)) as c (col);

do $$
begin
  perform pg_temp.new_task(k.task_id, o.section, o.desk, k.col)
  from caps_tasks k
  join matrix_owners o on o.owner = k.owner;
end
$$;

-- A pending caller reads no task, so gets no row at all.
create temp table caps_expected as
select m.label, k.task_id, m.allowed as can_manage
from matrix_allowed m
join caps_tasks k on k.owner = m.owner
where m.label <> 'pending';

create temp table caps_observed (like caps_expected);
create temp table caps_disagreements (disagreement text);

do $$
declare
  v_callers matrix_callers[];
  c matrix_callers;
  v_tasks uuid[];
  v_versions timestamptz[];
  v_caps_tasks uuid[];
  v_caps_manage boolean[];
  v_disagreements text[] := '{}';
  v_offered boolean;
  v_accepted boolean;
begin
  select array_agg(x) into v_callers from matrix_callers x;
  select array_agg(k.task_id order by k.task_id),
         array_agg(t.updated_at order by k.task_id)
    into v_tasks, v_versions
  from caps_tasks k
  join public.tasks t on t.id = k.task_id;

  foreach c in array v_callers loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', c.member_id, 'role', 'authenticated')::text,
      true
    );
    set local role authenticated;

    select coalesce(array_agg(k.task_id order by k.task_id), '{}'),
           coalesce(array_agg(k.can_manage order by k.task_id), '{}')
      into v_caps_tasks, v_caps_manage
    from public.task_capabilities(v_tasks) k;

    for i in 1 .. array_length(v_tasks, 1) loop
      v_offered := coalesce(
        v_caps_manage[array_position(v_caps_tasks, v_tasks[i])], false);
      begin
        perform public.delete_task(v_tasks[i], v_versions[i]);
        raise exception using errcode = 'P0001', message = 'probe.accepted';
      exception when others then
        v_accepted := sqlerrm = 'probe.accepted';
      end;
      if v_offered is distinct from v_accepted then
        v_disagreements := v_disagreements || format(
          '%s on %s: offered %s, accepted %s', c.label, v_tasks[i],
          v_offered, v_accepted);
      end if;
    end loop;

    set local role postgres;

    insert into caps_observed
    select c.label, o.task_id, o.can_manage
    from unnest(v_caps_tasks, v_caps_manage) as o (task_id, can_manage);
  end loop;

  insert into caps_disagreements select unnest(v_disagreements);
  perform set_config('request.jwt.claims', '', true);
end
$$;

select set_eq(
  $$ select * from caps_observed $$,
  $$ select * from caps_expected $$,
  'task_capabilities offers can_manage to the task''s approver in every column, and to no one else'
);

select is_empty(
  $$ select * from caps_disagreements $$,
  'can_manage agrees with what delete_task accepts'
);

select is(
  (select count(*) from public.tasks
   where id in (select task_id from caps_tasks) and deleted_at is not null),
  0::bigint,
  'every can_manage probe was rolled back'
);

-- Stale: b41's version is read, then the assignee moves it.

create temp table stale_version as
select updated_at as version from public.tasks
where id = '00000000-0000-4000-b000-000000000041';

select lives_ok(
  $$ select pg_temp.move_as('00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-b000-000000000041', 'doing') $$,
  'the assignee moves the stale task to Doing after its version was read'
);

select throws_ok(
  format(
    'select pg_temp.delete_as(%L, %L, %L)',
    '00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-b000-000000000041',
    (select version from stale_version)
  ),
  'P0001', 'tasks.stale',
  'delete_task with the version from before the move gets tasks.stale'
);

select throws_ok(
  $$ select pg_temp.delete_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-b000-000000000041', null) $$,
  'P0001', 'tasks.stale',
  'delete_task with no version gets tasks.stale'
);

select throws_ok(
  format(
    'select pg_temp.delete_as(%L, %L, %L)',
    '00000000-0000-4000-a000-000000000005',
    '00000000-0000-4000-b000-000000000041',
    (select version from stale_version)
  ),
  'P0001', 'tasks.not_approver',
  'someone who isn''t the approver gets tasks.not_approver, not tasks.stale'
);

select results_eq(
  $$ select t.deleted_at,
            (select count(*)::int from public.activity v
             where v.entity_id = t.id and v.action = 'deleted')
     from public.tasks t where t.id = '00000000-0000-4000-b000-000000000041' $$,
  $$ values (null::timestamptz, 0) $$,
  'a refused delete writes nothing'
);

select lives_ok(
  $$ select pg_temp.delete_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-b000-000000000041',
       (select updated_at from public.tasks
        where id = '00000000-0000-4000-b000-000000000041')) $$,
  'with the version after the move, the Head Layout Artist deletes it'
);

-- Missing tasks.

select throws_ok(
  $$ select pg_temp.delete_as('00000000-0000-4000-a000-000000000008',
       '00000000-0000-4000-9999-000000000000', now()) $$,
  'P0001', 'tasks.not_found',
  'delete_task on an unknown task gets tasks.not_found'
);

select throws_ok(
  $$ select pg_temp.delete_as('00000000-0000-4000-a000-000000000001',
       '00000000-0000-4000-9999-000000000000', now()) $$,
  'P0001', 'auth.not_active',
  'a pending caller gets auth.not_active before tasks.not_found'
);

-- Before b01 and b02 are deleted: what each helper answers for the caller it
-- passes, the open slots, and the capabilities.

create temp table helper_probes (
  label text primary key,
  caller uuid not null,
  probe text not null
);

insert into helper_probes values
  ('is_task_approver on b01', '00000000-0000-4000-a000-000000000004',
   $q$ select private.is_task_approver('00000000-0000-4000-b000-000000000001') $q$),
  ('can_review_task on b01', '00000000-0000-4000-a000-000000000004',
   $q$ select private.can_review_task('00000000-0000-4000-b000-000000000001') $q$),
  ('can_move_task to To Do on b01', '00000000-0000-4000-a000-000000000002',
   $q$ select private.can_move_task('00000000-0000-4000-b000-000000000001', 'to_do') $q$),
  ('can_move_task to Doing on b01', '00000000-0000-4000-a000-000000000002',
   $q$ select private.can_move_task('00000000-0000-4000-b000-000000000001', 'doing') $q$),
  ('can_respond_to_slot on c12', '00000000-0000-4000-a000-000000000002',
   $q$ select private.can_respond_to_slot('00000000-0000-4000-c000-000000000012') $q$),
  ('can_hand_back_slot on c11', '00000000-0000-4000-a000-000000000002',
   $q$ select private.can_hand_back_slot('00000000-0000-4000-c000-000000000011') $q$),
  ('is_task_approver on b02', '00000000-0000-4000-a000-000000000008',
   $q$ select private.is_task_approver('00000000-0000-4000-b000-000000000002') $q$),
  ('can_reopen_task on b02', '00000000-0000-4000-a000-000000000004',
   $q$ select private.can_reopen_task('00000000-0000-4000-b000-000000000002') $q$);

create temp table helper_answers (
  label text primary key,
  before boolean,
  after boolean
);

insert into helper_answers (label, before)
select h.label, pg_temp.query_as(h.caller, h.probe)::boolean
from helper_probes h;

select is_empty(
  $$ select label from helper_answers where before is distinct from true $$,
  'before the delete, every helper probe passes for its caller'
);

create temp table open_before as
select 'my_open_slots' as source, x.id
from unnest(pg_temp.query_as(
  '00000000-0000-4000-a000-000000000002',
  $q$ select array_agg(id)::text from public.my_open_slots()
      where id::text like '00000000-0000-4000-c000-%' $q$
)::uuid[]) as x (id)
union all
select 'open_slots', a.id from private.open_slots('00000000-0000-4000-a000-000000000002') a
where a.id::text like '00000000-0000-4000-c000-%';

select set_eq(
  $$ select * from open_before $$,
  $$ values ('my_open_slots', '00000000-0000-4000-c000-000000000011'::uuid),
            ('my_open_slots', '00000000-0000-4000-c000-000000000012'::uuid),
            ('my_open_slots', '00000000-0000-4000-c000-000000000031'::uuid),
            ('open_slots', '00000000-0000-4000-c000-000000000011'::uuid),
            ('open_slots', '00000000-0000-4000-c000-000000000012'::uuid),
            ('open_slots', '00000000-0000-4000-c000-000000000031'::uuid) $$,
  'before the delete, b01''s On it and awaiting slots are open (b02 is Done), and b41''s (deleted above) no longer is'
);

-- The row as it stands, to compare once it's deleted.
create temp table rows_before as
select * from public.tasks
where id in ('00000000-0000-4000-b000-000000000001',
             '00000000-0000-4000-b000-000000000002');
create temp table slots_before as
select * from public.task_assignments
where task_id in ('00000000-0000-4000-b000-000000000001',
                  '00000000-0000-4000-b000-000000000002');
create temp table reasons_before as
select r.* from public.assignment_reasons r
join slots_before s on s.id = r.assignment_id;

select lives_ok(
  $$ select pg_temp.delete_as('00000000-0000-4000-a000-000000000004', id, updated_at)
     from rows_before $$,
  'the Head Layout Artist deletes b01 (For Review) and b02 (Done)'
);

-- The row afterwards.

select results_eq(
  $$ select t.id, t.deleted_at = now(), t.updated_at = now(),
            (to_jsonb(t) - 'deleted_at' - 'updated_at')
              = (select to_jsonb(b) - 'deleted_at' - 'updated_at'
                 from rows_before b where b.id = t.id)
     from public.tasks t
     where t.id in (select id from rows_before)
     order by t.id $$,
  $$ values ('00000000-0000-4000-b000-000000000001'::uuid, true, true, true),
            ('00000000-0000-4000-b000-000000000002'::uuid, true, true, true) $$,
  'each deleted task keeps its row: deleted_at and updated_at are now(), and its column, done_at, revision note and every other field are unchanged'
);

select set_eq(
  $$ select * from public.task_assignments
     where task_id in (select id from rows_before) $$,
  $$ select * from slots_before $$,
  'their slots are stored unchanged'
);

select set_eq(
  $$ select r.* from public.assignment_reasons r
     join slots_before s on s.id = r.assignment_id $$,
  $$ select * from reasons_before $$,
  'and so are the slots'' reasons'
);

select bag_eq(
  $$ select v.entity_id, v.actor_id
     from public.activity v
     where v.entity_id in (select id from rows_before union all select id from slots_before)
       and v.action = 'deleted' $$,
  $$ values ('00000000-0000-4000-b000-000000000001'::uuid, '00000000-0000-4000-a000-000000000004'::uuid),
            ('00000000-0000-4000-b000-000000000002'::uuid, '00000000-0000-4000-a000-000000000004'::uuid) $$,
  'each delete logs one deleted activity row, for the task only'
);

-- Every command on a deleted task gets tasks.not_found, from the caller it
-- would otherwise answer.

create temp table commands_observed (task text, command text, result text);

do $$
declare
  v_assignee constant uuid := '00000000-0000-4000-a000-000000000002';
  v_approver constant uuid := '00000000-0000-4000-a000-000000000004';
  v_labels constant text[] := array['b01', 'b02'];
  v_tasks constant uuid[] := array[
    '00000000-0000-4000-b000-000000000001',
    '00000000-0000-4000-b000-000000000002'
  ]::uuid[];
  v_on_it constant uuid[] := array[
    '00000000-0000-4000-c000-000000000011',
    '00000000-0000-4000-c000-000000000021'
  ]::uuid[];
  v_awaiting constant uuid[] := array[
    '00000000-0000-4000-c000-000000000012',
    '00000000-0000-4000-c000-000000000022'
  ]::uuid[];
  v_commands constant text[] := array[
    'move_task', 'respond_to_slot', 'hand_back_slot',
    'mark_done', 'send_back_task', 'reopen_task', 'delete_task'
  ];
  v_versions timestamptz[];
  v_obs_tasks text[] := '{}';
  v_obs_commands text[] := '{}';
  v_obs_results text[] := '{}';
  v_command text;
begin
  select array_agg(t.updated_at order by t.id) into v_versions
  from public.tasks t where t.id = any (v_tasks);

  for i in 1 .. array_length(v_tasks, 1) loop
    foreach v_command in array v_commands loop
      perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
          'sub',
          case when v_command in ('move_task', 'respond_to_slot', 'hand_back_slot')
            then v_assignee else v_approver end,
          'role', 'authenticated'
        )::text,
        true
      );
      set local role authenticated;
      begin
        case v_command
          when 'move_task' then
            perform public.move_task(v_tasks[i], 'to_do');
          when 'respond_to_slot' then
            perform public.respond_to_slot(v_awaiting[i], 'on_it');
          when 'hand_back_slot' then
            perform public.hand_back_slot(v_on_it[i], 'Busy');
          when 'mark_done' then
            perform public.mark_done(v_tasks[i]);
          when 'send_back_task' then
            perform public.send_back_task(v_tasks[i], 'Probe note');
          when 'reopen_task' then
            perform public.reopen_task(v_tasks[i]);
          when 'delete_task' then
            perform public.delete_task(v_tasks[i], v_versions[i]);
        end case;
        raise exception using errcode = 'P0001', message = 'probe.accepted';
      exception when others then
        v_obs_tasks := v_obs_tasks || v_labels[i];
        v_obs_commands := v_obs_commands || v_command;
        v_obs_results := v_obs_results || case
          when sqlerrm = 'probe.accepted' then 'ok'
          else sqlstate || ' ' || sqlerrm
        end;
      end;
      set local role postgres;
    end loop;
  end loop;

  insert into commands_observed
  select * from unnest(v_obs_tasks, v_obs_commands, v_obs_results);
  perform set_config('request.jwt.claims', '', true);
end
$$;

select set_eq(
  $$ select * from commands_observed $$,
  $$ select k.task, c.command, 'P0001 tasks.not_found'
     from (values ('b01'), ('b02')) as k (task)
     cross join (values ('move_task'), ('respond_to_slot'), ('hand_back_slot'),
                        ('mark_done'), ('send_back_task'), ('reopen_task'),
                        ('delete_task')) as c (command) $$,
  'every command on either deleted task (a second delete included) gets tasks.not_found'
);

-- Every helper now answers false for the caller it passed before.

update helper_answers a
set after = pg_temp.query_as(h.caller, h.probe)::boolean
from helper_probes h
where h.label = a.label;

select is_empty(
  $$ select label from helper_answers where after is distinct from false $$,
  'after the delete, every helper answers false for the caller it passed before'
);

select set_eq(
  $$ select 'my_open_slots' as source, x.id
     from unnest(pg_temp.query_as(
       '00000000-0000-4000-a000-000000000002',
       $q$ select array_agg(id)::text from public.my_open_slots()
           where id::text like '00000000-0000-4000-c000-%' $q$
     )::uuid[]) as x (id)
     union all
     select 'open_slots', a.id
     from private.open_slots('00000000-0000-4000-a000-000000000002') a
     where a.id::text like '00000000-0000-4000-c000-%' $$,
  $$ values ('my_open_slots', '00000000-0000-4000-c000-000000000031'::uuid),
            ('open_slots', '00000000-0000-4000-c000-000000000031'::uuid) $$,
  'my_open_slots and open_slots (read as postgres too, past RLS) list no deleted task''s slots, and still list the live one'
);

select is(
  pg_temp.query_as(
    '00000000-0000-4000-a000-000000000004',
    $q$ select array_agg(task_id order by task_id)::text
        from public.task_capabilities(array[
          '00000000-0000-4000-b000-000000000001',
          '00000000-0000-4000-b000-000000000002',
          '00000000-0000-4000-b000-000000000031']::uuid[]) $q$
  ),
  '{00000000-0000-4000-b000-000000000031}',
  'task_capabilities returns no row for a deleted task, only the live one'
);

-- Reads: nothing of a deleted task, while the live control stays readable.

create temp table reads_observed (
  caller text,
  deleted_tasks int,
  deleted_slots int,
  deleted_reasons int,
  deleted_activity int,
  live_tasks int,
  live_slots int,
  live_reasons int,
  live_activity int
);

do $$
declare
  v_labels constant text[] := array['assignee', 'approver', 'Editor-in-Chief'];
  v_callers constant uuid[] := array[
    '00000000-0000-4000-a000-000000000002',
    '00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-a000-000000000008'
  ]::uuid[];
  v_deleted constant uuid[] := array[
    '00000000-0000-4000-b000-000000000001',
    '00000000-0000-4000-b000-000000000002'
  ]::uuid[];
  v_deleted_slots uuid[];
  v_live constant uuid := '00000000-0000-4000-b000-000000000031';
  v_live_slots constant uuid[] := array[
    '00000000-0000-4000-c000-000000000031',
    '00000000-0000-4000-c000-000000000032'
  ]::uuid[];
  r reads_observed;
begin
  select array_agg(id) into v_deleted_slots from slots_before;

  for i in 1 .. array_length(v_callers, 1) loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_callers[i], 'role', 'authenticated')::text,
      true
    );
    set local role authenticated;
    r.caller := v_labels[i];
    r.deleted_tasks := (select count(*) from public.tasks where id = any (v_deleted));
    r.deleted_slots := (select count(*) from public.task_assignments
                        where task_id = any (v_deleted) or id = any (v_deleted_slots));
    r.deleted_reasons := (select count(*) from public.assignment_reasons
                          where assignment_id = any (v_deleted_slots));
    r.deleted_activity := (select count(*) from public.activity
                           where entity_id = any (v_deleted || v_deleted_slots));
    r.live_tasks := (select count(*) from public.tasks where id = v_live);
    r.live_slots := (select count(*) from public.task_assignments where task_id = v_live);
    r.live_reasons := (select count(*) from public.assignment_reasons
                       where assignment_id = any (v_live_slots));
    r.live_activity := (select count(*) from public.activity
                        where entity_id = any (v_live || v_live_slots));
    set local role postgres;
    insert into reads_observed select r.*;
  end loop;

  perform set_config('request.jwt.claims', '', true);
end
$$;

select set_eq(
  $$ select * from reads_observed $$,
  $$ values ('assignee', 0, 0, 0, 0, 1, 2, 1, 2),
            ('approver', 0, 0, 0, 0, 1, 2, 1, 2),
            ('Editor-in-Chief', 0, 0, 0, 0, 1, 2, 1, 2) $$,
  'the assignee, the approver and the Editor-in-Chief read none of a deleted task''s row, slots, reasons (the reason policy''s slot subquery and is_task_approver both refuse it) or activity, and all of the live task'
);

select results_eq(
  $$ select (select count(*)::int from public.tasks where id in (select id from rows_before)),
            (select count(*)::int from public.task_assignments where id in (select id from slots_before)),
            (select count(*)::int from public.assignment_reasons where assignment_id in (select id from slots_before)),
            (select count(*)::int from public.activity
             where entity_id in (select id from rows_before union all select id from slots_before)) $$,
  $$ values (2, 6, 2, 8) $$,
  'nothing was removed: the deleted tasks, their slots, reasons and activity are all still stored'
);

select * from finish();

rollback;
