-- Operations records (Story 2.4): job_runs and error_events, their three
-- service_role commands and the health ping.
--
-- - Reads: the four spine callers (pending, declined, a deactivated former
--   admin who still holds Head Layout Artist, active staff) read no row of
--   either table, and an active admin reads every row. Table-driven, as in
--   members/account_states.test.sql: one set_eq compares what each caller
--   reads with `expected`. Nobody writes either table directly.
-- - The commands' definer/owner/search_path pins and grants, every
--   begin_job_run/end_job_run row of the story's I/O Matrix, and the CHECKs
--   that mirror the server's sanitizer.
--
-- Job names here start `pgtap_`, so a real `backup` or `daily` run can't
-- change what begin_job_run does. Fixtures are created here and rolled back,
-- so the test doesn't depend on seed.sql. It runs locally and on staging
-- (`supabase test db --linked`).

begin;

-- See members/members.test.sql: run as `postgres` with `extensions` on the
-- path, whichever role `supabase test db --linked` connected as.
set local role postgres;
set local search_path = "$user", public, extensions;

select plan(27);

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

-- Attempts one statement as the current role: `ok` when accepted (then
-- rolled back by the sentinel), `23514 <constraint>` for a CHECK, else
-- `<sqlstate> <message>`.
create function pg_temp.attempt(p_call text)
returns text
language plpgsql as $$
declare
  v_constraint text;
begin
  execute p_call;
  raise exception using errcode = 'P0001', message = 'probe.accepted';
exception when others then
  get stacked diagnostics v_constraint = constraint_name;
  return case
    when sqlerrm = 'probe.accepted' then 'ok'
    when sqlstate = '23514' then sqlstate || ' ' || v_constraint
    else sqlstate || ' ' || sqlerrm
  end;
end;
$$;

-- The same, as the caller. The subtransaction's rollback also puts the role
-- back to `postgres`.
create function pg_temp.attempt_as(p_caller uuid, p_call text)
returns text
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_caller, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    execute p_call;
    raise exception using errcode = 'P0001', message = 'probe.accepted';
  exception when others then
    return case when sqlerrm = 'probe.accepted' then 'ok'
                else sqlstate || ' ' || sqlerrm end;
  end;
end;
$$;

-- a0..01 pending, 02 declined, 03 deactivated former Head Layout Artist,
-- 04 active staff (Staff Layout Artist), 05 active admin (Sports Editor).
select pg_temp.new_member('00000000-0000-4000-a000-000000000001', 'op-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-000000000002', 'op-declined@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-000000000003', 'op-deactivated@example.com', 'head_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000004', 'op-staff@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000005', 'op-admin@example.com', 'sports_editor');

update public.members set declined_at = now()
where id = '00000000-0000-4000-a000-000000000002';
update public.members set deactivated_at = now()
where id = '00000000-0000-4000-a000-000000000003';

-- One row in each table, through the commands, so every reader has
-- something to see or not.
select public.end_job_run(public.begin_job_run('pgtap_fixture'), 'ok', null);
select public.record_error_event('42501', 'action moveTaskAction', 'task',
  '00000000-0000-4000-a100-000000000001', null);

-- Grants and pins.

select is(
  array[
    has_table_privilege('authenticated', 'public.job_runs', 'SELECT'),
    has_table_privilege('authenticated', 'public.error_events', 'SELECT')
  ],
  array[true, true],
  'authenticated may SELECT both tables (RLS decides which rows)');

select is(
  array[
    has_table_privilege('authenticated', 'public.job_runs', 'INSERT'),
    has_table_privilege('authenticated', 'public.job_runs', 'UPDATE'),
    has_table_privilege('authenticated', 'public.job_runs', 'DELETE'),
    has_table_privilege('authenticated', 'public.job_runs', 'TRUNCATE'),
    has_table_privilege('authenticated', 'public.error_events', 'INSERT'),
    has_table_privilege('authenticated', 'public.error_events', 'UPDATE'),
    has_table_privilege('authenticated', 'public.error_events', 'DELETE'),
    has_table_privilege('authenticated', 'public.error_events', 'TRUNCATE'),
    has_table_privilege('anon', 'public.job_runs', 'SELECT'),
    has_table_privilege('anon', 'public.error_events', 'SELECT')
  ],
  array[false, false, false, false, false, false, false, false, false, false],
  'neither client role may write either table, and anon may not read them');

-- Hosted projects grant service_role every new public table by default; the
-- migration revokes it, so the secret key reaches the rows only through the
-- commands.
select is(
  array[
    has_table_privilege('service_role', 'public.job_runs', 'SELECT'),
    has_table_privilege('service_role', 'public.job_runs', 'INSERT'),
    has_table_privilege('service_role', 'public.job_runs', 'UPDATE'),
    has_table_privilege('service_role', 'public.job_runs', 'DELETE'),
    has_table_privilege('service_role', 'public.job_runs', 'TRUNCATE'),
    has_table_privilege('service_role', 'public.error_events', 'SELECT'),
    has_table_privilege('service_role', 'public.error_events', 'INSERT'),
    has_table_privilege('service_role', 'public.error_events', 'UPDATE'),
    has_table_privilege('service_role', 'public.error_events', 'DELETE'),
    has_table_privilege('service_role', 'public.error_events', 'TRUNCATE')
  ],
  array[false, false, false, false, false, false, false, false, false, false],
  'service_role may neither read nor write either table directly');

select results_eq(
  $$ select p.proname::text collate "default", p.prosecdef,
            pg_get_userbyid(p.proowner)::text collate "default",
            p.proconfig::text[] collate "default"
     from pg_proc p
     where p.oid in (
       'public.begin_job_run(text)'::regprocedure,
       'public.end_job_run(bigint, public.job_status, jsonb)'::regprocedure,
       'public.record_error_event(text, text, text, uuid, text)'::regprocedure
     )
     order by p.proname $$,
  $$ values ('begin_job_run', true, 'postgres', array['search_path=""']),
            ('end_job_run', true, 'postgres', array['search_path=""']),
            ('record_error_event', true, 'postgres', array['search_path=""']) $$,
  'the three commands are security definer, owned by postgres, with search_path = ''''');

select results_eq(
  $$ select p.prosecdef, p.provolatile::text, l.lanname::text collate "default",
            p.proconfig::text[] collate "default"
     from pg_proc p
     join pg_language l on l.oid = p.prolang
     where p.oid = 'public.health_check()'::regprocedure $$,
  $$ values (false, 's', 'sql', array['search_path=""']) $$,
  'health_check is a stable invoker sql function with search_path = ''''');

select ok(
  (select p.prosrc ~* 'pg_try_advisory_xact_lock' from pg_proc p
   where p.oid = 'public.begin_job_run(text)'::regprocedure)
  and (select p.prosrc ~* 'for update' from pg_proc p
       where p.oid = 'public.end_job_run(bigint, public.job_status, jsonb)'::regprocedure),
  'begin_job_run takes a transaction-level advisory lock, and end_job_run locks the run FOR UPDATE');

select is(
  array[
    has_function_privilege('anon', 'public.begin_job_run(text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.end_job_run(bigint, public.job_status, jsonb)', 'EXECUTE'),
    has_function_privilege('anon', 'public.record_error_event(text, text, text, uuid, text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.health_check()', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.begin_job_run(text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.end_job_run(bigint, public.job_status, jsonb)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.record_error_event(text, text, text, uuid, text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.health_check()', 'EXECUTE')
  ],
  array[false, false, false, false, false, false, false, false],
  'anon and authenticated may execute none of the four');

select is(
  array[
    has_function_privilege('service_role', 'public.begin_job_run(text)', 'EXECUTE'),
    has_function_privilege('service_role', 'public.end_job_run(bigint, public.job_status, jsonb)', 'EXECUTE'),
    has_function_privilege('service_role', 'public.record_error_event(text, text, text, uuid, text)', 'EXECUTE'),
    has_function_privilege('service_role', 'public.health_check()', 'EXECUTE')
  ],
  array[true, true, true, true],
  'service_role may execute all four');

-- The read matrix.

create temp table callers (
  label text primary key,
  member_id uuid not null
);

insert into callers values
  ('pending', '00000000-0000-4000-a000-000000000001'),
  ('declined', '00000000-0000-4000-a000-000000000002'),
  ('deactivated former Head Layout Artist', '00000000-0000-4000-a000-000000000003'),
  ('active staff', '00000000-0000-4000-a000-000000000004'),
  ('active admin (Sports Editor)', '00000000-0000-4000-a000-000000000005');

-- Every row is counted as `postgres`; the admin reads them all.
create temp table expected as
with t as (
  select (select count(*) from public.job_runs)::int as job_runs,
         (select count(*) from public.error_events)::int as error_events
)
select e.*
from t
cross join lateral (values
  ('pending', 0, 0),
  ('declined', 0, 0),
  ('deactivated former Head Layout Artist', 0, 0),
  ('active staff', 0, 0),
  ('active admin (Sports Editor)', t.job_runs, t.error_events)
) as e (label, job_runs, error_events);

create temp table observed (like expected);

do $$
declare
  v_callers callers[];
  c callers;
  o observed;
begin
  -- `authenticated` can't read temp tables, so read the callers first.
  select array_agg(x) into v_callers from callers x;

  foreach c in array v_callers loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', c.member_id, 'role', 'authenticated')::text,
      true
    );
    set local role authenticated;

    o.label := c.label;
    o.job_runs := (select count(*) from public.job_runs);
    o.error_events := (select count(*) from public.error_events);

    set local role postgres;
    insert into observed values (o.*);
  end loop;
  perform set_config('request.jwt.claims', '', true);
end
$$;

select set_eq(
  $$ select * from observed $$,
  $$ select * from expected $$,
  'only an active admin reads job_runs and error_events; the four spine callers read no row'
);

select ok(
  (select job_runs > 0 and error_events > 0 from expected
   where label = 'active admin (Sports Editor)'),
  'the admin row of the matrix counts real rows');

select is(
  array[
    pg_temp.attempt_as('00000000-0000-4000-a000-000000000005',
      $q$ insert into public.error_events (code, route) values ('x', 'y') $q$),
    pg_temp.attempt_as('00000000-0000-4000-a000-000000000005',
      $q$ update public.job_runs set detail = null $q$),
    pg_temp.attempt_as('00000000-0000-4000-a000-000000000005',
      $q$ delete from public.error_events $q$),
    pg_temp.attempt_as('00000000-0000-4000-a000-000000000005',
      $q$ select public.record_error_event('x', 'y') $q$),
    pg_temp.attempt_as('00000000-0000-4000-a000-000000000005',
      $q$ select public.begin_job_run('pgtap_admin') $q$)
  ],
  array[
    '42501 permission denied for table error_events',
    '42501 permission denied for table job_runs',
    '42501 permission denied for table error_events',
    '42501 permission denied for function record_error_event',
    '42501 permission denied for function begin_job_run'
  ],
  'even an admin writes neither table, directly or through the commands');

-- begin_job_run and end_job_run.

create temp table runs (label text primary key, id bigint);

insert into runs select 'first', public.begin_job_run('pgtap_ops');

select ok(
  (select r.id is not null
     and j.job = 'pgtap_ops'
     and j.status is null
     and j.finished_at is null
     and j.detail is null
   from runs r join public.job_runs j on j.id = r.id
   where r.label = 'first'),
  'with no open run, begin_job_run returns the id of a new open run');

insert into runs select 'while open', public.begin_job_run('pgtap_ops');

select ok(
  (select id is null from runs where label = 'while open')
  and (select count(*) = 1 from public.job_runs j
       where j.job = 'pgtap_ops'
         and j.status = 'skipped'
         and j.finished_at is not null)
  and (select j.finished_at is null from public.job_runs j
       join runs r on r.id = j.id where r.label = 'first'),
  'with an open run, begin_job_run records a skipped row and returns null, leaving the open run alone');

insert into runs select 'other job', public.begin_job_run('pgtap_ops_other');

select isnt(
  (select id from runs where label = 'other job'), null,
  'an open run of one job doesn''t stop another job');

update public.job_runs j
set started_at = now() - interval '61 minutes'
from runs r
where r.label = 'first' and j.id = r.id;

insert into runs select 'after abandoned', public.begin_job_run('pgtap_ops');

select ok(
  (select j.status = 'failed'
     and j.finished_at is not null
     and j.detail = '{"reason":"abandoned"}'::jsonb
   from public.job_runs j join runs r on r.id = j.id
   where r.label = 'first'),
  'an open run older than an hour is closed failed, with the reason abandoned');

select ok(
  (select a.id is not null and a.id <> f.id
   from runs a, runs f
   where a.label = 'after abandoned' and f.label = 'first')
  and (select j.finished_at is null from public.job_runs j
       join runs r on r.id = j.id where r.label = 'after abandoned'),
  'and begin_job_run returns the id of a new open run');

select lives_ok(
  $$ select public.end_job_run(
       (select id from runs where label = 'after abandoned'),
       'ok', '{"bytes": 1234}') $$,
  'end_job_run finishes an open run');

select ok(
  (select j.status = 'ok'
     and j.finished_at is not null
     and j.finished_at >= j.started_at
     and j.detail = '{"bytes": 1234}'::jsonb
   from public.job_runs j join runs r on r.id = j.id
   where r.label = 'after abandoned'),
  'end_job_run writes the status, the finish time and the detail');

select is(
  array[
    pg_temp.attempt($q$ select public.end_job_run(
      (select id from runs where label = 'after abandoned'), 'failed') $q$),
    pg_temp.attempt($q$ select public.end_job_run(
      (select max(id) + 1000 from public.job_runs), 'ok') $q$),
    pg_temp.attempt($q$ select public.end_job_run(null, 'ok') $q$)
  ],
  array[
    'P0001 core.job_run_not_open',
    'P0001 core.job_run_not_open',
    'P0001 core.job_run_not_open'
  ],
  'end_job_run refuses a finished run, a missing one and no id');

select is(
  array[
    pg_temp.attempt($q$ select public.begin_job_run('Backup') $q$),
    pg_temp.attempt($q$ select public.begin_job_run('1backup') $q$),
    pg_temp.attempt($q$ select public.begin_job_run('back up') $q$),
    pg_temp.attempt($q$ select public.begin_job_run('backup-run') $q$),
    pg_temp.attempt($q$ select public.begin_job_run('') $q$),
    pg_temp.attempt($q$ select public.begin_job_run(null) $q$),
    pg_temp.attempt($q$ select public.begin_job_run(repeat('a', 41)) $q$)
  ],
  array[
    'P0001 core.invalid_job', 'P0001 core.invalid_job', 'P0001 core.invalid_job',
    'P0001 core.invalid_job', 'P0001 core.invalid_job', 'P0001 core.invalid_job',
    'P0001 core.invalid_job'
  ],
  'begin_job_run refuses a job name that isn''t a lowercase slug of at most 40 characters');

-- The CHECKs.

select is(
  array[
    pg_temp.attempt($q$ insert into public.job_runs (job) values ('Not A Slug') $q$),
    pg_temp.attempt($q$ insert into public.job_runs (job, step) values ('pgtap_ops', 'step one') $q$),
    pg_temp.attempt($q$ insert into public.job_runs (job, status) values ('pgtap_ops', 'ok') $q$),
    pg_temp.attempt($q$ insert into public.job_runs (job, finished_at) values ('pgtap_ops', now()) $q$),
    pg_temp.attempt($q$ insert into public.job_runs (job, status, started_at, finished_at)
                        values ('pgtap_ops', 'ok', now(), now() - interval '1 second') $q$),
    pg_temp.attempt($q$ select public.end_job_run(public.begin_job_run('pgtap_detail'), 'ok',
                        jsonb_build_object('note', repeat('a', 2000))) $q$)
  ],
  array[
    '23514 job_runs_job_format',
    '23514 job_runs_step_format',
    '23514 job_runs_status_when_finished',
    '23514 job_runs_status_when_finished',
    '23514 job_runs_finished_after_started',
    '23514 job_runs_detail_size'
  ],
  'job_runs refuses a bad job or step, a status without a finish (or the reverse), a finish before the start, and a detail over 2000 bytes');

select is(
  array[
    pg_temp.attempt($q$ select public.record_error_event('has space', 'render /dashboard') $q$),
    pg_temp.attempt($q$ select public.record_error_event('member@example.com', 'render /dashboard') $q$),
    pg_temp.attempt($q$ select public.record_error_event('', 'render /dashboard') $q$),
    pg_temp.attempt($q$ select public.record_error_event(repeat('a', 65), 'render /dashboard') $q$),
    pg_temp.attempt($q$ select public.record_error_event('42501', 'render /dashboard?view=board') $q$),
    pg_temp.attempt($q$ select public.record_error_event('42501', '') $q$),
    pg_temp.attempt($q$ select public.record_error_event('42501', repeat('a', 201)) $q$),
    pg_temp.attempt($q$ select public.record_error_event('42501', 'action x', 'Task') $q$),
    pg_temp.attempt($q$ select public.record_error_event('42501', 'action x', null,
                        '00000000-0000-4000-a100-000000000001') $q$),
    pg_temp.attempt($q$ select public.record_error_event('42501', 'render /', null, null, 'a.b') $q$),
    pg_temp.attempt($q$ select public.record_error_event('42501', 'render /', null, null, '123 456') $q$),
    pg_temp.attempt($q$ select public.record_error_event('42501', 'render /', null, null, 'member@example.com') $q$),
    pg_temp.attempt($q$ select public.record_error_event('42501', 'render /', null, null, repeat('a', 65)) $q$)
  ],
  array[
    '23514 error_events_code_format',
    '23514 error_events_code_format',
    '23514 error_events_code_format',
    '23514 error_events_code_format',
    '23514 error_events_route_format',
    '23514 error_events_route_format',
    '23514 error_events_route_format',
    '23514 error_events_entity_type_format',
    '23514 error_events_entity_id_has_type',
    '23514 error_events_digest_format',
    '23514 error_events_digest_format',
    '23514 error_events_digest_format',
    '23514 error_events_digest_format'
  ],
  'error_events refuses what the sanitizer drops: free-text codes, a query string, a bad entity type, an id without a type, a bad digest');

select is(
  pg_temp.attempt($q$ select public.record_error_event('PGRST301', 'render /dashboard/tasks/[id]',
                      'task_assignment', '00000000-0000-4000-a100-000000000002',
                      'abc_DEF-123') $q$),
  'ok',
  'a row the sanitizer would build is accepted');

select is(
  pg_temp.attempt($q$ select public.record_error_event('Error', 'render /dashboard', null, null,
                      '123456@E394') $q$),
  'ok',
  'a digest Next stamps on its own errors (`<hash>@E<n>`) is accepted');

-- record_error_event writes exactly its arguments, as service_role (which
-- holds no grant on the table itself).
set local role service_role;
select public.record_error_event('P0001', 'route /auth/callback', null, null, '1234567890');
set local role postgres;

select results_eq(
  $$ select e.code, e.route, e.entity_type, e.entity_id, e.digest
     from public.error_events e
     where e.route = 'route /auth/callback' and e.digest = '1234567890' $$,
  $$ values ('P0001', 'route /auth/callback', null::text, null::uuid, '1234567890') $$,
  'record_error_event, called as service_role, writes one row with exactly its arguments');

select is(
  (select e.occurred_at from public.error_events e
   where e.route = 'route /auth/callback' and e.digest = '1234567890'),
  now(),
  'and stamps the time');

-- pgTAP writes its results to temp tables `service_role` can't use, so the
-- answer is kept in a setting and checked as `postgres`.
set local role service_role;
select set_config('pgtap.health_check', public.health_check()::text, true);
set local role postgres;

select is(current_setting('pgtap.health_check'), 'true',
  'health_check returns true for service_role');

select * from finish();

rollback;
