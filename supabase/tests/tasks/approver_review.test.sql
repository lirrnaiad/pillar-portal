-- Approver review (Story 3.1, AD-1, AD-4, AD-16): mark_done, send_back_task
-- and reopen_task, the review helpers behind them and task_capabilities'
-- can_review and can_reopen. Covers the approver matrix, stale from every
-- wrong column, the revision note's rules and CHECKs, done_at, activity, the
-- Done slot through Reopen, and the definer/owner/search_path and lock pins
-- (including the lock order: a slot command locks its slot, then the task; a
-- task command locks only the task).
--
-- Fixtures follow responses_and_moves.test.sql: auth users, tasks and slots
-- are created here (tasks and slots inserted directly as `postgres`, so a
-- test can start from any column), so the test doesn't depend on seed.sql;
-- everything is rolled back. It runs locally and on staging
-- (`supabase test db --linked`), seeded or not.

begin;

-- See responses_and_moves.test.sql: run as `postgres` with `extensions` on the
-- path, whichever role `supabase test db --linked` connected as.
set local role postgres;
set local search_path = "$user", public, extensions;

select plan(61);

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

-- A Done task carries done_at (tasks_done_at_matches_column).
create function pg_temp.new_task(
  p_id uuid,
  p_section text,
  p_desk text,
  p_column public.task_column
)
returns void
language sql as $$
  insert into public.tasks (
    id, title, owning_section_id, owning_desk_id, due_at, "column", done_at
  )
  values (p_id, 'Fixture task ' || p_id, p_section, p_desk,
          '2026-11-01T00:00:00+08', p_column,
          case when p_column = 'done' then now() end)
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

-- Callers, as in responses_and_moves.test.sql. Each active one holds one
-- primary position.
select pg_temp.new_member('00000000-0000-4000-a000-000000000001', 'ar-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-000000000002', 'ar-assignee@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000003', 'ar-staff@example.com', 'staff_writer');
select pg_temp.new_member('00000000-0000-4000-a000-000000000004', 'ar-head-layout@example.com', 'head_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000005', 'ar-head-cartoonist@example.com', 'head_cartoonist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000006', 'ar-news-editor@example.com', 'news_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000007', 'ar-sports-editor@example.com', 'sports_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000008', 'ar-eic@example.com', 'editor_in_chief');
select pg_temp.new_member('00000000-0000-4000-a000-000000000009', 'ar-associate@example.com', 'associate_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000010', 'ar-managing@example.com', 'managing_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000011', 'ar-finance@example.com', 'finance_manager');

-- Matrix tasks, never changed (every probe is rolled back), one per owner in
-- For Review and in Done, each with the assignee On it:
--   b01 Layout, b02 News, b03 Opinion, b04 Editorial: For Review
--   b05 Layout, b06 News, b07 Opinion, b08 Editorial: Done
select pg_temp.new_task('00000000-0000-4000-b000-000000000001', null, 'layout', 'for_review');
select pg_temp.new_task('00000000-0000-4000-b000-000000000002', 'news', null, 'for_review');
select pg_temp.new_task('00000000-0000-4000-b000-000000000003', 'opinion', null, 'for_review');
select pg_temp.new_task('00000000-0000-4000-b000-000000000004', 'editorial', null, 'for_review');
select pg_temp.new_task('00000000-0000-4000-b000-000000000005', null, 'layout', 'done');
select pg_temp.new_task('00000000-0000-4000-b000-000000000006', 'news', null, 'done');
select pg_temp.new_task('00000000-0000-4000-b000-000000000007', 'opinion', null, 'done');
select pg_temp.new_task('00000000-0000-4000-b000-000000000008', 'editorial', null, 'done');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000003', '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000004', '00000000-0000-4000-b000-000000000004', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000005', '00000000-0000-4000-b000-000000000005', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000006', '00000000-0000-4000-b000-000000000006', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000007', '00000000-0000-4000-b000-000000000007', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000008', '00000000-0000-4000-b000-000000000008', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');

-- Flow tasks, changed in order below (all Layout, the assignee On it):
--   b11 For Review: send back, move, mark done, reopen
--   b12 For Review: the note rules
--   b13 For Review, with a revision note: mark done clears it
--   b14 Done, with a revision note: reopen clears it
select pg_temp.new_task('00000000-0000-4000-b000-000000000011', null, 'layout', 'for_review');
select pg_temp.new_task('00000000-0000-4000-b000-000000000012', null, 'layout', 'for_review');
select pg_temp.new_task('00000000-0000-4000-b000-000000000013', null, 'layout', 'for_review');
select pg_temp.new_task('00000000-0000-4000-b000-000000000014', null, 'layout', 'done');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000011', '00000000-0000-4000-b000-000000000011', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000012', '00000000-0000-4000-b000-000000000012', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000013', '00000000-0000-4000-b000-000000000013', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000014', '00000000-0000-4000-b000-000000000014', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
update public.tasks
set revision_note = 'Old note',
    revision_note_by = '00000000-0000-4000-a000-000000000004',
    revision_note_at = now()
where id in ('00000000-0000-4000-b000-000000000013',
             '00000000-0000-4000-b000-000000000014');

-- Stale tasks, never changed: one Layout task per column.
--   b21 To Do, b22 Doing, b23 For Review, b24 Done
select pg_temp.new_task('00000000-0000-4000-b000-000000000021', null, 'layout', 'to_do');
select pg_temp.new_task('00000000-0000-4000-b000-000000000022', null, 'layout', 'doing');
select pg_temp.new_task('00000000-0000-4000-b000-000000000023', null, 'layout', 'for_review');
select pg_temp.new_task('00000000-0000-4000-b000-000000000024', null, 'layout', 'done');

-- The Done slot: b31 Done, c31 the assignee's awaiting slot.
select pg_temp.new_task('00000000-0000-4000-b000-000000000031', null, 'layout', 'done');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000031', '00000000-0000-4000-b000-000000000031', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'awaiting_response');

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

create function pg_temp.mark_done_as(p_caller uuid, p_task uuid)
returns void
language plpgsql as $$
begin
  perform pg_temp.as_caller(p_caller);
  perform public.mark_done(p_task);
  set local role postgres;
end;
$$;

create function pg_temp.send_back_as(p_caller uuid, p_task uuid, p_note text)
returns void
language plpgsql as $$
begin
  perform pg_temp.as_caller(p_caller);
  perform public.send_back_task(p_task, p_note);
  set local role postgres;
end;
$$;

create function pg_temp.reopen_as(p_caller uuid, p_task uuid)
returns void
language plpgsql as $$
begin
  perform pg_temp.as_caller(p_caller);
  perform public.reopen_task(p_task);
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

create function pg_temp.respond_as(
  p_caller uuid,
  p_slot uuid,
  p_response public.slot_state
)
returns void
language plpgsql as $$
begin
  perform pg_temp.as_caller(p_caller);
  perform public.respond_to_slot(p_slot, p_response);
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

-- Pins: the helpers and commands are security definer, owned by postgres,
-- with an empty search_path.

select is_definer('private', 'can_review_task', array['uuid'],
  'private.can_review_task(uuid) is security definer');
select function_owner_is('private', 'can_review_task', array['uuid'], 'postgres',
  'private.can_review_task(uuid) is owned by postgres');
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'private.can_review_task(uuid)'::regprocedure),
  array['search_path=""'],
  'private.can_review_task(uuid) sets search_path = '''''
);

select is_definer('private', 'can_reopen_task', array['uuid'],
  'private.can_reopen_task(uuid) is security definer');
select function_owner_is('private', 'can_reopen_task', array['uuid'], 'postgres',
  'private.can_reopen_task(uuid) is owned by postgres');
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'private.can_reopen_task(uuid)'::regprocedure),
  array['search_path=""'],
  'private.can_reopen_task(uuid) sets search_path = '''''
);

select is_definer('public', 'mark_done', array['uuid'],
  'public.mark_done(uuid) is security definer');
select function_owner_is('public', 'mark_done', array['uuid'], 'postgres',
  'public.mark_done(uuid) is owned by postgres');
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'public.mark_done(uuid)'::regprocedure),
  array['search_path=""'],
  'public.mark_done(uuid) sets search_path = '''''
);

select is_definer('public', 'send_back_task', array['uuid', 'text'],
  'public.send_back_task(uuid, text) is security definer');
select function_owner_is('public', 'send_back_task', array['uuid', 'text'], 'postgres',
  'public.send_back_task(uuid, text) is owned by postgres');
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'public.send_back_task(uuid, text)'::regprocedure),
  array['search_path=""'],
  'public.send_back_task(uuid, text) sets search_path = '''''
);

select is_definer('public', 'reopen_task', array['uuid'],
  'public.reopen_task(uuid) is security definer');
select function_owner_is('public', 'reopen_task', array['uuid'], 'postgres',
  'public.reopen_task(uuid) is owned by postgres');
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'public.reopen_task(uuid)'::regprocedure),
  array['search_path=""'],
  'public.reopen_task(uuid) sets search_path = '''''
);

-- Locks. A slot command locks its slot, then the task, and only then asks
-- its helper (one call), so a Mark done can't commit between the check and
-- the write. A task command locks the task once and its own body never
-- mentions task_assignments (its helper may read it, never lock it).

select ok(
  pg_get_functiondef('public.respond_to_slot(uuid, public.slot_state, text)'::regprocedure)
    ~* 'from\s+public\.task_assignments\s+a\s+where\s+a\.id\s*=\s*respond_to_slot\.slot_id\s+for\s+update\s*;.*for\s+update\s+of\s+t\s*;.*private\.can_respond_to_slot\('
    and (select count(*) from regexp_matches(
           pg_get_functiondef('public.respond_to_slot(uuid, public.slot_state, text)'::regprocedure),
           'can_respond_to_slot\(', 'g')) = 1,
  'public.respond_to_slot(...) locks the slot FOR UPDATE, then its task, before checking can_respond_to_slot'
);
select ok(
  pg_get_functiondef('public.hand_back_slot(uuid, text)'::regprocedure)
    ~* 'from\s+public\.task_assignments\s+a\s+where\s+a\.id\s*=\s*hand_back_slot\.slot_id\s+for\s+update\s*;.*for\s+update\s+of\s+t\s*;.*private\.can_hand_back_slot\('
    and (select count(*) from regexp_matches(
           pg_get_functiondef('public.hand_back_slot(uuid, text)'::regprocedure),
           'can_hand_back_slot\(', 'g')) = 1,
  'public.hand_back_slot(...) locks the slot FOR UPDATE, then its task, before checking can_hand_back_slot'
);

create temp table task_commands (signature regprocedure primary key);
insert into task_commands values
  ('public.move_task(uuid, public.task_column)'),
  ('public.mark_done(uuid)'),
  ('public.send_back_task(uuid, text)'),
  ('public.reopen_task(uuid)');

select is_empty(
  $$ select signature::text from task_commands
     where pg_get_functiondef(signature)
             !~* 'from\s+public\.tasks\s+t\s+where\s+t\.id\s*=\s*\w+\.task_id\s+for\s+update\s*;'
        or (select count(*) from regexp_matches(pg_get_functiondef(signature), 'for\s+update', 'gi')) <> 1 $$,
  'move_task, mark_done, send_back_task and reopen_task each lock the task FOR UPDATE, once'
);
select is_empty(
  $$ select signature::text from task_commands
     where pg_get_functiondef(signature) ~* 'task_assignments' $$,
  'no task command''s body mentions task_assignments, so none locks a slot after its task'
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
  ('staff assignee (On it on every task)',
   '00000000-0000-4000-a000-000000000002', false, false, false, false),
  ('other staff', '00000000-0000-4000-a000-000000000003', false, false, false, false),
  ('Head Cartoonist (another desk''s Head)',
   '00000000-0000-4000-a000-000000000005', false, false, false, false),
  ('Sports Editor (another section''s editor)',
   '00000000-0000-4000-a000-000000000007', false, false, false, false),
  ('Finance Manager (on the Board, not an approver)',
   '00000000-0000-4000-a000-000000000011', false, false, false, false),
  ('pending', '00000000-0000-4000-a000-000000000001', false, false, false, false);

-- Each owner's For Review task and Done task.
create temp table matrix_tasks (
  owner text primary key,
  review_task uuid not null,
  done_task uuid not null
);

insert into matrix_tasks values
  ('layout', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-b000-000000000005'),
  ('news', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-b000-000000000006'),
  ('opinion', '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-b000-000000000007'),
  ('editorial', '00000000-0000-4000-b000-000000000004', '00000000-0000-4000-b000-000000000008');

create temp table matrix_allowed as
select c.label, c.member_id, a.owner, a.allowed
from matrix_callers c
cross join lateral (
  values ('layout', c.layout), ('news', c.news),
         ('opinion', c.opinion), ('editorial', c.editorial)
) as a (owner, allowed);

-- Command results are `ok` (accepted, then rolled back) or
-- `<sqlstate> <message>`.
create temp table matrix_expected as
select m.label,
       m.owner,
       cmd.command,
       case
         when m.label = 'pending' then 'P0001 auth.not_active'
         when m.allowed then 'ok'
         else 'P0001 tasks.not_approver'
       end as result
from matrix_allowed m
cross join (
  values ('mark_done'), ('send_back_task'), ('reopen_task')
) as cmd (command);

create temp table matrix_observed (like matrix_expected);

-- task_capabilities per caller on the matrix tasks. Only the assignee moves,
-- and only among To Do, Doing and For Review; nobody is offered Done or a
-- move out of it. A pending caller reads no task, so gets no row at all.
create temp table caps_expected as
select m.label,
       k.task_id,
       case when m.label like 'staff assignee%' and k.is_review
         then '{to_do,doing}' else '{}' end as allowed_moves,
       m.allowed and k.is_review as can_review,
       m.allowed and not k.is_review as can_reopen
from matrix_allowed m
join (
  select owner, review_task as task_id, true as is_review from matrix_tasks
  union all
  select owner, done_task, false from matrix_tasks
) as k on k.owner = m.owner
where m.label <> 'pending';

create temp table caps_observed (like caps_expected);
create temp table probe_disagreements (disagreement text);

do $$
declare
  v_callers matrix_callers[];
  c matrix_callers;
  v_tasks matrix_tasks[];
  t matrix_tasks;
  v_all_tasks uuid[];
  v_results text[];
  v_owners text[];
  v_commands text[];
  v_caps_tasks uuid[];
  v_caps_moves text[];
  v_caps_review boolean[];
  v_caps_reopen boolean[];
  v_disagreements text[] := '{}';
  v_column public.task_column;
  v_result text;
  v_offered boolean;
begin
  -- Read the fixtures while still `postgres`: `authenticated` can't read
  -- temp tables.
  select array_agg(x) into v_callers from matrix_callers x;
  select array_agg(x) into v_tasks from matrix_tasks x;
  select array_agg(id) into v_all_tasks
  from (
    select review_task as id from matrix_tasks
    union all
    select done_task from matrix_tasks
  ) ids;

  foreach c in array v_callers loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', c.member_id, 'role', 'authenticated')::text,
      true
    );
    set local role authenticated;

    v_results := '{}';
    v_owners := '{}';
    v_commands := '{}';

    foreach t in array v_tasks loop
      -- Each command in its own subtransaction; an accepted one raises a
      -- sentinel, so its writes roll back.
      begin
        perform public.mark_done(t.review_task);
        raise exception using errcode = 'P0001', message = 'probe.accepted';
      exception when others then
        v_result := case when sqlerrm = 'probe.accepted' then 'ok'
                         else sqlstate || ' ' || sqlerrm end;
      end;
      v_owners := v_owners || t.owner;
      v_commands := v_commands || 'mark_done'::text;
      v_results := v_results || v_result;
      v_offered := coalesce((
        select k.can_review from public.task_capabilities(array[t.review_task]) k
      ), false);
      if v_offered is distinct from (v_result = 'ok') then
        v_disagreements := v_disagreements || format(
          '%s: mark_done on %s offered %s, got %s', c.label, t.owner, v_offered, v_result);
      end if;

      begin
        perform public.send_back_task(t.review_task, 'Probe note');
        raise exception using errcode = 'P0001', message = 'probe.accepted';
      exception when others then
        v_result := case when sqlerrm = 'probe.accepted' then 'ok'
                         else sqlstate || ' ' || sqlerrm end;
      end;
      v_owners := v_owners || t.owner;
      v_commands := v_commands || 'send_back_task'::text;
      v_results := v_results || v_result;
      if v_offered is distinct from (v_result = 'ok') then
        v_disagreements := v_disagreements || format(
          '%s: send_back_task on %s offered %s, got %s', c.label, t.owner, v_offered, v_result);
      end if;

      begin
        perform public.reopen_task(t.done_task);
        raise exception using errcode = 'P0001', message = 'probe.accepted';
      exception when others then
        v_result := case when sqlerrm = 'probe.accepted' then 'ok'
                         else sqlstate || ' ' || sqlerrm end;
      end;
      v_owners := v_owners || t.owner;
      v_commands := v_commands || 'reopen_task'::text;
      v_results := v_results || v_result;
      v_offered := coalesce((
        select k.can_reopen from public.task_capabilities(array[t.done_task]) k
      ), false);
      if v_offered is distinct from (v_result = 'ok') then
        v_disagreements := v_disagreements || format(
          '%s: reopen_task on %s offered %s, got %s', c.label, t.owner, v_offered, v_result);
      end if;

      -- No move reaches Done, and none leaves it.
      begin
        perform public.move_task(t.review_task, 'done');
        raise exception using errcode = 'P0001', message = 'probe.accepted';
      exception when others then
        if sqlerrm = 'probe.accepted' then
          v_disagreements := v_disagreements || format(
            '%s: move_task to done on %s was accepted', c.label, t.owner);
        end if;
      end;
      foreach v_column in array enum_range(null::public.task_column) loop
        begin
          perform public.move_task(t.done_task, v_column);
          raise exception using errcode = 'P0001', message = 'probe.accepted';
        exception when others then
          if sqlerrm = 'probe.accepted' then
            v_disagreements := v_disagreements || format(
              '%s: move_task out of done to %s on %s was accepted',
              c.label, v_column, t.owner);
          end if;
        end;
      end loop;
    end loop;

    select coalesce(array_agg(k.task_id order by k.task_id), '{}'),
           coalesce(array_agg(k.allowed_moves::text order by k.task_id), '{}'),
           coalesce(array_agg(k.can_review order by k.task_id), '{}'),
           coalesce(array_agg(k.can_reopen order by k.task_id), '{}')
      into v_caps_tasks, v_caps_moves, v_caps_review, v_caps_reopen
    from public.task_capabilities(v_all_tasks) k;

    set local role postgres;

    insert into matrix_observed
    select c.label, o.owner, o.command, o.result
    from unnest(v_owners, v_commands, v_results) as o (owner, command, result);

    insert into caps_observed
    select c.label, o.task_id, o.moves, o.review, o.reopen
    from unnest(v_caps_tasks, v_caps_moves, v_caps_review, v_caps_reopen)
      as o (task_id, moves, review, reopen);
  end loop;

  insert into probe_disagreements select unnest(v_disagreements);
  perform set_config('request.jwt.claims', '', true);
end
$$;

select set_eq(
  $$ select * from matrix_observed $$,
  $$ select * from matrix_expected $$,
  'mark_done, send_back_task and reopen_task accept the owner''s head and the three top editors (top editors only on Opinion and Editorial), refuse everyone else with tasks.not_approver, and a pending caller with auth.not_active'
);

select set_eq(
  $$ select * from caps_observed $$,
  $$ select * from caps_expected $$,
  'task_capabilities offers can_review on For Review and can_reopen on Done to the approver only, and no allowed_moves contains or leaves done'
);

select is_empty(
  $$ select * from probe_disagreements $$,
  'can_review and can_reopen agree with what the commands accept, and no move into or out of done is accepted'
);

select is(
  (select count(*) from public.activity
   where entity_id in (select review_task from matrix_tasks
                       union all select done_task from matrix_tasks)),
  0::bigint,
  'every accepted matrix probe was rolled back'
);

-- Stale: the approver gets tasks.stale from every column but the one the
-- command needs; someone who isn't the approver gets tasks.not_approver
-- whatever the column. send_back_task checks the note only after both.

create temp table stale_expected as
select c.caller,
       k.col,
       cmd.command,
       case
         when c.caller = 'not approver' then 'P0001 tasks.not_approver'
         when k.col <> cmd.needs then 'P0001 tasks.stale'
         when cmd.command = 'send_back_task (blank note)' then 'P0001 tasks.invalid_note'
         else 'ok'
       end as result
from (values ('approver'), ('not approver')) as c (caller)
cross join (values ('to_do'), ('doing'), ('for_review'), ('done')) as k (col)
cross join (
  values ('mark_done', 'for_review'),
         ('send_back_task', 'for_review'),
         ('send_back_task (blank note)', 'for_review'),
         ('reopen_task', 'done')
) as cmd (command, needs);

create temp table stale_observed (like stale_expected);

do $$
declare
  v_callers constant text[] := array['approver', 'not approver'];
  v_members constant uuid[] := array[
    '00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-a000-000000000005'
  ]::uuid[];
  v_cols constant text[] := array['to_do', 'doing', 'for_review', 'done'];
  v_tasks constant uuid[] := array[
    '00000000-0000-4000-b000-000000000021',
    '00000000-0000-4000-b000-000000000022',
    '00000000-0000-4000-b000-000000000023',
    '00000000-0000-4000-b000-000000000024'
  ]::uuid[];
  v_commands constant text[] := array[
    'mark_done', 'send_back_task', 'send_back_task (blank note)', 'reopen_task'
  ];
  v_obs_callers text[] := '{}';
  v_obs_cols text[] := '{}';
  v_obs_commands text[] := '{}';
  v_obs_results text[] := '{}';
  v_command text;
begin
  for i in 1 .. array_length(v_members, 1) loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_members[i], 'role', 'authenticated')::text,
      true
    );
    set local role authenticated;

    for j in 1 .. array_length(v_tasks, 1) loop
      foreach v_command in array v_commands loop
        begin
          case v_command
            when 'mark_done' then
              perform public.mark_done(v_tasks[j]);
            when 'send_back_task' then
              perform public.send_back_task(v_tasks[j], 'Probe note');
            when 'send_back_task (blank note)' then
              perform public.send_back_task(v_tasks[j], E'  \t\n ');
            when 'reopen_task' then
              perform public.reopen_task(v_tasks[j]);
          end case;
          raise exception using errcode = 'P0001', message = 'probe.accepted';
        exception when others then
          v_obs_callers := v_obs_callers || v_callers[i];
          v_obs_cols := v_obs_cols || v_cols[j];
          v_obs_commands := v_obs_commands || v_command;
          v_obs_results := v_obs_results || case
            when sqlerrm = 'probe.accepted' then 'ok'
            else sqlstate || ' ' || sqlerrm
          end;
        end;
      end loop;
    end loop;

    set local role postgres;
  end loop;

  insert into stale_observed
  select *
  from unnest(v_obs_callers, v_obs_cols, v_obs_commands, v_obs_results);
  perform set_config('request.jwt.claims', '', true);
end
$$;

select set_eq(
  $$ select * from stale_observed $$,
  $$ select * from stale_expected $$,
  'the approver gets tasks.stale from every wrong column, a non-approver tasks.not_approver from every column, and a blank note is checked only after both'
);

-- Missing tasks.

select throws_ok(
  $$ select pg_temp.mark_done_as('00000000-0000-4000-a000-000000000008',
       '00000000-0000-4000-9999-000000000000') $$,
  'P0001', 'tasks.not_found',
  'mark_done on an unknown task gets tasks.not_found'
);
select throws_ok(
  $$ select pg_temp.send_back_as('00000000-0000-4000-a000-000000000008',
       '00000000-0000-4000-9999-000000000000', 'Note') $$,
  'P0001', 'tasks.not_found',
  'send_back_task on an unknown task gets tasks.not_found'
);
select throws_ok(
  $$ select pg_temp.reopen_as('00000000-0000-4000-a000-000000000008',
       '00000000-0000-4000-9999-000000000000') $$,
  'P0001', 'tasks.not_found',
  'reopen_task on an unknown task gets tasks.not_found'
);

-- The helpers answer false, not null, for a missing task and a pending
-- caller.

select is(
  pg_temp.query_as(
    '00000000-0000-4000-a000-000000000008',
    $q$ select (private.can_review_task('00000000-0000-4000-9999-000000000000')
                or private.can_reopen_task('00000000-0000-4000-9999-000000000000'))::text $q$
  ),
  'false',
  'a top editor gets false from both review helpers for an id that doesn''t exist'
);
select is(
  pg_temp.query_as(
    '00000000-0000-4000-a000-000000000001',
    $q$ select (private.can_review_task('00000000-0000-4000-b000-000000000001')
                or private.can_reopen_task('00000000-0000-4000-b000-000000000005'))::text $q$
  ),
  'false',
  'a pending caller gets false from both review helpers'
);

-- The flow on b11: send back, the assignee's move, mark done, reopen.

select lives_ok(
  $$ select pg_temp.send_back_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-b000-000000000011', E'  fix captions \n') $$,
  'Send back: the Head Layout Artist sends a For Review task back with a note'
);

select results_eq(
  $$ select "column"::text, revision_note, revision_note_by,
            revision_note_at is not null, done_at is null
     from public.tasks where id = '00000000-0000-4000-b000-000000000011' $$,
  $$ values ('doing', 'fix captions', '00000000-0000-4000-a000-000000000004'::uuid,
             true, true) $$,
  'the task is in Doing, with the note trimmed, its author and its time'
);

select lives_ok(
  $$ select pg_temp.move_as('00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-b000-000000000011', 'for_review') $$,
  'the assignee moves it to For Review again'
);

select results_eq(
  $$ select "column"::text, revision_note, revision_note_by, revision_note_at
     from public.tasks where id = '00000000-0000-4000-b000-000000000011' $$,
  $$ values ('for_review', null::text, null::uuid, null::timestamptz) $$,
  'move_task clears the revision note, its author and its time'
);

select lives_ok(
  $$ select pg_temp.mark_done_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-b000-000000000011') $$,
  'Mark done: the Head Layout Artist marks it done'
);

select results_eq(
  $$ select "column"::text, done_at is not null
     from public.tasks where id = '00000000-0000-4000-b000-000000000011' $$,
  $$ values ('done', true) $$,
  'the task is Done, with done_at set'
);

select throws_ok(
  $$ select pg_temp.mark_done_as('00000000-0000-4000-a000-000000000008',
       '00000000-0000-4000-b000-000000000011') $$,
  'P0001', 'tasks.stale',
  'a second approver''s Mark done on the same task, now Done, gets tasks.stale'
);

select lives_ok(
  $$ select pg_temp.reopen_as('00000000-0000-4000-a000-000000000008',
       '00000000-0000-4000-b000-000000000011') $$,
  'Reopen: the Editor-in-Chief reopens it'
);

select results_eq(
  $$ select "column"::text, done_at
     from public.tasks where id = '00000000-0000-4000-b000-000000000011' $$,
  $$ values ('doing', null::timestamptz) $$,
  'the task is in Doing, with done_at cleared'
);

select bag_eq(
  $$ select action, actor_id from public.activity
     where entity_type = 'task'
       and entity_id = '00000000-0000-4000-b000-000000000011' $$,
  $$ values ('sent_back', '00000000-0000-4000-a000-000000000004'::uuid),
            ('moved_to_for_review', '00000000-0000-4000-a000-000000000002'::uuid),
            ('marked_done', '00000000-0000-4000-a000-000000000004'::uuid),
            ('reopened', '00000000-0000-4000-a000-000000000008'::uuid) $$,
  'each command logs one task activity row, by its actor: sent_back, marked_done, reopened'
);

select is(
  (select count(*) from public.activity
   where to_jsonb(activity)::text like '%fix captions%'),
  0::bigint,
  'no activity row holds the revision note'
);

-- Mark done and Reopen clear a standing note too.

select lives_ok(
  $$ select pg_temp.mark_done_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-b000-000000000013') $$,
  'Mark done on a For Review task that still has a note'
);
select lives_ok(
  $$ select pg_temp.reopen_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-b000-000000000014') $$,
  'Reopen on a Done task that still has a note'
);
select results_eq(
  $$ select id, "column"::text, revision_note, revision_note_by, revision_note_at
     from public.tasks
     where id in ('00000000-0000-4000-b000-000000000013',
                  '00000000-0000-4000-b000-000000000014')
     order by id $$,
  $$ values ('00000000-0000-4000-b000-000000000013'::uuid, 'done', null::text, null::uuid, null::timestamptz),
            ('00000000-0000-4000-b000-000000000014'::uuid, 'doing', null::text, null::uuid, null::timestamptz) $$,
  'mark_done and reopen_task clear the revision note, its author and its time'
);

-- The note rules on b12 (For Review): blank, missing or over 5,000
-- characters once trimmed is refused; 5,000 once trimmed is stored.

select throws_ok(
  $$ select pg_temp.send_back_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-b000-000000000012', E' \t\n ') $$,
  'P0001', 'tasks.invalid_note',
  'a blank note gets tasks.invalid_note'
);
select throws_ok(
  $$ select pg_temp.send_back_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-b000-000000000012', null) $$,
  'P0001', 'tasks.invalid_note',
  'a missing note gets tasks.invalid_note'
);
select throws_ok(
  $$ select pg_temp.send_back_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-b000-000000000012', repeat('x', 5001)) $$,
  'P0001', 'tasks.invalid_note',
  'a note of 5,001 characters gets tasks.invalid_note'
);
select results_eq(
  $$ select "column"::text, revision_note,
            (select count(*)::int from public.activity v
             where v.entity_id = t.id)
     from public.tasks t where t.id = '00000000-0000-4000-b000-000000000012' $$,
  $$ values ('for_review', null::text, 0) $$,
  'a refused note writes nothing'
);
select lives_ok(
  $$ select pg_temp.send_back_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-b000-000000000012', '  ' || repeat('x', 5000) || E'\n') $$,
  'a note of 5,000 characters once trimmed is accepted'
);
select is(
  (select char_length(revision_note) from public.tasks
   where id = '00000000-0000-4000-b000-000000000012'),
  5000,
  'and stored at 5,000 characters'
);

-- The CHECKs, written directly as postgres (no command can break them).

select throws_ok(
  $$ update public.tasks
     set revision_note = ' padded ',
         revision_note_by = '00000000-0000-4000-a000-000000000004',
         revision_note_at = now()
     where id = '00000000-0000-4000-b000-000000000021' $$,
  '23514', 'new row for relation "tasks" violates check constraint "tasks_revision_note_format"',
  'an untrimmed note is refused by tasks_revision_note_format'
);
select throws_ok(
  $$ update public.tasks
     set revision_note = '',
         revision_note_by = '00000000-0000-4000-a000-000000000004',
         revision_note_at = now()
     where id = '00000000-0000-4000-b000-000000000021' $$,
  '23514', 'new row for relation "tasks" violates check constraint "tasks_revision_note_format"',
  'an empty note is refused by tasks_revision_note_format'
);
select throws_ok(
  $$ update public.tasks
     set revision_note = repeat('x', 5001),
         revision_note_by = '00000000-0000-4000-a000-000000000004',
         revision_note_at = now()
     where id = '00000000-0000-4000-b000-000000000021' $$,
  '23514', 'new row for relation "tasks" violates check constraint "tasks_revision_note_format"',
  'a note of 5,001 characters is refused by tasks_revision_note_format'
);
select throws_ok(
  $$ update public.tasks
     set revision_note = 'No author'
     where id = '00000000-0000-4000-b000-000000000021' $$,
  '23514', 'new row for relation "tasks" violates check constraint "tasks_revision_note_complete"',
  'a note without its author and time is refused by tasks_revision_note_complete'
);
select throws_ok(
  $$ update public.tasks
     set revision_note_by = '00000000-0000-4000-a000-000000000004',
         revision_note_at = now()
     where id = '00000000-0000-4000-b000-000000000021' $$,
  '23514', 'new row for relation "tasks" violates check constraint "tasks_revision_note_complete"',
  'an author and time without a note are refused by tasks_revision_note_complete'
);
select throws_ok(
  $$ update public.tasks set "column" = 'done'
     where id = '00000000-0000-4000-b000-000000000021' $$,
  '23514', 'new row for relation "tasks" violates check constraint "tasks_done_at_matches_column"',
  'a Done task without done_at is refused by tasks_done_at_matches_column'
);
select throws_ok(
  $$ update public.tasks set done_at = now()
     where id = '00000000-0000-4000-b000-000000000021' $$,
  '23514', 'new row for relation "tasks" violates check constraint "tasks_done_at_matches_column"',
  'done_at on a task that isn''t Done is refused by tasks_done_at_matches_column'
);

-- The Done slot: an awaiting slot on a Done task is neither open nor
-- respondable, and is both again once the task is reopened.

select is(
  pg_temp.query_as(
    '00000000-0000-4000-a000-000000000002',
    $q$ select (select respondable_slot_ids::text from public.task_capabilities(
                  '{00000000-0000-4000-b000-000000000031}'))
               || ' ' ||
               (select count(*)::text from public.my_open_slots()
                where id = '00000000-0000-4000-c000-000000000031') $q$
  ),
  '{} 0',
  'an awaiting slot on a Done task isn''t offered for a response and isn''t open'
);
select throws_ok(
  $$ select pg_temp.respond_as('00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-c000-000000000031', 'on_it') $$,
  'P0001', 'tasks.not_allowed',
  'respond_to_slot refuses an awaiting slot on a Done task'
);
select lives_ok(
  $$ select pg_temp.reopen_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-b000-000000000031') $$,
  'the Head Layout Artist reopens the task'
);
select is(
  pg_temp.query_as(
    '00000000-0000-4000-a000-000000000002',
    $q$ select (select respondable_slot_ids::text from public.task_capabilities(
                  '{00000000-0000-4000-b000-000000000031}'))
               || ' ' ||
               (select count(*)::text from public.my_open_slots()
                where id = '00000000-0000-4000-c000-000000000031') $q$
  ),
  '{00000000-0000-4000-c000-000000000031} 1',
  'after Reopen the slot is offered for a response and open again'
);
select lives_ok(
  $$ select pg_temp.respond_as('00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-c000-000000000031', 'on_it') $$,
  'and the assignee answers it'
);

select * from finish();

rollback;
