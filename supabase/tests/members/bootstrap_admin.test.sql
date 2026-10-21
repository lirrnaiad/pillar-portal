-- The first-admin bootstrap (Story 2.4): private.bootstrap_admin. Its pins
-- and grants, every Bootstrap and Bootstrap refused row of the story's I/O
-- Matrix, and that a second call is refused.
--
-- Every database this runs on already has admins (seed.sql's, staging's
-- personas, and this file's own fixture), so the "no admin" state is made
-- here, in the transaction: deleting every Board position resyncs each
-- holder's role through the `member_positions_sync_role` trigger. Fixtures
-- are created here and everything rolls back, so the test doesn't depend on
-- seed.sql. It runs locally and on staging (`supabase test db --linked`).

begin;

-- See members.test.sql: run as `postgres` with `extensions` on the path,
-- whichever role `supabase test db --linked` connected as.
set local role postgres;
set local search_path = "$user", public, extensions;

select plan(16);

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

-- Attempts one statement as `postgres`: `ok` when accepted (then rolled
-- back by the sentinel), else `<sqlstate> <message>`. A refusal raises, so
-- whatever the statement wrote before it rolls back with it.
create function pg_temp.attempt(p_call text)
returns text
language plpgsql as $$
begin
  execute p_call;
  raise exception using errcode = 'P0001', message = 'probe.accepted';
exception when others then
  return case when sqlerrm = 'probe.accepted' then 'ok'
              else sqlstate || ' ' || sqlerrm end;
end;
$$;

-- The `detail` a refused statement raised.
create function pg_temp.detail_of(p_call text)
returns text
language plpgsql as $$
declare
  v_detail text;
begin
  execute p_call;
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;

-- b0..01 pending (the one bootstrapped), 02 declined, 03 deactivated former
-- Head Layout Artist, 04 active staff (Staff Layout Artist), 05 active admin
-- (Sports Editor), 06 a second pending member.
select pg_temp.new_member('00000000-0000-4000-b000-000000000001', 'ba-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-b000-000000000002', 'ba-declined@example.com', null);
select pg_temp.new_member('00000000-0000-4000-b000-000000000003', 'ba-deactivated@example.com', 'head_layout_artist');
select pg_temp.new_member('00000000-0000-4000-b000-000000000004', 'ba-staff@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-b000-000000000005', 'ba-admin@example.com', 'sports_editor');
select pg_temp.new_member('00000000-0000-4000-b000-000000000006', 'ba-second@example.com', null);

update public.members set declined_at = now()
where id = '00000000-0000-4000-b000-000000000002';
update public.members set deactivated_at = now()
where id = '00000000-0000-4000-b000-000000000003';

-- Pins and grants.

select isnt_definer('private', 'bootstrap_admin', array['text'],
  'bootstrap_admin runs with the caller''s rights (owner SQL needs no definer)');
select function_owner_is('private', 'bootstrap_admin', array['text'], 'postgres',
  'bootstrap_admin is owned by postgres');
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'private.bootstrap_admin(text)'::regprocedure),
  array['search_path=""'], 'bootstrap_admin sets search_path = ''''');
select ok(
  (select p.prosrc ~* 'pg_advisory_xact_lock' and p.prosrc ~* 'for update'
   from pg_proc p
   where p.oid = 'private.bootstrap_admin(text)'::regprocedure)
  and not (select p.prosrc ~* 'update\s+public\.members\M[^;]*\mrole\M'
           from pg_proc p
           where p.oid = 'private.bootstrap_admin(text)'::regprocedure),
  'bootstrap_admin takes a transaction lock, locks the member FOR UPDATE, and never writes members.role');

select is(
  array[
    has_function_privilege('anon', 'private.bootstrap_admin(text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'private.bootstrap_admin(text)', 'EXECUTE'),
    has_function_privilege('service_role', 'private.bootstrap_admin(text)', 'EXECUTE')
  ],
  array[false, false, false],
  'no API role may execute bootstrap_admin');

-- Refused while any editorial_admin exists.

select is(
  pg_temp.attempt($q$ select private.bootstrap_admin('ba-pending@example.com') $q$),
  'P0001 members.admin_exists',
  'with an editorial_admin, bootstrap_admin refuses');

select pg_temp.detail_of($q$ select private.bootstrap_admin('ba-pending@example.com') $q$)
  as admin_exists_detail \gset

-- No admin: every Board position goes, so every role resyncs.

delete from public.member_positions mp
using public.positions p
where p.id = mp.position
  and p.is_board;

select is(
  (select count(*) from public.members m where m.role = 'editorial_admin'),
  0::bigint,
  'with every Board position deleted, no editorial_admin is left');

-- A deactivated holder of a Board position is still an editorial_admin, and
-- still closes the bootstrap.
insert into public.member_positions (member_id, position, is_primary)
values ('00000000-0000-4000-b000-000000000003', 'head_layout_artist', true);

select is(
  pg_temp.attempt($q$ select private.bootstrap_admin('ba-pending@example.com') $q$),
  'P0001 members.admin_exists',
  'a deactivated editorial_admin still closes the bootstrap');

delete from public.member_positions
where member_id = '00000000-0000-4000-b000-000000000003';

select is(
  array[
    pg_temp.attempt($q$ select private.bootstrap_admin('nobody@example.com') $q$),
    pg_temp.attempt($q$ select private.bootstrap_admin('') $q$),
    pg_temp.attempt($q$ select private.bootstrap_admin(null) $q$)
  ],
  array['P0001 members.not_found', 'P0001 members.not_found', 'P0001 members.not_found'],
  'an email no member has is not found');

select is(
  array[
    pg_temp.attempt($q$ select private.bootstrap_admin('ba-declined@example.com') $q$),
    pg_temp.attempt($q$ select private.bootstrap_admin('ba-deactivated@example.com') $q$),
    pg_temp.attempt($q$ select private.bootstrap_admin('ba-staff@example.com') $q$)
  ],
  array['P0001 members.not_pending', 'P0001 members.not_pending', 'P0001 members.not_pending'],
  'a declined, a deactivated or an active member is not pending');

select ok(
  (select bool_and(d is not null and d ~ '^[A-Z][^.]+\. ')
   from unnest(array[
     :'admin_exists_detail',
     pg_temp.detail_of($q$ select private.bootstrap_admin('nobody@example.com') $q$),
     pg_temp.detail_of($q$ select private.bootstrap_admin('ba-declined@example.com') $q$)
   ]) as d),
  'each refusal carries an English detail for the operator');

-- The bootstrap: the email matched case- and space-insensitively.

select is(
  private.bootstrap_admin(E'  BA-Pending@Example.COM \t'),
  '00000000-0000-4000-b000-000000000001'::uuid,
  'bootstrap_admin returns the pending member''s id');

select results_eq(
  $$ select m.role::text, mp.position, mp.is_primary,
            private.is_member_active(m.id)
     from public.members m
     join public.member_positions mp on mp.member_id = m.id
     where m.id = '00000000-0000-4000-b000-000000000001' $$,
  $$ values ('editorial_admin', 'editor_in_chief', true, true) $$,
  'they hold Editor-in-Chief as their primary position, and the role follows: an active editorial_admin');

select results_eq(
  $$ select j.status::text, j.detail, j.step, j.finished_at = now()
     from public.job_runs j
     where j.job = 'bootstrap' and j.started_at = now() $$,
  $$ values ('ok', null::jsonb, null::text, true) $$,
  'one finished bootstrap row is recorded in job_runs, ok, with no detail');

select is(
  (select count(*) from public.activity a
   where a.entity_id = '00000000-0000-4000-b000-000000000001'),
  0::bigint,
  'the bootstrap logs to job_runs, not activity');

-- A second call is refused: there is an admin now.

select is(
  pg_temp.attempt($q$ select private.bootstrap_admin('ba-second@example.com') $q$),
  'P0001 members.admin_exists',
  'a second bootstrap is refused');

select * from finish();

rollback;
