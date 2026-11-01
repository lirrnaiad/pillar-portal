-- Task edits (Story 3.7, AD-1, AD-4, AD-16, AD-21): update_task, the
-- reassign helper it shares with Story 3.3's reassign_slot, and the
-- deferrable slot-uniqueness constraint. Covers update_task along the
-- approver matrix (a fresh task per caller and owner, so every allowed edit
-- really happens), a text edit (fields saved; owner, column, done_at,
-- revision note and slots untouched; an inactive unchanged member kept), a
-- reassign (the old reason gone and unreadable), an add and a remove, a swap
-- between same-role slots, a concurrent removal (stale), a slot added before
-- the save (removed), a Done task (text-only: any slot change is
-- tasks.not_allowed), a save that changes nothing (no write, no activity),
-- every refusal, deleted and unknown tasks, the activity rows and their
-- shared op_id, the return value, the helper on a missing slot, and the
-- pins (definer, owner, search_path, the lock order and the stale guard on a
-- slot added between the two locks, the helper's shape, the constraint's
-- mode).
--
-- Fixtures follow delete.test.sql: auth users, tasks and slots are created
-- here (tasks and slots inserted directly as `postgres`, so a test can start
-- from any column and state), so the test doesn't depend on seed.sql;
-- everything is rolled back. It runs locally and on staging
-- (`supabase test db --linked`), seeded or not.

begin;

-- See responses_and_moves.test.sql: run as `postgres` with `extensions` on the
-- path, whichever role `supabase test db --linked` connected as.
set local role postgres;
set local search_path = "$user", public, extensions;

select plan(68);

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

-- Every fixture task was last changed on Oct 1, so an edit gives it a new
-- version (now() is the transaction's start). A Done task carries done_at
-- (tasks_done_at_matches_column).
create function pg_temp.new_task(
  p_id uuid,
  p_section text,
  p_desk text,
  p_column public.task_column
)
returns void
language sql as $$
  insert into public.tasks (
    id, title, description, owning_section_id, owning_desk_id, due_at,
    reference_url, "column", done_at, created_by, created_at, updated_at
  )
  values (p_id, 'Fixture task ' || p_id, 'Fixture description', p_section,
          p_desk, '2026-11-01T00:00:00+08', 'https://example.com/fixture',
          p_column,
          case when p_column = 'done' then '2026-10-02T09:00:00+08'::timestamptz end,
          '00000000-0000-4000-a000-000000000004',
          '2026-10-01T00:00:00+08', '2026-10-01T00:00:00+08')
$$;

-- Slots of one task list in the order they're inserted here
-- (created_at defaults to clock_timestamp()).
create function pg_temp.new_slot(
  p_id uuid,
  p_task uuid,
  p_member uuid,
  p_role public.production_role,
  p_state public.slot_state
)
returns void
language sql as $$
  insert into public.task_assignments (id, task_id, member_id, role, state,
                                       updated_at)
  values (p_id, p_task, p_member, p_role, p_state, '2026-10-01T00:00:00+08')
$$;

create function pg_temp.new_activity(p_type text, p_id uuid, p_action text)
returns void
language sql as $$
  insert into public.activity (op_id, entity_type, entity_id, actor_id, action)
  values (gen_random_uuid(), p_type, p_id,
          '00000000-0000-4000-a000-000000000004', p_action)
$$;

-- One element of update_task's `slots`: no `id` key for a new row.
create function pg_temp.slot(p_id uuid, p_role text, p_member uuid)
returns jsonb
language sql as $$
  select case
    when p_id is null then jsonb_build_object('role', p_role, 'member_id', p_member)
    else jsonb_build_object('id', p_id, 'role', p_role, 'member_id', p_member)
  end
$$;

-- A task's slots exactly as the edit form loads them, in creation order.
create function pg_temp.loaded_slots(p_task uuid)
returns jsonb
language sql as $$
  select coalesce(
    jsonb_agg(pg_temp.slot(a.id, a.role::text, a.member_id)
              order by a.created_at, a.id),
    '[]'::jsonb
  )
  from public.task_assignments a
  where a.task_id = p_task
$$;

-- Clear any seeded Editor-in-Chief (member_positions_one_editor_in_chief) so
-- the fixture one below can hold the position; rolled back with the rest.
delete from public.member_positions where position = 'editor_in_chief';

-- Callers, as in delete.test.sql, plus a second staff writer (a12) and a
-- deactivated staff photojournalist (a13). Each holds one primary position.
select pg_temp.new_member('00000000-0000-4000-a000-000000000001', 'ed-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-000000000002', 'ed-assignee@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000003', 'ed-staff@example.com', 'staff_writer');
select pg_temp.new_member('00000000-0000-4000-a000-000000000004', 'ed-head-layout@example.com', 'head_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000005', 'ed-head-cartoonist@example.com', 'head_cartoonist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000006', 'ed-news-editor@example.com', 'news_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000007', 'ed-sports-editor@example.com', 'sports_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000008', 'ed-eic@example.com', 'editor_in_chief');
select pg_temp.new_member('00000000-0000-4000-a000-000000000009', 'ed-associate@example.com', 'associate_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000010', 'ed-managing@example.com', 'managing_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000011', 'ed-finance@example.com', 'finance_manager');
select pg_temp.new_member('00000000-0000-4000-a000-000000000012', 'ed-staff-2@example.com', 'staff_writer');
select pg_temp.new_member('00000000-0000-4000-a000-000000000013', 'ed-deactivated@example.com', 'staff_photojournalist');
update public.members set deactivated_at = now()
where id = '00000000-0000-4000-a000-000000000013';

-- b01, the text edit: Layout, Doing, sent back (a revision note stands),
-- with the assignee's On it slot c11, their handed-back slot c12 (with a
-- reason), and the deactivated member's On it slot c13.
select pg_temp.new_task('00000000-0000-4000-b000-000000000001', null, 'layout', 'doing');
update public.tasks
set revision_note = 'Fix the captions',
    revision_note_by = '00000000-0000-4000-a000-000000000004',
    revision_note_at = '2026-10-01T00:00:00+08'
where id = '00000000-0000-4000-b000-000000000001';
select pg_temp.new_slot('00000000-0000-4000-c000-000000000011', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000012', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'cartoonist', 'needs_reassignment');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000013', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000013', 'photojournalist', 'on_it');
insert into public.assignment_reasons (assignment_id, reason)
values ('00000000-0000-4000-c000-000000000012', 'Exams all week');

-- b02: Layout, Done, the assignee's On it slot c21 and awaiting slot c22.
select pg_temp.new_task('00000000-0000-4000-b000-000000000002', null, 'layout', 'done');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000021', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000022', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'cartoonist', 'awaiting_response');

-- b03, the reassign: Layout, To Do, the assignee's On it slot c31 (with a
-- stray reason row), the Head Cartoonist's handed-back slot c32 (with a
-- reason) and the staff writer's awaiting slot c33.
select pg_temp.new_task('00000000-0000-4000-b000-000000000003', null, 'layout', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000031', '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000032', '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000005', 'cartoonist', 'needs_reassignment');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000033', '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000003', 'writer', 'awaiting_response');
insert into public.assignment_reasons (assignment_id, reason)
values ('00000000-0000-4000-c000-000000000031', 'Old reason'),
       ('00000000-0000-4000-c000-000000000032', 'Out sick');

-- b04, the add and remove: Layout, To Do, the assignee's On it slot c41 and
-- handed-back slot c42 (with a reason and activity).
select pg_temp.new_task('00000000-0000-4000-b000-000000000004', null, 'layout', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000041', '00000000-0000-4000-b000-000000000004', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000042', '00000000-0000-4000-b000-000000000004', '00000000-0000-4000-a000-000000000002', 'cartoonist', 'needs_reassignment');
insert into public.assignment_reasons (assignment_id, reason)
values ('00000000-0000-4000-c000-000000000042', 'Exams all week');
select pg_temp.new_activity('task_assignment', '00000000-0000-4000-c000-000000000042', 'slot_needs_reassignment');

-- b05, the swap: News, Doing, two Writer slots: c51 (staff writer, On it)
-- and c52 (the second staff writer, awaiting).
select pg_temp.new_task('00000000-0000-4000-b000-000000000005', 'news', null, 'doing');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000051', '00000000-0000-4000-b000-000000000005', '00000000-0000-4000-a000-000000000003', 'writer', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000052', '00000000-0000-4000-b000-000000000005', '00000000-0000-4000-a000-000000000012', 'writer', 'awaiting_response');

-- b06, two approvers at once: Layout, To Do, the assignee's slots c61 and
-- c62.
select pg_temp.new_task('00000000-0000-4000-b000-000000000006', null, 'layout', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000061', '00000000-0000-4000-b000-000000000006', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000062', '00000000-0000-4000-b000-000000000006', '00000000-0000-4000-a000-000000000002', 'cartoonist', 'awaiting_response');

-- b07, deleted: Layout, its slot c71.
select pg_temp.new_task('00000000-0000-4000-b000-000000000007', null, 'layout', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000071', '00000000-0000-4000-b000-000000000007', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
update public.tasks set deleted_at = '2026-10-02T00:00:00+08'
where id = '00000000-0000-4000-b000-000000000007';

-- b08, for the helper on its own: the assignee's handed-back slot c81 (with
-- a reason).
select pg_temp.new_task('00000000-0000-4000-b000-000000000008', null, 'layout', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000081', '00000000-0000-4000-b000-000000000008', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'needs_reassignment');
insert into public.assignment_reasons (assignment_id, reason)
values ('00000000-0000-4000-c000-000000000081', 'Busy');

-- b09, saves that change nothing and then only a slot: Layout, To Do, the
-- assignee's On it slot c91.
select pg_temp.new_task('00000000-0000-4000-b000-000000000009', null, 'layout', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000091', '00000000-0000-4000-b000-000000000009', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');

-- Run update_task, or a query returning one value, as the given caller (via
-- the request.jwt.claims GUC, as RLS and private.current_member_id() read
-- it). On success, the role is reset to postgres before returning. On a
-- raised exception, pgTAP's throws_ok() rolls back its own savepoint, which
-- undoes the SET LOCAL made here. Arguments are evaluated before the call,
-- still as postgres, so pg_temp.loaded_slots() reads every slot.
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

create function pg_temp.update_as(
  p_caller uuid,
  p_task uuid,
  p_title text,
  p_description text,
  p_due_at timestamptz,
  p_reference_url text,
  p_slots jsonb
)
returns boolean
language plpgsql as $$
declare
  v_result boolean;
begin
  perform pg_temp.as_caller(p_caller);
  v_result := public.update_task(p_task, p_title, p_description, p_due_at,
                                 p_reference_url, p_slots);
  set local role postgres;
  return v_result;
end;
$$;

-- An edit that only cares about the title and the slots.
create function pg_temp.edit_as(
  p_caller uuid,
  p_task uuid,
  p_title text,
  p_slots jsonb
)
returns boolean
language sql as $$
  select pg_temp.update_as(p_caller, p_task, p_title, 'Edited description',
                           '2026-11-05T17:00:00+08', 'https://example.com/edited',
                           p_slots)
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

-- The rows one edit logged: that task's `updated` row and every row sharing
-- its op_id.
create function pg_temp.edit_activity(p_task uuid)
returns table (op_count bigint, entity_type text, entity_id uuid, actor_id uuid, action text)
language sql as $$
  select count(*) over (partition by true),
         v.entity_type, v.entity_id, v.actor_id, v.action
  from public.activity v
  where v.op_id in (
    select u.op_id from public.activity u
    where u.entity_type = 'task' and u.entity_id = p_task and u.action = 'updated'
  )
$$;

-- Pins.

select is_definer('public', 'update_task',
  array['uuid', 'text', 'text', 'timestamp with time zone', 'text', 'jsonb'],
  'public.update_task(...) is security definer');
select function_owner_is('public', 'update_task',
  array['uuid', 'text', 'text', 'timestamp with time zone', 'text', 'jsonb'], 'postgres',
  'public.update_task(...) is owned by postgres');
select function_returns('public', 'update_task',
  array['uuid', 'text', 'text', 'timestamp with time zone', 'text', 'jsonb'], 'boolean',
  'public.update_task(...) returns boolean');
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'public.update_task(uuid, text, text, timestamptz, text, jsonb)'::regprocedure),
  array['search_path=""'],
  'public.update_task(...) sets search_path = '''''
);

-- Slots before their task: the first lock is every slot of the task, in id
-- order, keeping the ids it locked; the second the live task; there is no
-- other.
create temp table update_task_def as
select pg_get_functiondef(
  'public.update_task(uuid, text, text, timestamptz, text, jsonb)'::regprocedure
) as def;

select ok(
  (select def from update_task_def)
    ~* 'select\s+coalesce\(array_agg\(l\.id\),\s*''\{\}''\)\s+into\s+v_locked_slots\s+from\s*\(\s*select\s+a\.id\s+from\s+public\.task_assignments\s+a\s+where\s+a\.task_id\s*=\s*update_task\.task_id\s+order\s+by\s+a\.id\s+for\s+update\s*\)\s*as\s+l\s*;\s*select\s+t\.\*\s+into\s+v_task\s+from\s+public\.tasks\s+t\s+where\s+t\.id\s*=\s*update_task\.task_id\s+and\s+t\.deleted_at\s+is\s+null\s+for\s+update\s*;'
    and (select count(*) from regexp_matches(
           (select def from update_task_def), 'for\s+update', 'gi')) = 2,
  'public.update_task(...) locks every slot of the task (in id order, keeping their ids), then the live task, and nothing else'
);

-- A slot added between the two locks (by another update_task, while this
-- one waited for the task) can't be raced here, so the guard is pinned:
-- after the task lock, and before any write, a slot of the task that isn't
-- among the locked ids raises tasks.stale.
select ok(
  (select def from update_task_def)
    ~* 'from\s+public\.task_assignments\s+a\s+where\s+a\.task_id\s*=\s*v_task\.id\s+and\s+a\.id\s*<>\s*all\s*\(\s*v_locked_slots\s*\)\s*\)\s*then\s+raise\s+exception\s+using\s+errcode\s*=\s*''P0001'',\s*message\s*=\s*''tasks\.stale'''
    and (select strpos(def, 'from public.tasks t') < strpos(def, '<> all (v_locked_slots)')
            and strpos(def, '<> all (v_locked_slots)') < strpos(def, 'update public.tasks t')
            and strpos(def, '<> all (v_locked_slots)') < strpos(def, 'set constraints')
         from update_task_def),
  'public.update_task(...) takes the locked slot ids before the task lock and, after it and before any write, raises tasks.stale for a slot not among them'
);

select isnt_definer('private', 'reassign_slot_member',
  array['uuid', 'uuid', 'uuid', 'uuid'],
  'private.reassign_slot_member(...) is not security definer');
select function_owner_is('private', 'reassign_slot_member',
  array['uuid', 'uuid', 'uuid', 'uuid'], 'postgres',
  'private.reassign_slot_member(...) is owned by postgres');
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'private.reassign_slot_member(uuid, uuid, uuid, uuid)'::regprocedure),
  array['search_path=""'],
  'private.reassign_slot_member(...) sets search_path = '''''
);
select is_empty(
  $$ select x.grantee::regrole::text
     from pg_proc p
     cross join lateral aclexplode(p.proacl) as x
     where p.oid = 'private.reassign_slot_member(uuid, uuid, uuid, uuid)'::regprocedure
       and x.grantee <> p.proowner $$,
  'private.reassign_slot_member(...) is granted to no one'
);
select ok(
  pg_get_functiondef('private.reassign_slot_member(uuid, uuid, uuid, uuid)'::regprocedure)
    !~* 'for\s+update',
  'private.reassign_slot_member(...) locks nothing (its caller has)'
);

select results_eq(
  $$ select c.contype::text, c.condeferrable, c.condeferred,
            pg_get_constraintdef(c.oid)
     from pg_constraint c
     where c.conrelid = 'public.task_assignments'::regclass
       and c.conname = 'task_assignments_task_id_member_id_role_key' $$,
  $$ values ('u', true, false,
             'UNIQUE (task_id, member_id, role) DEFERRABLE') $$,
  'task_assignments_task_id_member_id_role_key is unique (task_id, member_id, role), deferrable and initially immediate'
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

-- A fresh task for every caller and owner, each with the assignee's Layout
-- Artist slot, so each allowed edit really happens. Each owner's tasks sit in
-- their own column, so the edits cover all four.
create temp table edit_tasks as
select c.label, c.member_id, a.owner, a.allowed,
       gen_random_uuid() as task_id,
       gen_random_uuid() as slot_id,
       (case a.owner
          when 'layout' then 'to_do'
          when 'news' then 'doing'
          when 'opinion' then 'for_review'
          else 'done'
        end)::public.task_column as col
from matrix_callers c
cross join lateral (
  values ('layout', c.layout), ('news', c.news),
         ('opinion', c.opinion), ('editorial', c.editorial)
) as a (owner, allowed);

do $$
begin
  perform pg_temp.new_task(e.task_id, o.section, o.desk, e.col)
  from edit_tasks e
  join matrix_owners o on o.owner = e.owner;
  perform pg_temp.new_slot(e.slot_id, e.task_id,
                           '00000000-0000-4000-a000-000000000002',
                           'layout_artist', 'on_it')
  from edit_tasks e;
end
$$;

-- Results are `ok` or `<sqlstate> <message>`.
create temp table edit_expected as
select e.label, e.owner,
       case
         when e.label = 'pending' then 'P0001 auth.not_active'
         when e.allowed then 'ok'
         else 'P0001 tasks.not_approver'
       end as result
from edit_tasks e;

create temp table edit_observed (like edit_expected);

do $$
declare
  v_rows edit_tasks[];
  e edit_tasks;
  v_slots jsonb[];
  v_labels text[] := '{}';
  v_owners text[] := '{}';
  v_results text[] := '{}';
  v_result text;
begin
  -- Read the fixtures while still `postgres`: `authenticated` can't read
  -- temp tables.
  select array_agg(x order by x.task_id),
         array_agg(pg_temp.loaded_slots(x.task_id) order by x.task_id)
    into v_rows, v_slots
  from edit_tasks x;

  for i in 1 .. array_length(v_rows, 1) loop
    e := v_rows[i];
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', e.member_id, 'role', 'authenticated')::text,
      true
    );
    set local role authenticated;
    begin
      perform public.update_task(e.task_id, 'Edited by ' || e.label, null,
                                 '2026-11-05T17:00:00+08', null, v_slots[i]);
      v_result := 'ok';
    exception when others then
      v_result := sqlstate || ' ' || sqlerrm;
    end;
    set local role postgres;
    v_labels := v_labels || e.label;
    v_owners := v_owners || e.owner;
    v_results := v_results || v_result;
  end loop;

  insert into edit_observed
  select * from unnest(v_labels, v_owners, v_results);
  perform set_config('request.jwt.claims', '', true);
end
$$;

select set_eq(
  $$ select * from edit_observed $$,
  $$ select * from edit_expected $$,
  'update_task accepts the owner''s head and the three top editors (top editors only on Opinion and Editorial) in every column, refuses everyone else with tasks.not_approver, and a pending caller with auth.not_active'
);

select is_empty(
  $$ select e.label, e.owner
     from edit_tasks e
     join public.tasks t on t.id = e.task_id
     where e.allowed is distinct from (t.title = 'Edited by ' || e.label) $$,
  'exactly the accepted edits saved the title'
);

select set_eq(
  $$ select v.entity_id, v.entity_type, v.actor_id, v.action
     from public.activity v
     where v.entity_id in (select task_id from edit_tasks
                           union all select slot_id from edit_tasks) $$,
  $$ select e.task_id, 'task'::text as entity_type, e.member_id,
            'updated'::text as action
     from edit_tasks e
     where e.allowed $$,
  'each accepted edit with the slots as loaded logs one updated row for its task, by its actor, and a refused one logs nothing'
);

-- A text edit: b01 by the Head Layout Artist, its slots as loaded (the
-- deactivated member's c13 included).

create temp table b01_before as
select * from public.tasks where id = '00000000-0000-4000-b000-000000000001';
create temp table b01_slots_before as
select * from public.task_assignments
where task_id = '00000000-0000-4000-b000-000000000001';
create temp table b01_reasons_before as
select r.* from public.assignment_reasons r
join b01_slots_before s on s.id = r.assignment_id;

select is(
  pg_temp.update_as(
    '00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-b000-000000000001',
    'Lay out the spread, v2', 'Two pages, the new grid.',
    '2026-11-05T17:00:00+08', 'https://example.com/v2',
    pg_temp.loaded_slots('00000000-0000-4000-b000-000000000001')
  ),
  false,
  'a text edit with the slots as loaded (an inactive member''s unchanged slot included) is accepted and returns false'
);

select results_eq(
  $$ select t.title, t.description, t.due_at, t.reference_url,
            t.updated_at = now(),
            (to_jsonb(t) - 'title' - 'description' - 'due_at'
               - 'reference_url' - 'updated_at')
              = (select to_jsonb(b) - 'title' - 'description' - 'due_at'
                   - 'reference_url' - 'updated_at' from b01_before b)
     from public.tasks t
     where t.id = '00000000-0000-4000-b000-000000000001' $$,
  $$ values ('Lay out the spread, v2'::text, 'Two pages, the new grid.'::text,
             '2026-11-05T17:00:00+08'::timestamptz, 'https://example.com/v2'::text,
             true, true) $$,
  'the title, description, due date and reference link are saved and updated_at is now(); the owner, column, done_at, revision note and every other field are untouched'
);

select set_eq(
  $$ select * from public.task_assignments
     where task_id = '00000000-0000-4000-b000-000000000001' $$,
  $$ select * from b01_slots_before $$,
  'every slot is untouched: member, role, state (On it, handed back) and updated_at, the deactivated member''s included'
);

select set_eq(
  $$ select r.* from public.assignment_reasons r
     join b01_slots_before s on s.id = r.assignment_id $$,
  $$ select * from b01_reasons_before $$,
  'and the handed-back slot keeps its reason'
);

select set_eq(
  $$ select op_count, entity_type, entity_id, actor_id, action
     from pg_temp.edit_activity('00000000-0000-4000-b000-000000000001') $$,
  $$ values (1::bigint, 'task'::text, '00000000-0000-4000-b000-000000000001'::uuid,
             '00000000-0000-4000-a000-000000000004'::uuid, 'updated'::text) $$,
  'a text edit logs one updated row for the task and nothing for its slots'
);

-- b02 (Done) by the Editor-in-Chief, clearing the description and the link.

select is(
  pg_temp.update_as(
    '00000000-0000-4000-a000-000000000008',
    '00000000-0000-4000-b000-000000000002',
    'Done task, renamed', null, '2026-11-06T09:00:00+08', null,
    pg_temp.loaded_slots('00000000-0000-4000-b000-000000000002')
  ),
  false,
  'a top editor edits a Done task''s text, its slots sent as stored'
);

select results_eq(
  $$ select t.title, t.description, t.reference_url, t."column"::text,
            t.done_at, t.owning_desk_id
     from public.tasks t
     where t.id = '00000000-0000-4000-b000-000000000002' $$,
  $$ values ('Done task, renamed'::text, null::text, null::text, 'done'::text,
             '2026-10-02T09:00:00+08'::timestamptz, 'layout'::text) $$,
  'a null description and link clear them; the Done task stays Done with its done_at and owner'
);

-- A Done task is text-only: any slot change is refused, after the stale
-- check, and writes nothing.

create temp table done_refusals (label text primary key, slots jsonb, code text);

insert into done_refusals values
  ('a slot removed',
   jsonb_build_array(
     pg_temp.slot('00000000-0000-4000-c000-000000000021', 'layout_artist', '00000000-0000-4000-a000-000000000002')),
   'tasks.not_allowed'),
  ('a slot reassigned',
   jsonb_build_array(
     pg_temp.slot('00000000-0000-4000-c000-000000000021', 'layout_artist', '00000000-0000-4000-a000-000000000012'),
     pg_temp.slot('00000000-0000-4000-c000-000000000022', 'cartoonist', '00000000-0000-4000-a000-000000000002')),
   'tasks.not_allowed'),
  ('a slot added',
   pg_temp.loaded_slots('00000000-0000-4000-b000-000000000002')
     || jsonb_build_array(pg_temp.slot(null, 'writer', '00000000-0000-4000-a000-000000000003')),
   'tasks.not_allowed'),
  ('a slot added for a deactivated member (not_allowed comes first)',
   pg_temp.loaded_slots('00000000-0000-4000-b000-000000000002')
     || jsonb_build_array(pg_temp.slot(null, 'writer', '00000000-0000-4000-a000-000000000013')),
   'tasks.not_allowed'),
  ('a slot that is gone (stale comes first)',
   jsonb_build_array(
     pg_temp.slot('00000000-0000-4000-c000-000000000021', 'layout_artist', '00000000-0000-4000-a000-000000000002'),
     pg_temp.slot('00000000-0000-4000-c000-0000000000ff', 'writer', '00000000-0000-4000-a000-000000000003')),
   'tasks.stale');

create temp table done_observed (label text, result text);

do $$
declare
  v_rows done_refusals[];
  r done_refusals;
  v_labels text[] := '{}';
  v_results text[] := '{}';
begin
  select array_agg(x) into v_rows from done_refusals x;

  foreach r in array v_rows loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', '00000000-0000-4000-a000-000000000004',
                         'role', 'authenticated')::text,
      true
    );
    set local role authenticated;
    begin
      perform public.update_task('00000000-0000-4000-b000-000000000002',
                                 'Done task, refused', null,
                                 '2026-11-06T09:00:00+08', null, r.slots);
      v_results := v_results || 'ok'::text;
    exception when others then
      v_results := v_results || (sqlstate || ' ' || sqlerrm);
    end;
    set local role postgres;
    v_labels := v_labels || r.label;
  end loop;

  insert into done_observed select * from unnest(v_labels, v_results);
  perform set_config('request.jwt.claims', '', true);
end
$$;

select set_eq(
  $$ select * from done_observed $$,
  $$ select label, 'P0001 ' || code from done_refusals $$,
  'on a Done task, a slot removed, reassigned or added gets tasks.not_allowed (a gone slot still gets tasks.stale first)'
);

select results_eq(
  $$ select t.title,
            (select array_agg(a.id::text || ':' || a.member_id::text || ':' || a.state::text
                              order by a.id)
             from public.task_assignments a where a.task_id = t.id)
     from public.tasks t
     where t.id = '00000000-0000-4000-b000-000000000002' $$,
  $$ values ('Done task, renamed'::text,
             array['00000000-0000-4000-c000-000000000021:00000000-0000-4000-a000-000000000002:on_it',
                   '00000000-0000-4000-c000-000000000022:00000000-0000-4000-a000-000000000002:awaiting_response']) $$,
  'a refused Done edit writes nothing: the title and every slot are as before'
);

-- A save that changes nothing writes nothing.

select is(
  pg_temp.update_as(
    '00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-b000-000000000009',
    'Fixture task 00000000-0000-4000-b000-000000000009', 'Fixture description',
    '2026-11-01T00:00:00+08', 'https://example.com/fixture',
    pg_temp.loaded_slots('00000000-0000-4000-b000-000000000009')
  ),
  false,
  'a save with every field and slot as stored returns false'
);

select results_eq(
  $$ select t.updated_at,
            (select a.updated_at from public.task_assignments a
             where a.id = '00000000-0000-4000-c000-000000000091'),
            (select count(*)::int from public.activity v
             where v.entity_id in ('00000000-0000-4000-b000-000000000009',
                                   '00000000-0000-4000-c000-000000000091'))
     from public.tasks t
     where t.id = '00000000-0000-4000-b000-000000000009' $$,
  $$ values ('2026-10-01T00:00:00+08'::timestamptz,
             '2026-10-01T00:00:00+08'::timestamptz, 0) $$,
  'and writes nothing: the task''s and the slot''s updated_at stay, and no activity is logged'
);

select is(
  pg_temp.update_as(
    '00000000-0000-4000-a000-000000000008',
    '00000000-0000-4000-b000-000000000002',
    'Done task, renamed', null, '2026-11-06T09:00:00+08', null,
    pg_temp.loaded_slots('00000000-0000-4000-b000-000000000002')
  ),
  false,
  'repeating b02''s edit, its null description and link included, returns false'
);

select is(
  (select count(*) from public.activity
   where entity_id = '00000000-0000-4000-b000-000000000002'
     and action = 'updated'),
  1::bigint,
  'and logs nothing: b02 still has the one updated row from its first edit'
);

-- A change to the slots alone still bumps updated_at and logs updated.

select is(
  pg_temp.update_as(
    '00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-b000-000000000009',
    'Fixture task 00000000-0000-4000-b000-000000000009', 'Fixture description',
    '2026-11-01T00:00:00+08', 'https://example.com/fixture',
    jsonb_build_array(
      pg_temp.slot('00000000-0000-4000-c000-000000000091', 'layout_artist', '00000000-0000-4000-a000-000000000012'))
  ),
  true,
  'reassigning a slot with every field as stored returns true'
);

select results_eq(
  $$ select t.updated_at = now(), t.title
     from public.tasks t
     where t.id = '00000000-0000-4000-b000-000000000009' $$,
  $$ values (true, 'Fixture task 00000000-0000-4000-b000-000000000009'::text) $$,
  'a slot-only change bumps the task''s updated_at'
);

select set_eq(
  $$ select op_count, entity_type, entity_id, actor_id, action
     from pg_temp.edit_activity('00000000-0000-4000-b000-000000000009') $$,
  $$ values (2::bigint, 'task'::text, '00000000-0000-4000-b000-000000000009'::uuid,
             '00000000-0000-4000-a000-000000000004'::uuid, 'updated'::text),
            (2::bigint, 'task_assignment'::text, '00000000-0000-4000-c000-000000000091'::uuid,
             '00000000-0000-4000-a000-000000000004'::uuid, 'slot_reassigned'::text) $$,
  'and logs updated with slot_reassigned, sharing one op_id'
);

-- A reassign: b03 by the Head Layout Artist. c31 (On it, with a stray reason)
-- goes to the second staff writer, c32 (handed back by the Head Cartoonist,
-- with a reason) to the assignee; c33 stays.

select is(
  pg_temp.query_as('00000000-0000-4000-a000-000000000005',
    $q$ select reason from public.assignment_reasons
        where assignment_id = '00000000-0000-4000-c000-000000000032' $q$),
  'Out sick',
  'before the reassign, the Head Cartoonist reads their own reason on c32'
);

select is(
  pg_temp.edit_as(
    '00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-b000-000000000003',
    'Reassigned task',
    jsonb_build_array(
      pg_temp.slot('00000000-0000-4000-c000-000000000031', 'layout_artist', '00000000-0000-4000-a000-000000000012'),
      pg_temp.slot('00000000-0000-4000-c000-000000000032', 'cartoonist', '00000000-0000-4000-a000-000000000002'),
      pg_temp.slot('00000000-0000-4000-c000-000000000033', 'writer', '00000000-0000-4000-a000-000000000003')
    )
  ),
  true,
  'reassigning two slots is accepted and returns true'
);

select results_eq(
  $$ select a.id, a.member_id, a.role::text, a.state::text, a.updated_at = now()
     from public.task_assignments a
     where a.task_id = '00000000-0000-4000-b000-000000000003'
     order by a.created_at, a.id $$,
  $$ values ('00000000-0000-4000-c000-000000000031'::uuid, '00000000-0000-4000-a000-000000000012'::uuid, 'layout_artist'::text, 'awaiting_response'::text, true),
            ('00000000-0000-4000-c000-000000000032'::uuid, '00000000-0000-4000-a000-000000000002'::uuid, 'cartoonist'::text, 'awaiting_response'::text, true),
            ('00000000-0000-4000-c000-000000000033'::uuid, '00000000-0000-4000-a000-000000000003'::uuid, 'writer'::text, 'awaiting_response'::text, false) $$,
  'each reassigned slot keeps its id and role, takes the new member and starts over awaiting their answer; the unchanged slot is untouched'
);

select is(
  (select count(*) from public.assignment_reasons
   where assignment_id in ('00000000-0000-4000-c000-000000000031',
                           '00000000-0000-4000-c000-000000000032')),
  0::bigint,
  'each reassigned slot''s reason row is gone'
);

select is(
  pg_temp.query_as('00000000-0000-4000-a000-000000000002',
    $q$ select count(*)::text from public.assignment_reasons
        where assignment_id = '00000000-0000-4000-c000-000000000032' $q$),
  '0',
  'the new assignee of c32 reads no old reason'
);

select set_eq(
  $$ select op_count, entity_type, entity_id, actor_id, action
     from pg_temp.edit_activity('00000000-0000-4000-b000-000000000003') $$,
  $$ values (3::bigint, 'task'::text, '00000000-0000-4000-b000-000000000003'::uuid,
             '00000000-0000-4000-a000-000000000004'::uuid, 'updated'::text),
            (3::bigint, 'task_assignment'::text, '00000000-0000-4000-c000-000000000031'::uuid,
             '00000000-0000-4000-a000-000000000004'::uuid, 'slot_reassigned'::text),
            (3::bigint, 'task_assignment'::text, '00000000-0000-4000-c000-000000000032'::uuid,
             '00000000-0000-4000-a000-000000000004'::uuid, 'slot_reassigned'::text) $$,
  'a reassign logs updated for the task and slot_reassigned for each reassigned slot, sharing one op_id'
);

-- An add and a remove: b04 by the Head Layout Artist keeps c41, leaves out
-- c42 and adds a Writer slot for the staff writer.

select is(
  pg_temp.edit_as(
    '00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-b000-000000000004',
    'Added and removed',
    jsonb_build_array(
      pg_temp.slot('00000000-0000-4000-c000-000000000041', 'layout_artist', '00000000-0000-4000-a000-000000000002'),
      pg_temp.slot(null, 'writer', '00000000-0000-4000-a000-000000000003')
    )
  ),
  true,
  'adding a slot and removing another is accepted and returns true'
);

select results_eq(
  $$ select a.id = '00000000-0000-4000-c000-000000000041', a.member_id,
            a.role::text, a.state::text
     from public.task_assignments a
     where a.task_id = '00000000-0000-4000-b000-000000000004'
     order by a.created_at, a.id $$,
  $$ values (true, '00000000-0000-4000-a000-000000000002'::uuid, 'layout_artist'::text, 'on_it'::text),
            (false, '00000000-0000-4000-a000-000000000003'::uuid, 'writer'::text, 'awaiting_response'::text) $$,
  'the kept slot stays On it, the left-out one is gone, and the new one lists last, awaiting its member''s answer'
);

select is(
  (select count(*) from public.assignment_reasons
   where assignment_id = '00000000-0000-4000-c000-000000000042'),
  0::bigint,
  'the removed slot''s reason went with it'
);

select set_eq(
  $$ select op_count, entity_type, entity_id, actor_id, action
     from pg_temp.edit_activity('00000000-0000-4000-b000-000000000004') $$,
  $$ select 3::bigint as op_count, 'task'::text as entity_type,
            '00000000-0000-4000-b000-000000000004'::uuid as entity_id,
            '00000000-0000-4000-a000-000000000004'::uuid as actor_id,
            'updated'::text as action
     union all
     select 3, 'task_assignment', '00000000-0000-4000-c000-000000000042',
            '00000000-0000-4000-a000-000000000004', 'slot_removed'
     union all
     select 3, 'task_assignment', a.id,
            '00000000-0000-4000-a000-000000000004', 'slot_added'
     from public.task_assignments a
     where a.task_id = '00000000-0000-4000-b000-000000000004'
       and a.role = 'writer' $$,
  'an add and a remove log updated, slot_removed for the removed slot and slot_added for the new one, sharing one op_id'
);

select results_eq(
  $$ select (select count(*)::int from public.activity
             where entity_id = '00000000-0000-4000-c000-000000000042'),
            pg_temp.query_as('00000000-0000-4000-a000-000000000004',
              $q$ select count(*)::text from public.activity
                  where entity_id = '00000000-0000-4000-c000-000000000042' $q$) $$,
  $$ values (2, '0') $$,
  'the removed slot''s activity is stored but no longer readable, even by the approver (AD-16)'
);

-- A swap: b05 (News) by the News Editor; its two Writer slots trade members.

select is(
  pg_temp.edit_as(
    '00000000-0000-4000-a000-000000000006',
    '00000000-0000-4000-b000-000000000005',
    'Swapped writers',
    jsonb_build_array(
      pg_temp.slot('00000000-0000-4000-c000-000000000051', 'writer', '00000000-0000-4000-a000-000000000012'),
      pg_temp.slot('00000000-0000-4000-c000-000000000052', 'writer', '00000000-0000-4000-a000-000000000003')
    )
  ),
  true,
  'two Writer slots trading members is accepted, with no unique-constraint error, and returns true'
);

select results_eq(
  $$ select a.id, a.member_id, a.state::text
     from public.task_assignments a
     where a.task_id = '00000000-0000-4000-b000-000000000005'
     order by a.created_at, a.id $$,
  $$ values ('00000000-0000-4000-c000-000000000051'::uuid, '00000000-0000-4000-a000-000000000012'::uuid, 'awaiting_response'::text),
            ('00000000-0000-4000-c000-000000000052'::uuid, '00000000-0000-4000-a000-000000000003'::uuid, 'awaiting_response'::text) $$,
  'both swapped slots are reassigned and await their new member'
);

-- After the swap, the constraint is immediate again for everyone else.

select throws_ok(
  $$ insert into public.task_assignments (task_id, member_id, role)
     values ('00000000-0000-4000-b000-000000000005',
             '00000000-0000-4000-a000-000000000003', 'writer') $$,
  '23505', null,
  'after update_task, a duplicate (task, member, role) still raises 23505 at once'
);

select throws_ok(
  format(
    $f$ select pg_temp.query_as(%L,
          $q$ select public.create_task('Duplicate pair', null, null, 'layout',
                '2026-11-05T17:00:00+08', null,
                %s::jsonb)::text $q$) $f$,
    '00000000-0000-4000-a000-000000000004',
    quote_literal(jsonb_build_array(
      pg_temp.slot(null, 'writer', '00000000-0000-4000-a000-000000000003'),
      pg_temp.slot(null, 'writer', '00000000-0000-4000-a000-000000000003')
    )::text)
  ),
  '23505', null,
  'create_task with a repeated pair still raises 23505 at once'
);

-- Two approvers at once on b06. The Head Layout Artist removes c62; the
-- Editor-in-Chief's form still holds it.

create temp table b06_form as
select pg_temp.loaded_slots('00000000-0000-4000-b000-000000000006') as slots;

select is(
  pg_temp.edit_as(
    '00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-b000-000000000006',
    'First approver''s title',
    jsonb_build_array(
      pg_temp.slot('00000000-0000-4000-c000-000000000061', 'layout_artist', '00000000-0000-4000-a000-000000000002')
    )
  ),
  false,
  'removing a slot and changing no member returns false'
);

select throws_ok(
  format(
    'select pg_temp.edit_as(%L, %L, %L, %L::jsonb)',
    '00000000-0000-4000-a000-000000000008',
    '00000000-0000-4000-b000-000000000006',
    'Second approver''s title',
    (select slots from b06_form)
  ),
  'P0001', 'tasks.stale',
  'a form still holding the slot another approver removed gets tasks.stale'
);

select is(
  (select title from public.tasks where id = '00000000-0000-4000-b000-000000000006'),
  'First approver''s title',
  'the refused edit wrote nothing'
);

-- Another approver adds c63 after this form loaded but before this save
-- starts, so the save's slot lock takes it with the rest; the form doesn't
-- hold it, so the save removes it (the slot list is last-write-wins too). A
-- slot added while a save waits for the task gets tasks.stale instead (the
-- guard pinned above).
select pg_temp.new_slot('00000000-0000-4000-c000-000000000063', '00000000-0000-4000-b000-000000000006', '00000000-0000-4000-a000-000000000003', 'writer', 'awaiting_response');

select is(
  pg_temp.edit_as(
    '00000000-0000-4000-a000-000000000008',
    '00000000-0000-4000-b000-000000000006',
    'Second approver''s title',
    jsonb_build_array(
      pg_temp.slot('00000000-0000-4000-c000-000000000061', 'layout_artist', '00000000-0000-4000-a000-000000000002')
    )
  ),
  false,
  'a form that doesn''t hold a slot added before the save started is accepted'
);

select results_eq(
  $$ select array_agg(a.id order by a.id)
     from public.task_assignments a
     where a.task_id = '00000000-0000-4000-b000-000000000006' $$,
  $$ values (array['00000000-0000-4000-c000-000000000061']::uuid[]) $$,
  'and the slot added since is removed'
);

-- Refusals, on b01 as the Head Layout Artist. b01's slots as loaded:
-- c11 (Layout Artist, the assignee), c12 (Cartoonist, the assignee), c13
-- (Photojournalist, the deactivated member).

create temp table refusals (
  label text primary key,
  slots jsonb,
  code text not null
);

insert into refusals
select r.label, r.slots, r.code
from (select pg_temp.loaded_slots('00000000-0000-4000-b000-000000000001') as loaded) l
cross join lateral (values
  ('a JSON null', 'null'::jsonb, 'tasks.no_slots'),
  ('no list at all', null, 'tasks.no_slots'),
  ('an empty list', '[]'::jsonb, 'tasks.no_slots'),
  ('an object, not a list', jsonb_build_object('role', 'writer'), 'tasks.no_slots'),
  ('a string, not a list', to_jsonb('c11'::text), 'tasks.no_slots'),
  ('an id listed twice',
   l.loaded || jsonb_build_array(l.loaded -> 0), 'tasks.stale'),
  ('an id with another role',
   jsonb_set(l.loaded, '{0,role}', to_jsonb('writer'::text)), 'tasks.stale'),
  ('another task''s slot id',
   l.loaded || jsonb_build_array(pg_temp.slot('00000000-0000-4000-c000-000000000061', 'layout_artist', '00000000-0000-4000-a000-000000000002')),
   'tasks.stale'),
  ('an unknown slot id',
   l.loaded || jsonb_build_array(pg_temp.slot('00000000-0000-4000-c000-0000000000ff', 'writer', '00000000-0000-4000-a000-000000000003')),
   'tasks.stale'),
  ('a slot changed to a deactivated member',
   jsonb_set(l.loaded, '{0,member_id}', to_jsonb('00000000-0000-4000-a000-000000000013'::text)),
   'tasks.invalid_slot_member'),
  ('a new slot for a deactivated member',
   l.loaded || jsonb_build_array(pg_temp.slot(null, 'writer', '00000000-0000-4000-a000-000000000013')),
   'tasks.invalid_slot_member'),
  ('a new slot for a pending member',
   l.loaded || jsonb_build_array(pg_temp.slot(null, 'writer', '00000000-0000-4000-a000-000000000001')),
   'tasks.invalid_slot_member'),
  ('a new slot for an unknown member',
   l.loaded || jsonb_build_array(pg_temp.slot(null, 'writer', '00000000-0000-4000-a000-0000000000ff')),
   'tasks.invalid_slot_member'),
  ('a new slot repeating a kept one''s pair',
   l.loaded || jsonb_build_array(pg_temp.slot(null, 'layout_artist', '00000000-0000-4000-a000-000000000002')),
   'tasks.duplicate_slot'),
  ('two new slots with the same pair',
   l.loaded || jsonb_build_array(
     pg_temp.slot(null, 'writer', '00000000-0000-4000-a000-000000000003'),
     pg_temp.slot(null, 'writer', '00000000-0000-4000-a000-000000000003')),
   'tasks.duplicate_slot'),
  ('a reassigned slot and a new one with the same pair',
   jsonb_set(l.loaded, '{2}', pg_temp.slot('00000000-0000-4000-c000-000000000013', 'photojournalist', '00000000-0000-4000-a000-000000000002'))
     || jsonb_build_array(pg_temp.slot(null, 'photojournalist', '00000000-0000-4000-a000-000000000002')),
   'tasks.duplicate_slot')
) as r (label, slots, code);

create temp table refusals_observed (label text, result text);

do $$
declare
  v_rows refusals[];
  r refusals;
  v_labels text[] := '{}';
  v_results text[] := '{}';
begin
  select array_agg(x) into v_rows from refusals x;

  foreach r in array v_rows loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', '00000000-0000-4000-a000-000000000004',
                         'role', 'authenticated')::text,
      true
    );
    set local role authenticated;
    begin
      perform public.update_task('00000000-0000-4000-b000-000000000001',
                                 'Refused title', null,
                                 '2026-11-09T09:00:00+08', null, r.slots);
      v_results := v_results || 'ok'::text;
    exception when others then
      v_results := v_results || (sqlstate || ' ' || sqlerrm);
    end;
    set local role postgres;
    v_labels := v_labels || r.label;
  end loop;

  insert into refusals_observed select * from unnest(v_labels, v_results);
  perform set_config('request.jwt.claims', '', true);
end
$$;

select set_eq(
  $$ select * from refusals_observed $$,
  $$ select label, 'P0001 ' || code from refusals $$,
  'every malformed list, stale id, inactive new member and repeated pair is refused with its code'
);

select results_eq(
  $$ select t.title,
            (select count(*)::int from public.activity v
             where v.entity_id = t.id and v.action = 'updated')
     from public.tasks t
     where t.id = '00000000-0000-4000-b000-000000000001' $$,
  $$ values ('Lay out the spread, v2'::text, 1) $$,
  'no refused edit wrote anything'
);

select set_eq(
  $$ select * from public.task_assignments
     where task_id = '00000000-0000-4000-b000-000000000001' $$,
  $$ select * from b01_slots_before $$,
  'nor touched a slot'
);

-- The approver is checked before the slot list, and the task before the
-- approver.

select throws_ok(
  $$ select pg_temp.edit_as('00000000-0000-4000-a000-000000000005',
       '00000000-0000-4000-b000-000000000001', 'Title', '[]'::jsonb) $$,
  'P0001', 'tasks.not_approver',
  'someone who isn''t the approver gets tasks.not_approver, even with an empty list'
);

-- Missing tasks.

select throws_ok(
  format(
    'select pg_temp.edit_as(%L, %L, %L, %L::jsonb)',
    '00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-b000-000000000007',
    'Title',
    jsonb_build_array(pg_temp.slot('00000000-0000-4000-c000-000000000071', 'layout_artist', '00000000-0000-4000-a000-000000000002'))
  ),
  'P0001', 'tasks.not_found',
  'update_task on a deleted task gets tasks.not_found, even from its approver'
);

select is(
  (select title from public.tasks where id = '00000000-0000-4000-b000-000000000007'),
  'Fixture task 00000000-0000-4000-b000-000000000007',
  'the deleted task is untouched'
);

select throws_ok(
  $$ select pg_temp.edit_as('00000000-0000-4000-a000-000000000008',
       '00000000-0000-4000-9999-000000000000', 'Title', '[]'::jsonb) $$,
  'P0001', 'tasks.not_found',
  'update_task on an unknown task gets tasks.not_found'
);

select throws_ok(
  $$ select pg_temp.edit_as('00000000-0000-4000-a000-000000000005',
       '00000000-0000-4000-9999-000000000000', 'Title', '[]'::jsonb) $$,
  'P0001', 'tasks.not_found',
  'tasks.not_found comes before tasks.not_approver'
);

select throws_ok(
  $$ select pg_temp.edit_as('00000000-0000-4000-a000-000000000001',
       '00000000-0000-4000-9999-000000000000', 'Title', '[]'::jsonb) $$,
  'P0001', 'auth.not_active',
  'a pending caller gets auth.not_active before tasks.not_found'
);

select throws_ok(
  $$ select pg_temp.edit_as('00000000-0000-4000-a000-000000000013',
       '00000000-0000-4000-b000-000000000001', 'Title', '[]'::jsonb) $$,
  'P0001', 'auth.not_active',
  'a deactivated caller gets auth.not_active'
);

-- The helper on its own, as reassign_slot (Story 3.3) will call it: the same
-- member resets the slot.

select lives_ok(
  $$ select private.reassign_slot_member(
       '00000000-0000-4000-c000-000000000081',
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-d000-000000000081') $$,
  'private.reassign_slot_member runs for its owner'
);

select results_eq(
  $$ select a.member_id, a.state::text, a.updated_at = now(),
            (select count(*)::int from public.assignment_reasons r
             where r.assignment_id = a.id)
     from public.task_assignments a
     where a.id = '00000000-0000-4000-c000-000000000081' $$,
  $$ values ('00000000-0000-4000-a000-000000000002'::uuid, 'awaiting_response'::text, true, 0) $$,
  'the same member resets the slot: awaiting_response, a new updated_at, no reason'
);

select results_eq(
  $$ select v.op_id, v.entity_type, v.entity_id, v.actor_id, v.action
     from public.activity v
     where v.entity_id = '00000000-0000-4000-c000-000000000081' $$,
  $$ values ('00000000-0000-4000-d000-000000000081'::uuid, 'task_assignment'::text,
             '00000000-0000-4000-c000-000000000081'::uuid,
             '00000000-0000-4000-a000-000000000004'::uuid, 'slot_reassigned'::text) $$,
  'and logs one slot_reassigned row under the caller''s op_id and actor'
);

select throws_ok(
  $$ select pg_temp.query_as('00000000-0000-4000-a000-000000000004',
       $q$ select 'called' from (select private.reassign_slot_member(
             '00000000-0000-4000-c000-000000000081',
             '00000000-0000-4000-a000-000000000003',
             '00000000-0000-4000-a000-000000000004',
             gen_random_uuid())) as s $q$) $$,
  '42501', null,
  'an approver can''t call private.reassign_slot_member directly'
);

-- No such slot: tasks.not_found, raised before anything is logged.

select throws_ok(
  $$ select private.reassign_slot_member(
       '00000000-0000-4000-c000-0000000000ff',
       '00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-d000-0000000000ff') $$,
  'P0001', 'tasks.not_found',
  'private.reassign_slot_member on a missing slot raises tasks.not_found'
);

select ok(
  pg_get_functiondef('private.reassign_slot_member(uuid, uuid, uuid, uuid)'::regprocedure)
    ~* 'where\s+a\.id\s*=\s*p_slot_id\s*;\s*if\s+not\s+found\s+then\s+raise\s+exception\s+using\s+errcode\s*=\s*''P0001'',\s*message\s*=\s*''tasks\.not_found''\s*;\s*end\s+if\s*;.*log_activity',
  'private.reassign_slot_member(...) raises tasks.not_found right after an update that matched nothing, before it logs'
);

-- Grants: update_task to authenticated only.

select ok(
  has_function_privilege('authenticated',
    'public.update_task(uuid, text, text, timestamptz, text, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon',
    'public.update_task(uuid, text, text, timestamptz, text, jsonb)', 'EXECUTE'),
  'authenticated may execute update_task, anon may not'
);

select * from finish();

rollback;
