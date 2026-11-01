-- Reassign (Story 3.3, AD-1, AD-4, AD-16, AD-19, AD-21): reassign_slot,
-- task_capabilities' can_reassign and member_open_slot_counts(). Covers
-- reassign_slot along the approver matrix (a fresh task per caller and
-- owner, so every allowed reassign really happens), every slot state and
-- every non-Done column, the same member (a reset), every refusal in the
-- order the checks run, stale after a real answer or hand-back (each bumps
-- the slot's version), the task row untouched, the old reason gone and
-- unreadable to the new assignee, one slot_reassigned row with no reason
-- text, the unfreeze (a Doing task whose only On it slot was handed back,
-- plainly and after Send back), can_reassign (the approver on a task that
-- isn't Done; never staff, a Done task or a deleted one), the counts (open
-- states only, not Done, not deleted, zeros, nothing for a caller who isn't
-- active), and the pins (definer, owner, search_path, the lock order, the
-- one write through the reassign helper; the count RPC invoker over the one
-- open-slot definition; task_capabilities naming is_task_approver once).
--
-- Fixtures follow edit.test.sql: auth users, tasks and slots are created
-- here (tasks and slots inserted directly as `postgres`, so a test can start
-- from any column and state), so the test doesn't depend on seed.sql;
-- everything is rolled back. It runs locally and on staging
-- (`supabase test db --linked`), seeded or not.

begin;

-- See responses_and_moves.test.sql: run as `postgres` with `extensions` on the
-- path, whichever role `supabase test db --linked` connected as.
set local role postgres;
set local search_path = "$user", public, extensions;

select plan(55);

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

-- Every fixture task was last changed on Oct 1. A Done task carries done_at
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

-- Every fixture slot's version (updated_at) is Oct 1, so a test can pass it
-- as the version the picker was rendered from.
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

-- Clear any seeded Editor-in-Chief (member_positions_one_editor_in_chief) so
-- the fixture one below can hold the position; rolled back with the rest.
delete from public.member_positions where position = 'editor_in_chief';

-- Callers, as in edit.test.sql: each holds one primary position. a12 is the
-- member most slots are given to; a13 is deactivated.
select pg_temp.new_member('00000000-0000-4000-a000-000000000001', 'ra-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-000000000002', 'ra-assignee@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000003', 'ra-staff@example.com', 'staff_writer');
select pg_temp.new_member('00000000-0000-4000-a000-000000000004', 'ra-head-layout@example.com', 'head_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000005', 'ra-head-cartoonist@example.com', 'head_cartoonist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000006', 'ra-news-editor@example.com', 'news_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000007', 'ra-sports-editor@example.com', 'sports_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000008', 'ra-eic@example.com', 'editor_in_chief');
select pg_temp.new_member('00000000-0000-4000-a000-000000000009', 'ra-associate@example.com', 'associate_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000010', 'ra-managing@example.com', 'managing_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000011', 'ra-finance@example.com', 'finance_manager');
select pg_temp.new_member('00000000-0000-4000-a000-000000000012', 'ra-staff-2@example.com', 'staff_writer');
select pg_temp.new_member('00000000-0000-4000-a000-000000000013', 'ra-deactivated@example.com', 'staff_photojournalist');
update public.members set deactivated_at = now()
where id = '00000000-0000-4000-a000-000000000013';

-- The counts' members, holding no other fixture slot: k1 and k2 staff
-- writers, k3 a deactivated staff photojournalist, k4 a staff writer with no
-- slots at all.
select pg_temp.new_member('00000000-0000-4000-a100-000000000001', 'ra-count-1@example.com', 'staff_writer');
select pg_temp.new_member('00000000-0000-4000-a100-000000000002', 'ra-count-2@example.com', 'staff_writer');
select pg_temp.new_member('00000000-0000-4000-a100-000000000003', 'ra-count-3@example.com', 'staff_photojournalist');
select pg_temp.new_member('00000000-0000-4000-a100-000000000004', 'ra-count-4@example.com', 'staff_writer');
update public.members set deactivated_at = now()
where id = '00000000-0000-4000-a100-000000000003';

-- b01-b04, every state in a non-Done column, each Layout task with a Layout
-- Artist slot given to a12 below and the staff writer's untouched Writer
-- slot: b01 (To Do) the assignee's awaiting c11; b02 (Doing, sent back, so
-- a revision note stands) the assignee's On it c21 with a stray reason row;
-- b03 (For Review) the assignee's handed-back c31 with its reason; b04 (To
-- Do) the deactivated member's On it c41.
select pg_temp.new_task('00000000-0000-4000-b000-000000000001', null, 'layout', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000011', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000012', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000003', 'writer', 'awaiting_response');

select pg_temp.new_task('00000000-0000-4000-b000-000000000002', null, 'layout', 'doing');
update public.tasks
set revision_note = 'Fix the captions',
    revision_note_by = '00000000-0000-4000-a000-000000000004',
    revision_note_at = '2026-10-01T00:00:00+08'
where id = '00000000-0000-4000-b000-000000000002';
select pg_temp.new_slot('00000000-0000-4000-c000-000000000021', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000022', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000003', 'writer', 'on_it');

select pg_temp.new_task('00000000-0000-4000-b000-000000000003', null, 'layout', 'for_review');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000031', '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'needs_reassignment');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000032', '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000003', 'writer', 'on_it');

select pg_temp.new_task('00000000-0000-4000-b000-000000000004', null, 'layout', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000041', '00000000-0000-4000-b000-000000000004', '00000000-0000-4000-a000-000000000013', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000042', '00000000-0000-4000-b000-000000000004', '00000000-0000-4000-a000-000000000003', 'writer', 'awaiting_response');

insert into public.assignment_reasons (assignment_id, reason)
values ('00000000-0000-4000-c000-000000000021', 'Old reason'),
       ('00000000-0000-4000-c000-000000000031', 'Exams all week');

-- b05 and b06, the same member: Layout, Doing, the assignee's On it c51 with
-- a stray reason row; Layout, To Do, the assignee's handed-back Cartoonist
-- slot c61 with its reason.
select pg_temp.new_task('00000000-0000-4000-b000-000000000005', null, 'layout', 'doing');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000051', '00000000-0000-4000-b000-000000000005', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_task('00000000-0000-4000-b000-000000000006', null, 'layout', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000061', '00000000-0000-4000-b000-000000000006', '00000000-0000-4000-a000-000000000002', 'cartoonist', 'needs_reassignment');
insert into public.assignment_reasons (assignment_id, reason)
values ('00000000-0000-4000-c000-000000000051', 'Stray'),
       ('00000000-0000-4000-c000-000000000061', 'Busy');

-- b07, the refusals: Layout, To Do, the assignee's On it Layout Artist c71,
-- the staff writer's awaiting Writer c72, the deactivated member's On it
-- Photojournalist c73, a12's awaiting Layout Artist c74 and the staff
-- writer's awaiting Photojournalist c75.
select pg_temp.new_task('00000000-0000-4000-b000-000000000007', null, 'layout', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000071', '00000000-0000-4000-b000-000000000007', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000072', '00000000-0000-4000-b000-000000000007', '00000000-0000-4000-a000-000000000003', 'writer', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000073', '00000000-0000-4000-b000-000000000007', '00000000-0000-4000-a000-000000000013', 'photojournalist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000074', '00000000-0000-4000-b000-000000000007', '00000000-0000-4000-a000-000000000012', 'layout_artist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000075', '00000000-0000-4000-b000-000000000007', '00000000-0000-4000-a000-000000000003', 'photojournalist', 'awaiting_response');

-- b08, Done: Layout, the assignee's On it c81.
select pg_temp.new_task('00000000-0000-4000-b000-000000000008', null, 'layout', 'done');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000081', '00000000-0000-4000-b000-000000000008', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');

-- b09, deleted: Layout, the assignee's On it c91.
select pg_temp.new_task('00000000-0000-4000-b000-000000000009', null, 'layout', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000091', '00000000-0000-4000-b000-000000000009', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
update public.tasks set deleted_at = '2026-10-02T00:00:00+08'
where id = '00000000-0000-4000-b000-000000000009';

-- b10, the unfreeze: Layout, Doing, its only slot the assignee's On it c101.
-- b11, the unfreeze after Send back: Layout, For Review, its only slot the
-- assignee's On it c111.
select pg_temp.new_task('00000000-0000-4000-b000-000000000010', null, 'layout', 'doing');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000101', '00000000-0000-4000-b000-000000000010', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_task('00000000-0000-4000-b000-000000000011', null, 'layout', 'for_review');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000111', '00000000-0000-4000-b000-000000000011', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');

-- b15, stale from real answers: Layout, To Do, the assignee's awaiting c151
-- (answered I'm on it below) and On it c152 (handed back below).
select pg_temp.new_task('00000000-0000-4000-b000-000000000015', null, 'layout', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000151', '00000000-0000-4000-b000-000000000015', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000152', '00000000-0000-4000-b000-000000000015', '00000000-0000-4000-a000-000000000002', 'cartoonist', 'on_it');

-- b12-b14, the counts. b12 (To Do): k1's awaiting Writer c121, On it
-- Cartoonist c122 and handed-back Photojournalist c123, k2's handed-back
-- Broadcast Journalist c124, k3's On it Videojournalist c125. b13 (Done):
-- k1's On it Writer c131. b14 (deleted): k1's awaiting Writer c141.
select pg_temp.new_task('00000000-0000-4000-b000-000000000012', null, 'layout', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000121', '00000000-0000-4000-b000-000000000012', '00000000-0000-4000-a100-000000000001', 'writer', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000122', '00000000-0000-4000-b000-000000000012', '00000000-0000-4000-a100-000000000001', 'cartoonist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000123', '00000000-0000-4000-b000-000000000012', '00000000-0000-4000-a100-000000000001', 'photojournalist', 'needs_reassignment');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000124', '00000000-0000-4000-b000-000000000012', '00000000-0000-4000-a100-000000000002', 'broadcast_journalist', 'needs_reassignment');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000125', '00000000-0000-4000-b000-000000000012', '00000000-0000-4000-a100-000000000003', 'videojournalist', 'on_it');
select pg_temp.new_task('00000000-0000-4000-b000-000000000013', null, 'layout', 'done');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000131', '00000000-0000-4000-b000-000000000013', '00000000-0000-4000-a100-000000000001', 'writer', 'on_it');
select pg_temp.new_task('00000000-0000-4000-b000-000000000014', null, 'layout', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000141', '00000000-0000-4000-b000-000000000014', '00000000-0000-4000-a100-000000000001', 'writer', 'awaiting_response');
update public.tasks set deleted_at = '2026-10-02T00:00:00+08'
where id = '00000000-0000-4000-b000-000000000014';

-- Run as the given caller (via the request.jwt.claims GUC, as RLS and
-- private.current_member_id() read it). On success, the role is reset to
-- postgres before returning. On a raised exception, pgTAP's lives_ok() or
-- throws_ok() rolls back its own savepoint, which undoes the SET LOCAL made
-- here. Arguments are evaluated before the call, still as postgres.
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

create function pg_temp.exec_as(p_caller uuid, p_sql text)
returns void
language plpgsql as $$
begin
  perform pg_temp.as_caller(p_caller);
  execute p_sql;
  set local role postgres;
end;
$$;

-- reassign_slot as the caller: `ok`, or `<sqlstate> <message>`. A refusal
-- rolls back the block's subtransaction, the role change with it.
create function pg_temp.reassign_result(
  p_caller uuid,
  p_slot uuid,
  p_member uuid,
  p_version timestamptz
)
returns text
language plpgsql as $$
declare
  v_result text;
begin
  begin
    perform pg_temp.as_caller(p_caller);
    perform public.reassign_slot(p_slot, p_member, p_version);
    v_result := 'ok';
  exception when others then
    v_result := sqlstate || ' ' || sqlerrm;
  end;
  set local role postgres;
  return v_result;
end;
$$;

-- Pins.

select is_definer('public', 'reassign_slot',
  array['uuid', 'uuid', 'timestamp with time zone'],
  'public.reassign_slot(...) is security definer');
select function_owner_is('public', 'reassign_slot',
  array['uuid', 'uuid', 'timestamp with time zone'], 'postgres',
  'public.reassign_slot(...) is owned by postgres');
select function_returns('public', 'reassign_slot',
  array['uuid', 'uuid', 'timestamp with time zone'], 'void',
  'public.reassign_slot(...) returns void');
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'public.reassign_slot(uuid, uuid, timestamptz)'::regprocedure),
  array['search_path=""'],
  'public.reassign_slot(...) sets search_path = '''''
);

create temp table reassign_slot_def as
select pg_get_functiondef(
  'public.reassign_slot(uuid, uuid, timestamptz)'::regprocedure
) as def;

-- A slot command: its slot, then the slot's live task; there is no other
-- lock.
select ok(
  (select def from reassign_slot_def)
    ~* 'select\s+a\.id,\s*a\.task_id,\s*a\.role,\s*a\.updated_at\s+into\s+v_slot\s+from\s+public\.task_assignments\s+a\s+where\s+a\.id\s*=\s*reassign_slot\.slot_id\s+for\s+update\s*;.*select\s+t\.id,\s*t\."column"\s+into\s+v_task\s+from\s+public\.tasks\s+t\s+where\s+t\.id\s*=\s*v_slot\.task_id\s+and\s+t\.deleted_at\s+is\s+null\s+for\s+update\s+of\s+t\s*;'
    and (select count(*) from regexp_matches(
           (select def from reassign_slot_def), 'for\s+update', 'gi')) = 2,
  'public.reassign_slot(...) locks its slot, then the slot''s live task, and nothing else'
);

-- The one reassign branch: no write of its own.
select ok(
  (select def from reassign_slot_def)
    ~* 'perform\s+private\.reassign_slot_member\(\s*v_slot\.id,\s*reassign_slot\.member_id,\s*v_actor,\s*v_op\s*\)'
    and (select def from reassign_slot_def)
      !~* '(\mupdate|insert\s+into|delete\s+from)\s+public\.',
  'public.reassign_slot(...) writes only through private.reassign_slot_member, under its own op_id'
);

-- Catalog text columns use the C collation, so each is compared here and
-- only the booleans are checked.
select results_eq(
  $$ select p.prosecdef,
            p.proowner = 'postgres'::regrole,
            p.proconfig = array['search_path=""'],
            p.provolatile = 's',
            l.lanname = 'sql'
     from pg_proc p
     join pg_language l on l.oid = p.prolang
     where p.oid = 'public.member_open_slot_counts()'::regprocedure $$,
  $$ values (false, true, true, true, true) $$,
  'public.member_open_slot_counts() is SQL, security invoker, stable, owned by postgres, with search_path = '''''
);

select ok(
  pg_get_functiondef('public.member_open_slot_counts()'::regprocedure)
    ~* 'from\s+public\.member_directory\s+d\M'
    and pg_get_functiondef('public.member_open_slot_counts()'::regprocedure)
      ~* 'private\.open_slots\(\s*d\.id\s*\)'
    and pg_get_functiondef('public.member_open_slot_counts()'::regprocedure)
      !~* '\mwhere\M',
  'public.member_open_slot_counts() counts private.open_slots over member_directory, with no predicate of its own'
);

select results_eq(
  $$ select p.prosecdef,
            p.proowner = 'postgres'::regrole,
            p.proconfig = array['search_path=""'],
            p.proargnames = array['ids', 'task_id', 'allowed_moves',
                                  'respondable_slot_ids', 'hand_back_slot_ids',
                                  'can_review', 'can_reopen', 'can_manage',
                                  'can_reassign']
     from pg_proc p
     where p.oid = 'public.task_capabilities(uuid[])'::regprocedure $$,
  $$ values (false, true, true, true) $$,
  'task_capabilities still runs with the caller''s rights, owned by postgres, with search_path = '''', keeps its columns and adds can_reassign last'
);

select ok(
  (select count(*) from regexp_matches(
     pg_get_functiondef('public.task_capabilities(uuid[])'::regprocedure),
     'is_task_approver', 'g')) = 1
    and pg_get_functiondef('public.task_capabilities(uuid[])'::regprocedure)
      ~* 'with\s+ap\s+as\s+materialized',
  'task_capabilities names private.is_task_approver once, in a materialized CTE that can_manage and can_reassign share'
);

select ok(
  has_function_privilege('authenticated',
    'public.reassign_slot(uuid, uuid, timestamptz)', 'EXECUTE')
  and has_function_privilege('authenticated',
    'public.member_open_slot_counts()', 'EXECUTE')
  and not has_function_privilege('anon',
    'public.reassign_slot(uuid, uuid, timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon',
    'public.member_open_slot_counts()', 'EXECUTE'),
  'authenticated may execute reassign_slot and member_open_slot_counts, anon may not'
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

-- A fresh task for every caller and owner, each with the assignee's On it
-- Layout Artist slot, so each allowed reassign really happens. The owners'
-- tasks sit in To Do, Doing and For Review.
create temp table reassign_tasks as
select c.label, c.member_id, a.owner, a.allowed,
       gen_random_uuid() as task_id,
       gen_random_uuid() as slot_id,
       (case a.owner
          when 'news' then 'doing'
          when 'opinion' then 'for_review'
          else 'to_do'
        end)::public.task_column as col
from matrix_callers c
cross join lateral (
  values ('layout', c.layout), ('news', c.news),
         ('opinion', c.opinion), ('editorial', c.editorial)
) as a (owner, allowed);

do $$
begin
  perform pg_temp.new_task(e.task_id, o.section, o.desk, e.col)
  from reassign_tasks e
  join matrix_owners o on o.owner = e.owner;
  perform pg_temp.new_slot(e.slot_id, e.task_id,
                           '00000000-0000-4000-a000-000000000002',
                           'layout_artist', 'on_it')
  from reassign_tasks e;
end
$$;

-- What task_capabilities offers (`true`, `false`, or `no row` for a task the
-- caller can't read), and what reassign_slot answers (`ok` or
-- `<sqlstate> <message>`), giving each slot to a12 with its version.
create temp table matrix_expected as
select e.label, e.owner,
       case
         when e.label = 'pending' then 'no row'
         else e.allowed::text
       end as can_reassign,
       case
         when e.label = 'pending' then 'P0001 auth.not_active'
         when e.allowed then 'ok'
         else 'P0001 tasks.not_approver'
       end as result
from reassign_tasks e;

create temp table matrix_observed (like matrix_expected);

do $$
declare
  v_rows reassign_tasks[];
  e reassign_tasks;
  v_labels text[] := '{}';
  v_owners text[] := '{}';
  v_caps text[] := '{}';
  v_results text[] := '{}';
  v_cap text;
  v_result text;
begin
  -- Read the fixtures while still `postgres`: `authenticated` can't read
  -- temp tables.
  select array_agg(x order by x.task_id) into v_rows from reassign_tasks x;

  for i in 1 .. array_length(v_rows, 1) loop
    e := v_rows[i];
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', e.member_id, 'role', 'authenticated')::text,
      true
    );
    set local role authenticated;
    v_cap := coalesce(
      (select k.can_reassign::text
       from public.task_capabilities(array[e.task_id]) k),
      'no row'
    );
    begin
      perform public.reassign_slot(e.slot_id,
                                   '00000000-0000-4000-a000-000000000012',
                                   '2026-10-01T00:00:00+08');
      v_result := 'ok';
    exception when others then
      v_result := sqlstate || ' ' || sqlerrm;
    end;
    set local role postgres;
    v_labels := v_labels || e.label;
    v_owners := v_owners || e.owner;
    v_caps := v_caps || v_cap;
    v_results := v_results || v_result;
  end loop;

  insert into matrix_observed
  select * from unnest(v_labels, v_owners, v_caps, v_results);
  perform set_config('request.jwt.claims', '', true);
end
$$;

select set_eq(
  $$ select * from matrix_observed $$,
  $$ select * from matrix_expected $$,
  'task_capabilities offers can_reassign, and reassign_slot accepts, exactly the owner''s head and the three top editors (top editors only on Opinion and Editorial) in To Do, Doing and For Review; everyone else gets false and tasks.not_approver, a pending caller no row and auth.not_active'
);

select is_empty(
  $$ select e.label, e.owner
     from reassign_tasks e
     join public.task_assignments a on a.id = e.slot_id
     where e.allowed is distinct from (
       a.member_id = '00000000-0000-4000-a000-000000000012'
       and a.state = 'awaiting_response'
     ) $$,
  'exactly the accepted reassigns gave the slot to a12, awaiting their answer'
);

select set_eq(
  $$ select v.entity_type, v.entity_id, v.actor_id, v.action
     from public.activity v
     where v.entity_id in (select task_id from reassign_tasks
                           union all select slot_id from reassign_tasks) $$,
  $$ select 'task_assignment'::text as entity_type, e.slot_id, e.member_id,
            'slot_reassigned'::text as action
     from reassign_tasks e
     where e.allowed $$,
  'each accepted reassign logs one slot_reassigned row for its slot, by its actor, and nothing for its task; a refused one logs nothing'
);

-- Every state, in every non-Done column: b01-b04 by the Head Layout Artist,
-- each Layout Artist slot to a12.

create temp table state_tasks_before as
select * from public.tasks
where id in ('00000000-0000-4000-b000-000000000001',
             '00000000-0000-4000-b000-000000000002',
             '00000000-0000-4000-b000-000000000003',
             '00000000-0000-4000-b000-000000000004');
create temp table state_siblings_before as
select * from public.task_assignments
where id in ('00000000-0000-4000-c000-000000000012',
             '00000000-0000-4000-c000-000000000022',
             '00000000-0000-4000-c000-000000000032',
             '00000000-0000-4000-c000-000000000042');

select is(
  pg_temp.query_as('00000000-0000-4000-a000-000000000002',
    $q$ select reason from public.assignment_reasons
        where assignment_id = '00000000-0000-4000-c000-000000000031' $q$),
  'Exams all week',
  'before the reassign, the assignee reads their own reason on the handed-back c31'
);

select is(
  pg_temp.reassign_result('00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-c000-000000000011',
    '00000000-0000-4000-a000-000000000012', '2026-10-01T00:00:00+08'),
  'ok',
  'an awaiting slot in To Do is reassigned'
);

select is(
  pg_temp.reassign_result('00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-c000-000000000021',
    '00000000-0000-4000-a000-000000000012', '2026-10-01T00:00:00+08'),
  'ok',
  'an On it slot in Doing, on a sent-back task, is reassigned'
);

select is(
  pg_temp.reassign_result('00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-c000-000000000031',
    '00000000-0000-4000-a000-000000000012', '2026-10-01T00:00:00+08'),
  'ok',
  'a handed-back slot in For Review is reassigned'
);

select is(
  pg_temp.reassign_result('00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-c000-000000000041',
    '00000000-0000-4000-a000-000000000012', '2026-10-01T00:00:00+08'),
  'ok',
  'a deactivated member''s On it slot is reassigned'
);

select results_eq(
  $$ select a.id, a.role::text, a.member_id, a.state::text,
            a.updated_at = now(),
            (select count(*)::int from public.assignment_reasons r
             where r.assignment_id = a.id)
     from public.task_assignments a
     where a.id in ('00000000-0000-4000-c000-000000000011',
                    '00000000-0000-4000-c000-000000000021',
                    '00000000-0000-4000-c000-000000000031',
                    '00000000-0000-4000-c000-000000000041')
     order by a.id $$,
  $$ values ('00000000-0000-4000-c000-000000000011'::uuid, 'layout_artist'::text, '00000000-0000-4000-a000-000000000012'::uuid, 'awaiting_response'::text, true, 0),
            ('00000000-0000-4000-c000-000000000021'::uuid, 'layout_artist'::text, '00000000-0000-4000-a000-000000000012'::uuid, 'awaiting_response'::text, true, 0),
            ('00000000-0000-4000-c000-000000000031'::uuid, 'layout_artist'::text, '00000000-0000-4000-a000-000000000012'::uuid, 'awaiting_response'::text, true, 0),
            ('00000000-0000-4000-c000-000000000041'::uuid, 'layout_artist'::text, '00000000-0000-4000-a000-000000000012'::uuid, 'awaiting_response'::text, true, 0) $$,
  'from any state, each slot keeps its id and role, takes the new member, starts over awaiting their answer with a new version, and has no reason row'
);

select set_eq(
  $$ select * from public.task_assignments
     where id in ('00000000-0000-4000-c000-000000000012',
                  '00000000-0000-4000-c000-000000000022',
                  '00000000-0000-4000-c000-000000000032',
                  '00000000-0000-4000-c000-000000000042') $$,
  $$ select * from state_siblings_before $$,
  'the tasks'' other slots are untouched'
);

select set_eq(
  $$ select * from public.tasks
     where id in ('00000000-0000-4000-b000-000000000001',
                  '00000000-0000-4000-b000-000000000002',
                  '00000000-0000-4000-b000-000000000003',
                  '00000000-0000-4000-b000-000000000004') $$,
  $$ select * from state_tasks_before $$,
  'each task row is untouched: its column, updated_at, done_at, revision note and every other field'
);

select set_eq(
  $$ select v.entity_type, v.entity_id, v.actor_id, v.action,
            (select count(*) from public.activity w where w.op_id = v.op_id)
     from public.activity v
     where v.entity_id in ('00000000-0000-4000-b000-000000000001',
                           '00000000-0000-4000-b000-000000000002',
                           '00000000-0000-4000-b000-000000000003',
                           '00000000-0000-4000-b000-000000000004',
                           '00000000-0000-4000-c000-000000000011',
                           '00000000-0000-4000-c000-000000000012',
                           '00000000-0000-4000-c000-000000000021',
                           '00000000-0000-4000-c000-000000000022',
                           '00000000-0000-4000-c000-000000000031',
                           '00000000-0000-4000-c000-000000000032',
                           '00000000-0000-4000-c000-000000000041',
                           '00000000-0000-4000-c000-000000000042') $$,
  $$ values ('task_assignment'::text, '00000000-0000-4000-c000-000000000011'::uuid,
             '00000000-0000-4000-a000-000000000004'::uuid, 'slot_reassigned'::text, 1::bigint),
            ('task_assignment', '00000000-0000-4000-c000-000000000021',
             '00000000-0000-4000-a000-000000000004', 'slot_reassigned', 1),
            ('task_assignment', '00000000-0000-4000-c000-000000000031',
             '00000000-0000-4000-a000-000000000004', 'slot_reassigned', 1),
            ('task_assignment', '00000000-0000-4000-c000-000000000041',
             '00000000-0000-4000-a000-000000000004', 'slot_reassigned', 1) $$,
  'each reassign logs one slot_reassigned row for its slot, alone under its own op_id, and nothing for its task or the other slots'
);

select is_empty(
  $$ select v.id
     from public.activity v
     where v.entity_id in ('00000000-0000-4000-c000-000000000021',
                           '00000000-0000-4000-c000-000000000031')
       and (to_jsonb(v)::text ~ 'Old reason'
            or to_jsonb(v)::text ~ 'Exams all week') $$,
  'no activity row holds the reason text'
);

select results_eq(
  $$ select pg_temp.query_as('00000000-0000-4000-a000-000000000012',
              $q$ select count(*)::text from public.assignment_reasons
                  where assignment_id = '00000000-0000-4000-c000-000000000031' $q$),
            pg_temp.query_as('00000000-0000-4000-a000-000000000002',
              $q$ select count(*)::text from public.assignment_reasons
                  where assignment_id = '00000000-0000-4000-c000-000000000031' $q$),
            pg_temp.query_as('00000000-0000-4000-a000-000000000004',
              $q$ select count(*)::text from public.assignment_reasons
                  where assignment_id = '00000000-0000-4000-c000-000000000031' $q$) $$,
  $$ values ('0'::text, '0'::text, '0'::text) $$,
  'the new assignee reads no old reason, and neither do the old assignee or the approver: the row is gone'
);

-- The same member: the Editor-in-Chief gives c51 (On it, a stray reason) and
-- c61 (handed back, its reason) back to the assignee.

select is(
  pg_temp.reassign_result('00000000-0000-4000-a000-000000000008',
    '00000000-0000-4000-c000-000000000051',
    '00000000-0000-4000-a000-000000000002', '2026-10-01T00:00:00+08'),
  'ok',
  'an On it slot reassigned to its own member is accepted'
);

select is(
  pg_temp.reassign_result('00000000-0000-4000-a000-000000000008',
    '00000000-0000-4000-c000-000000000061',
    '00000000-0000-4000-a000-000000000002', '2026-10-01T00:00:00+08'),
  'ok',
  'a handed-back slot reassigned to its own member is accepted'
);

select results_eq(
  $$ select a.id, a.member_id, a.state::text, a.updated_at = now(),
            (select count(*)::int from public.assignment_reasons r
             where r.assignment_id = a.id),
            (select count(*)::int from public.activity v
             where v.entity_id = a.id and v.action = 'slot_reassigned'
               and v.actor_id = '00000000-0000-4000-a000-000000000008')
     from public.task_assignments a
     where a.id in ('00000000-0000-4000-c000-000000000051',
                    '00000000-0000-4000-c000-000000000061')
     order by a.id $$,
  $$ values ('00000000-0000-4000-c000-000000000051'::uuid, '00000000-0000-4000-a000-000000000002'::uuid, 'awaiting_response'::text, true, 0, 1),
            ('00000000-0000-4000-c000-000000000061'::uuid, '00000000-0000-4000-a000-000000000002'::uuid, 'awaiting_response'::text, true, 0, 1) $$,
  'the same member resets the slot: awaiting their answer again, a new version, no reason, and one slot_reassigned row'
);

-- Refusals, each checked behind the ones before it. The version as loaded is
-- Oct 1; an old one is the day before.

create temp table refusal_slots_before as
select * from public.task_assignments
where task_id in ('00000000-0000-4000-b000-000000000007',
                  '00000000-0000-4000-b000-000000000008',
                  '00000000-0000-4000-b000-000000000009');

create temp table refusals (
  label text primary key,
  caller uuid not null,
  slot_id uuid,
  member_id uuid,
  version timestamptz,
  code text not null
);

insert into refusals values
  ('a pending caller',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000071',
   '00000000-0000-4000-a000-000000000012', '2026-10-01T00:00:00+08', 'auth.not_active'),
  ('a deactivated caller',
   '00000000-0000-4000-a000-000000000013', '00000000-0000-4000-c000-000000000071',
   '00000000-0000-4000-a000-000000000012', '2026-10-01T00:00:00+08', 'auth.not_active'),
  ('a pending caller on a missing slot (auth.not_active comes first)',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-0000000000ff',
   '00000000-0000-4000-a000-000000000012', '2026-10-01T00:00:00+08', 'auth.not_active'),
  ('a missing slot',
   '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-c000-0000000000ff',
   '00000000-0000-4000-a000-000000000012', '2026-10-01T00:00:00+08', 'tasks.not_found'),
  ('no slot at all',
   '00000000-0000-4000-a000-000000000004', null,
   '00000000-0000-4000-a000-000000000012', '2026-10-01T00:00:00+08', 'tasks.not_found'),
  ('a missing slot, from another desk''s Head (tasks.not_found comes first)',
   '00000000-0000-4000-a000-000000000005', '00000000-0000-4000-c000-0000000000ff',
   '00000000-0000-4000-a000-000000000012', '2026-10-01T00:00:00+08', 'tasks.not_found'),
  ('a deleted task''s slot, from its approver',
   '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-c000-000000000091',
   '00000000-0000-4000-a000-000000000012', '2026-10-01T00:00:00+08', 'tasks.not_found'),
  ('another desk''s Head',
   '00000000-0000-4000-a000-000000000005', '00000000-0000-4000-c000-000000000071',
   '00000000-0000-4000-a000-000000000012', '2026-10-01T00:00:00+08', 'tasks.not_approver'),
  ('the slot''s own staff assignee',
   '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-c000-000000000071',
   '00000000-0000-4000-a000-000000000012', '2026-10-01T00:00:00+08', 'tasks.not_approver'),
  ('the Finance Manager',
   '00000000-0000-4000-a000-000000000011', '00000000-0000-4000-c000-000000000071',
   '00000000-0000-4000-a000-000000000012', '2026-10-01T00:00:00+08', 'tasks.not_approver'),
  ('a Done task''s slot, from its approver',
   '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-c000-000000000081',
   '00000000-0000-4000-a000-000000000012', '2026-10-01T00:00:00+08', 'tasks.not_allowed'),
  ('a Done task''s slot, from a top editor',
   '00000000-0000-4000-a000-000000000008', '00000000-0000-4000-c000-000000000081',
   '00000000-0000-4000-a000-000000000012', '2026-10-01T00:00:00+08', 'tasks.not_allowed'),
  ('a Done task''s slot, from someone who isn''t its approver (tasks.not_approver comes first)',
   '00000000-0000-4000-a000-000000000005', '00000000-0000-4000-c000-000000000081',
   '00000000-0000-4000-a000-000000000012', '2026-10-01T00:00:00+08', 'tasks.not_approver'),
  ('a Done task''s slot with an old version (tasks.not_allowed comes first)',
   '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-c000-000000000081',
   '00000000-0000-4000-a000-000000000012', '2026-09-30T00:00:00+08', 'tasks.not_allowed'),
  ('an old version',
   '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-c000-000000000071',
   '00000000-0000-4000-a000-000000000012', '2026-09-30T00:00:00+08', 'tasks.stale'),
  ('a newer version',
   '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-c000-000000000071',
   '00000000-0000-4000-a000-000000000012', '2026-10-01T00:00:00.000001+08', 'tasks.stale'),
  ('no version',
   '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-c000-000000000071',
   '00000000-0000-4000-a000-000000000012', null, 'tasks.stale'),
  ('an old version and a deactivated member (tasks.stale comes first)',
   '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-c000-000000000071',
   '00000000-0000-4000-a000-000000000013', '2026-09-30T00:00:00+08', 'tasks.stale'),
  ('a deactivated member',
   '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-c000-000000000071',
   '00000000-0000-4000-a000-000000000013', '2026-10-01T00:00:00+08', 'tasks.invalid_slot_member'),
  ('a pending member',
   '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-c000-000000000071',
   '00000000-0000-4000-a000-000000000001', '2026-10-01T00:00:00+08', 'tasks.invalid_slot_member'),
  ('an unknown member',
   '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-c000-000000000071',
   '00000000-0000-4000-a000-0000000000ff', '2026-10-01T00:00:00+08', 'tasks.invalid_slot_member'),
  ('no member',
   '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-c000-000000000071',
   null, '2026-10-01T00:00:00+08', 'tasks.invalid_slot_member'),
  ('the slot''s own member, deactivated',
   '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-c000-000000000073',
   '00000000-0000-4000-a000-000000000013', '2026-10-01T00:00:00+08', 'tasks.invalid_slot_member'),
  ('a member who holds the role in another slot',
   '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-c000-000000000074',
   '00000000-0000-4000-a000-000000000002', '2026-10-01T00:00:00+08', 'tasks.duplicate_slot'),
  ('a deactivated member who holds the role in another slot (tasks.invalid_slot_member comes first)',
   '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-c000-000000000075',
   '00000000-0000-4000-a000-000000000013', '2026-10-01T00:00:00+08', 'tasks.invalid_slot_member');

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
      jsonb_build_object('sub', r.caller, 'role', 'authenticated')::text,
      true
    );
    set local role authenticated;
    begin
      perform public.reassign_slot(r.slot_id, r.member_id, r.version);
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
  'every refusal gets its code, in the order the checks run: active, the slot and its live task, the approver, Done, the version, the member, the repeated pair'
);

select set_eq(
  $$ select * from public.task_assignments
     where task_id in ('00000000-0000-4000-b000-000000000007',
                       '00000000-0000-4000-b000-000000000008',
                       '00000000-0000-4000-b000-000000000009') $$,
  $$ select * from refusal_slots_before $$,
  'no refused reassign touched a slot'
);

select is_empty(
  $$ select v.id from public.activity v
     where v.entity_id in (select id from refusal_slots_before) $$,
  'nor logged anything'
);

-- Stale from real answers: the picker on b15 loaded c151 and c152 at their
-- Oct 1 version; the assignee then answers I'm on it on c151 and hands back
-- c152. Each bumps its slot's version to now(), the transaction's start,
-- which pgTAP holds fixed but which isn't Oct 1, so the approver's reassign
-- with the version loaded is refused.

create temp table b15_loaded as
select a.id, a.updated_at
from public.task_assignments a
where a.task_id = '00000000-0000-4000-b000-000000000015';

select lives_ok(
  $$ select pg_temp.exec_as('00000000-0000-4000-a000-000000000002',
       $q$ select public.respond_to_slot('00000000-0000-4000-c000-000000000151', 'on_it') $q$) $$,
  'the assignee answers I''m on it on c151 while the picker is open'
);

select lives_ok(
  $$ select pg_temp.exec_as('00000000-0000-4000-a000-000000000002',
       $q$ select public.hand_back_slot('00000000-0000-4000-c000-000000000152', 'Busy') $q$) $$,
  'and hands back c152'
);

select is_empty(
  $$ select a.id
     from public.task_assignments a
     join b15_loaded l on l.id = a.id
     where a.updated_at is not distinct from l.updated_at
        or a.updated_at <> now() $$,
  'each answer bumped its slot''s version past the one the picker loaded'
);

select is(
  pg_temp.reassign_result('00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-c000-000000000151',
    '00000000-0000-4000-a000-000000000012',
    (select updated_at from b15_loaded
     where id = '00000000-0000-4000-c000-000000000151')),
  'P0001 tasks.stale',
  'a reassign with the version loaded before the I''m on it is tasks.stale'
);

select is(
  pg_temp.reassign_result('00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-c000-000000000152',
    '00000000-0000-4000-a000-000000000012',
    (select updated_at from b15_loaded
     where id = '00000000-0000-4000-c000-000000000152')),
  'P0001 tasks.stale',
  'a reassign with the version loaded before the hand-back is tasks.stale'
);

-- The unfreeze: b10 is in Doing and its only On it slot is handed back, so
-- nobody can move it until the approver reassigns that slot and the new
-- member answers I'm on it.

select lives_ok(
  $$ select pg_temp.exec_as('00000000-0000-4000-a000-000000000002',
       $q$ select public.hand_back_slot('00000000-0000-4000-c000-000000000101', 'Exams') $q$) $$,
  'the assignee hands back the only On it slot of a Doing task'
);

select results_eq(
  $$ select pg_temp.query_as(m.id,
              $q$ select coalesce((select k.allowed_moves::text
                                   from public.task_capabilities(array['00000000-0000-4000-b000-000000000010'::uuid]) k),
                                  'no row') $q$)
     from (values ('00000000-0000-4000-a000-000000000002'::uuid),
                  ('00000000-0000-4000-a000-000000000004'::uuid),
                  ('00000000-0000-4000-a000-000000000012'::uuid)) as m (id) $$,
  $$ values ('{}'::text), ('{}'::text), ('{}'::text) $$,
  'frozen: neither the old assignee, the approver nor a12 is offered a move'
);

select is(
  pg_temp.reassign_result('00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-c000-000000000101',
    '00000000-0000-4000-a000-000000000012',
    (select updated_at from public.task_assignments
     where id = '00000000-0000-4000-c000-000000000101')),
  'ok',
  'the approver reassigns the handed-back slot to a12, with the version the hand-back left'
);

select lives_ok(
  $$ select pg_temp.exec_as('00000000-0000-4000-a000-000000000012',
       $q$ select public.respond_to_slot('00000000-0000-4000-c000-000000000101', 'on_it') $q$) $$,
  'a12 answers I''m on it'
);

select lives_ok(
  $$ select pg_temp.exec_as('00000000-0000-4000-a000-000000000012',
       $q$ select public.move_task('00000000-0000-4000-b000-000000000010', 'for_review') $q$) $$,
  'and moves the task to For Review'
);

select is(
  (select "column"::text from public.tasks
   where id = '00000000-0000-4000-b000-000000000010'),
  'for_review',
  'unfrozen: the task is in For Review'
);

-- The unfreeze after Send back: the approver sends b11 back to Doing, then
-- the assignee hands back its only On it slot.

select lives_ok(
  $$ select pg_temp.exec_as('00000000-0000-4000-a000-000000000004',
       $q$ select public.send_back_task('00000000-0000-4000-b000-000000000011', 'Fix the captions') $q$) $$,
  'the approver sends the task back to Doing'
);

select lives_ok(
  $$ select pg_temp.exec_as('00000000-0000-4000-a000-000000000002',
       $q$ select public.hand_back_slot('00000000-0000-4000-c000-000000000111', null) $q$) $$,
  'the assignee hands back its only On it slot'
);

select results_eq(
  $$ select pg_temp.query_as(m.id,
              $q$ select coalesce((select k.allowed_moves::text
                                   from public.task_capabilities(array['00000000-0000-4000-b000-000000000011'::uuid]) k),
                                  'no row') $q$)
     from (values ('00000000-0000-4000-a000-000000000002'::uuid),
                  ('00000000-0000-4000-a000-000000000004'::uuid),
                  ('00000000-0000-4000-a000-000000000012'::uuid)) as m (id) $$,
  $$ values ('{}'::text), ('{}'::text), ('{}'::text) $$,
  'frozen after Send back: neither the old assignee, the approver nor a12 is offered a move'
);

select is(
  pg_temp.reassign_result('00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-c000-000000000111',
    '00000000-0000-4000-a000-000000000012',
    (select updated_at from public.task_assignments
     where id = '00000000-0000-4000-c000-000000000111')),
  'ok',
  'the approver reassigns the sent-back task''s handed-back slot to a12'
);

select lives_ok(
  $$ select pg_temp.exec_as('00000000-0000-4000-a000-000000000012',
       $q$ select public.respond_to_slot('00000000-0000-4000-c000-000000000111', 'on_it') $q$) $$,
  'a12 answers I''m on it on the sent-back task'
);

select lives_ok(
  $$ select pg_temp.exec_as('00000000-0000-4000-a000-000000000012',
       $q$ select public.move_task('00000000-0000-4000-b000-000000000011', 'for_review') $q$) $$,
  'and moves it to For Review'
);

select results_eq(
  $$ select t."column"::text, t.revision_note is null
     from public.tasks t
     where t.id = '00000000-0000-4000-b000-000000000011' $$,
  $$ values ('for_review'::text, true) $$,
  'unfrozen: the sent-back task is in For Review again, its revision note cleared by the move'
);

-- can_reassign beyond the matrix: never on a Done task, and no row at all
-- for a deleted one.

select results_eq(
  $$ select pg_temp.query_as(m.id,
              $q$ select k.can_manage::text || ',' || k.can_reassign::text
                  from public.task_capabilities(array['00000000-0000-4000-b000-000000000008'::uuid]) k $q$)
     from (values ('00000000-0000-4000-a000-000000000004'::uuid),
                  ('00000000-0000-4000-a000-000000000008'::uuid)) as m (id) $$,
  $$ values ('true,false'::text), ('true,false'::text) $$,
  'on a Done task, its head and a top editor may still manage it but not reassign its slots'
);

select is(
  pg_temp.query_as('00000000-0000-4000-a000-000000000004',
    $q$ select count(*)::text
        from public.task_capabilities(array['00000000-0000-4000-b000-000000000009'::uuid]) $q$),
  '0',
  'task_capabilities returns no row, so no can_reassign, for a deleted task, even to its approver'
);

-- The counts. k1 holds an awaiting and an On it slot (open), a handed-back
-- one, an On it slot on a Done task and an awaiting one on a deleted task;
-- k2 only a handed-back slot; k3 is deactivated; k4 holds nothing.

select results_eq(
  $$ select pg_temp.query_as(m.id,
              $q$ select string_agg(c.member_id::text || ':' || c.open_slots::text,
                                    ',' order by c.member_id)
                  from public.member_open_slot_counts() c
                  where c.member_id in ('00000000-0000-4000-a100-000000000001',
                                        '00000000-0000-4000-a100-000000000002',
                                        '00000000-0000-4000-a100-000000000003',
                                        '00000000-0000-4000-a100-000000000004') $q$)
     from (values ('00000000-0000-4000-a000-000000000003'::uuid),
                  ('00000000-0000-4000-a000-000000000008'::uuid)) as m (id) $$,
  $$ values ('00000000-0000-4000-a100-000000000001:2,00000000-0000-4000-a100-000000000002:0,00000000-0000-4000-a100-000000000004:0'::text),
            ('00000000-0000-4000-a100-000000000001:2,00000000-0000-4000-a100-000000000002:0,00000000-0000-4000-a100-000000000004:0'::text) $$,
  'the counts take awaiting and On it slots only, never on a Done or deleted task, give 0 to a member with none open, list no deactivated member, and are the same for staff and a top editor'
);

select is(
  pg_temp.query_as('00000000-0000-4000-a000-000000000003',
    $q$ select ((select count(*) from public.member_open_slot_counts())
                  = (select count(*) from public.member_directory)
                and (select count(distinct c.member_id)
                     from public.member_open_slot_counts() c)
                  = (select count(*) from public.member_directory))::text $q$),
  'true',
  'there is exactly one row per member_directory member'
);

select is(
  pg_temp.query_as('00000000-0000-4000-a000-000000000003',
    $q$ select bool_and(c.open_slots = (select count(*)
                                        from private.open_slots(c.member_id)))::text
        from public.member_open_slot_counts() c $q$),
  'true',
  'each count is private.open_slots''s, the one definition of an open slot'
);

select results_eq(
  $$ select pg_temp.query_as(m.id,
              $q$ select count(*)::text from public.member_open_slot_counts() $q$)
     from (values ('00000000-0000-4000-a000-000000000001'::uuid),
                  ('00000000-0000-4000-a000-000000000013'::uuid)) as m (id) $$,
  $$ values ('0'::text), ('0'::text) $$,
  'a pending or deactivated caller gets no rows'
);

select * from finish();

rollback;
