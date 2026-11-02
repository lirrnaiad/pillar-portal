-- Undoing a mistaken decline (Story 3.10): the owner SQL in OPERATIONS.md,
-- section 3 ("Undoing a mistaken decline"). There is no command for it: the
-- database owner runs one statement, which this file runs exactly as written
-- there. Change the two copies together: `pg_temp.undo_decline` below holds
-- the statement as OPERATIONS.md prints it, `'<email>'` included, and swaps
-- in the email being tested. src/features/members/undo-decline-runbook.test.ts
-- fails when the two differ.
--
-- It covers: a declined member comes back pending with one `undeclined`
-- activity row; a second run returns no rows and logs nothing; the email
-- matches whatever its case and surrounding spaces; active, deactivated and
-- never-declined members are untouched; and approve_member then succeeds.
--
-- Fixtures are created here and rolled back, so the test doesn't depend on
-- seed.sql. It runs locally and on staging (`supabase test db --linked`).

begin;

-- See members.test.sql: run as `postgres` with `extensions` on the path,
-- whichever role `supabase test db --linked` connected as.
set local role postgres;
set local search_path = "$user", public, extensions;

select plan(12);

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

-- Runs one statement as the caller and keeps its writes.
create function pg_temp.run_as(p_caller uuid, p_call text)
returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_caller, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute p_call;
  set local role postgres;
end;
$$;

-- OPERATIONS.md section 3's statement, character for character, with
-- `'<email>'` replaced by `p_email` as a literal. Returns each row's
-- `<id> <email>`; the statement's third column (log_activity's void) is
-- read for its side effect only.
create function pg_temp.undo_decline(p_email text)
returns setof text
language plpgsql as $f$
declare
  r record;
begin
  for r in execute replace($statement$with undeclined as (
  update public.members m
  set declined_at = null,
      updated_at = now(),
      updated_by = null
  where m.email = lower(regexp_replace('<email>', '^[[:space:]]+|[[:space:]]+$', '', 'g'))
    and m.role = 'pending'
    and m.declined_at is not null
    and m.deactivated_at is null
  returning m.id, m.email
)
select id, email, private.log_activity(gen_random_uuid(), 'member', id, null, 'undeclined')
from undeclined$statement$, '''<email>''', quote_literal(p_email)) loop
    return next r.id || ' ' || r.email;
  end loop;
end;
$f$;

-- dd..01 active admin (Sports Editor). dd..11 and 12 declined, the ones
-- undone. dd..21 active staff (Staff Layout Artist), 22 declined then
-- deactivated, 23 pending and never declined: none of them may change.
select pg_temp.new_member('00000000-0000-4000-dd00-000000000001', 'ud-admin@example.com', 'sports_editor');
select pg_temp.new_member('00000000-0000-4000-dd00-000000000011', 'ud-declined@example.com', null);
select pg_temp.new_member('00000000-0000-4000-dd00-000000000012', 'ud-mixed-case@example.com', null);
select pg_temp.new_member('00000000-0000-4000-dd00-000000000021', 'ud-active@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-dd00-000000000022', 'ud-deactivated@example.com', null);
select pg_temp.new_member('00000000-0000-4000-dd00-000000000023', 'ud-pending@example.com', null);

update public.members set declined_at = now()
where id in ('00000000-0000-4000-dd00-000000000011',
             '00000000-0000-4000-dd00-000000000012',
             '00000000-0000-4000-dd00-000000000022');
update public.members set deactivated_at = now()
where id = '00000000-0000-4000-dd00-000000000022';

-- As if the admin had written each row long ago, so a write by the
-- statement shows.
update public.members
set updated_at = '2026-01-01 00:00:00+00',
    updated_by = '00000000-0000-4000-dd00-000000000001'
where id::text like '00000000-0000-4000-dd00-%';

-- A declined member comes back pending.

select is(
  array(select pg_temp.undo_decline('ud-declined@example.com')),
  array['00000000-0000-4000-dd00-000000000011 ud-declined@example.com'],
  'the statement returns the undeclined member''s id and email');

select ok(
  (select m.role = 'pending'
     and m.declined_at is null
     and m.deactivated_at is null
     and m.updated_at = now()
     and m.updated_by is null
   from public.members m where m.id = '00000000-0000-4000-dd00-000000000011')
  and not private.is_member_active('00000000-0000-4000-dd00-000000000011'),
  'the member is pending again (Awaiting approval), updated now by nobody, and not active');

select results_eq(
  $$ select a.entity_type, a.actor_id, a.action from public.activity a
     where a.entity_id = '00000000-0000-4000-dd00-000000000011' $$,
  $$ values ('member', null::uuid, 'undeclined') $$,
  'it logs one undeclined activity row for the member, with no actor');

-- A second run.

select is(
  array(select pg_temp.undo_decline('ud-declined@example.com')),
  '{}'::text[],
  'a second run returns no rows: nothing changed');

select is(
  (select count(*) from public.activity a
   where a.entity_id = '00000000-0000-4000-dd00-000000000011'),
  1::bigint,
  'a second run logs nothing');

-- The email as bootstrap_admin compares it: lowercase, without surrounding
-- whitespace.

select is(
  array(select pg_temp.undo_decline(E'  UD-Mixed-Case@Example.COM \t')),
  array['00000000-0000-4000-dd00-000000000012 ud-mixed-case@example.com'],
  'the email matches whatever its case and surrounding spaces');

select ok(
  (select m.role = 'pending' and m.declined_at is null
   from public.members m where m.id = '00000000-0000-4000-dd00-000000000012'),
  'that member is pending again too');

-- Members it must not touch.

select is(
  array(select pg_temp.undo_decline('ud-active@example.com'))
    || array(select pg_temp.undo_decline('ud-deactivated@example.com'))
    || array(select pg_temp.undo_decline('ud-pending@example.com'))
    || array(select pg_temp.undo_decline('ud-nobody@example.com')),
  '{}'::text[],
  'active, deactivated, never-declined and unknown emails return no rows');

select results_eq(
  $$ select m.id, m.role::text, m.declined_at is not null,
            m.deactivated_at is not null, m.updated_at, m.updated_by
     from public.members m
     where m.id in ('00000000-0000-4000-dd00-000000000021',
                    '00000000-0000-4000-dd00-000000000022',
                    '00000000-0000-4000-dd00-000000000023')
     order by m.id $$,
  $$ values
       ('00000000-0000-4000-dd00-000000000021'::uuid, 'staff', false, false,
        '2026-01-01 00:00:00+00'::timestamptz, '00000000-0000-4000-dd00-000000000001'::uuid),
       ('00000000-0000-4000-dd00-000000000022'::uuid, 'pending', true, true,
        '2026-01-01 00:00:00+00'::timestamptz, '00000000-0000-4000-dd00-000000000001'::uuid),
       ('00000000-0000-4000-dd00-000000000023'::uuid, 'pending', false, false,
        '2026-01-01 00:00:00+00'::timestamptz, '00000000-0000-4000-dd00-000000000001'::uuid) $$,
  'the active, deactivated and never-declined members are unchanged');

select is(
  (select count(*) from public.activity a
   where a.entity_id in ('00000000-0000-4000-dd00-000000000021',
                         '00000000-0000-4000-dd00-000000000022',
                         '00000000-0000-4000-dd00-000000000023')),
  0::bigint,
  'nothing is logged for them');

-- Then an admin approves as usual.

select lives_ok(
  $$ select pg_temp.run_as('00000000-0000-4000-dd00-000000000001',
       $q$ select public.approve_member('00000000-0000-4000-dd00-000000000011',
             '{staff_writer}', 'staff_writer') $q$) $$,
  'the admin approves the undeclined member');

select ok(
  (select m.role = 'staff' from public.members m
   where m.id = '00000000-0000-4000-dd00-000000000011')
  and private.is_member_active('00000000-0000-4000-dd00-000000000011'),
  'the approved member is active staff');

select * from finish();

rollback;
