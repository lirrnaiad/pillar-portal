-- Member approval (Story 2.2): approve_member and decline_member. Their
-- definer/owner/search_path pins and locks, the caller matrix, every Bad
-- target and Bad positions row of the story's I/O Matrix, what a success
-- writes (the role through the positions, one primary, activity), decline,
-- and the 21 offered positions in the picker's five groups.
--
-- The caller matrix is table-driven, as in account_states.test.sql: each row
-- of `callers` is a caller, a DO block records what each command answers
-- them, and one set_eq compares that with `expected`. An accepted probe
-- raises a sentinel, so its writes roll back and every caller starts from the
-- same state.
--
-- Fixtures are created here and rolled back, so the test doesn't depend on
-- seed.sql. It runs locally and on staging (`supabase test db --linked`).

begin;

-- See members.test.sql: run as `postgres` with `extensions` on the path,
-- whichever role `supabase test db --linked` connected as.
set local role postgres;
set local search_path = "$user", public, extensions;

select plan(40);

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

-- Attempts one statement as the caller: `ok` when accepted (then rolled back
-- by the sentinel), else `<sqlstate> <message>`. The subtransaction's
-- rollback also puts the role back to `postgres`.
create function pg_temp.attempt(p_caller uuid, p_call text)
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

-- Runs a query returning one text value as the caller.
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

-- Callers: f..01 pending, 02 declined, 03 deactivated former Head Layout
-- Artist, 04 active staff (Staff Layout Artist), 05 active admin (Sports
-- Editor).
select pg_temp.new_member('00000000-0000-4000-f000-000000000001', 'ap-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-f000-000000000002', 'ap-declined@example.com', null);
select pg_temp.new_member('00000000-0000-4000-f000-000000000003', 'ap-deactivated@example.com', 'head_layout_artist');
select pg_temp.new_member('00000000-0000-4000-f000-000000000004', 'ap-staff@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-f000-000000000005', 'ap-admin@example.com', 'sports_editor');

-- Pending targets: f..11 and 12 the matrix's, 13 to 15 approved below, 16
-- declined below, 17 for the position checks; 18 deactivated without ever
-- holding a position (still role `pending`).
select pg_temp.new_member('00000000-0000-4000-f000-000000000011', 'ap-target-approve@example.com', null);
select pg_temp.new_member('00000000-0000-4000-f000-000000000012', 'ap-target-decline@example.com', null);
select pg_temp.new_member('00000000-0000-4000-f000-000000000013', 'ap-staff-writer@example.com', null);
select pg_temp.new_member('00000000-0000-4000-f000-000000000014', 'ap-head-and-staff@example.com', null);
select pg_temp.new_member('00000000-0000-4000-f000-000000000015', 'ap-duplicates@example.com', null);
select pg_temp.new_member('00000000-0000-4000-f000-000000000016', 'ap-declined-here@example.com', null);
select pg_temp.new_member('00000000-0000-4000-f000-000000000017', 'ap-positions@example.com', null);
select pg_temp.new_member('00000000-0000-4000-f000-000000000018', 'ap-deactivated-pending@example.com', null);

update public.members set declined_at = now()
where id = '00000000-0000-4000-f000-000000000002';
update public.members set deactivated_at = now()
where id in ('00000000-0000-4000-f000-000000000003',
             '00000000-0000-4000-f000-000000000018');

-- Pins.

select is_definer('public', 'approve_member', array['uuid', 'text[]', 'text'],
  'approve_member is security definer');
select function_owner_is('public', 'approve_member', array['uuid', 'text[]', 'text'], 'postgres',
  'approve_member is owned by postgres');
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'public.approve_member(uuid, text[], text)'::regprocedure),
  array['search_path=""'], 'approve_member sets search_path = ''''');
select ok(
  (select p.prosrc ~* 'for update' from pg_proc p
   where p.oid = 'public.approve_member(uuid, text[], text)'::regprocedure),
  'approve_member locks the member FOR UPDATE');

select is_definer('public', 'decline_member', array['uuid'],
  'decline_member is security definer');
select function_owner_is('public', 'decline_member', array['uuid'], 'postgres',
  'decline_member is owned by postgres');
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'public.decline_member(uuid)'::regprocedure),
  array['search_path=""'], 'decline_member sets search_path = ''''');
select ok(
  (select p.prosrc ~* 'for update' from pg_proc p
   where p.oid = 'public.decline_member(uuid)'::regprocedure),
  'decline_member locks the member FOR UPDATE');

select ok(
  not exists (
    select 1 from pg_proc p
    where p.oid in ('public.approve_member(uuid, text[], text)'::regprocedure,
                    'public.decline_member(uuid)'::regprocedure)
      and p.prosrc ~* 'update\s+public\.members\M[^;]*\mrole\M'
  ),
  'neither command writes members.role: the role follows the positions');

-- The caller matrix.

create temp table callers (
  label text primary key,
  member_id uuid not null
);

insert into callers values
  ('pending', '00000000-0000-4000-f000-000000000001'),
  ('declined', '00000000-0000-4000-f000-000000000002'),
  ('deactivated former Head Layout Artist', '00000000-0000-4000-f000-000000000003'),
  ('active staff', '00000000-0000-4000-f000-000000000004'),
  ('active admin (Sports Editor)', '00000000-0000-4000-f000-000000000005');

create temp table expected (
  label text primary key,
  approve_member text not null,
  decline_member text not null
);

insert into expected values
  ('pending', 'P0001 auth.not_active', 'P0001 auth.not_active'),
  ('declined', 'P0001 auth.not_active', 'P0001 auth.not_active'),
  ('deactivated former Head Layout Artist', 'P0001 auth.not_active', 'P0001 auth.not_active'),
  ('active staff', 'P0001 members.not_admin', 'P0001 members.not_admin'),
  ('active admin (Sports Editor)', 'ok', 'ok');

create temp table observed (like expected);

do $$
declare
  c callers;
begin
  for c in select * from callers loop
    insert into observed values (
      c.label,
      pg_temp.attempt(c.member_id,
        $q$ select public.approve_member('00000000-0000-4000-f000-000000000011',
              '{staff_writer}', 'staff_writer') $q$),
      pg_temp.attempt(c.member_id,
        $q$ select public.decline_member('00000000-0000-4000-f000-000000000012') $q$)
    );
  end loop;
  perform set_config('request.jwt.claims', '', true);
end
$$;

select set_eq(
  $$ select * from observed $$,
  $$ select * from expected $$,
  'only an active admin may approve or decline: non-active callers get auth.not_active, active staff members.not_admin'
);

select ok(
  (select m.role = 'pending' and m.declined_at is null
   from public.members m where m.id = '00000000-0000-4000-f000-000000000011')
  and (select m.declined_at is null
       from public.members m where m.id = '00000000-0000-4000-f000-000000000012')
  and not exists (
    select 1 from public.member_positions mp
    where mp.member_id in ('00000000-0000-4000-f000-000000000011',
                           '00000000-0000-4000-f000-000000000012')
  )
  and not exists (
    select 1 from public.activity a
    where a.entity_type = 'member'
      and a.entity_id in ('00000000-0000-4000-f000-000000000011',
                          '00000000-0000-4000-f000-000000000012')
  ),
  'every accepted probe was rolled back'
);

-- Bad targets, as the admin: approve, then decline.

select is(
  array[
    pg_temp.attempt('00000000-0000-4000-f000-000000000005',
      $q$ select public.approve_member('00000000-0000-4000-f000-000000000004', '{staff_writer}', 'staff_writer') $q$),
    pg_temp.attempt('00000000-0000-4000-f000-000000000005',
      $q$ select public.decline_member('00000000-0000-4000-f000-000000000004') $q$)
  ],
  array['P0001 members.stale', 'P0001 members.stale'],
  'an active target is stale');

select is(
  array[
    pg_temp.attempt('00000000-0000-4000-f000-000000000005',
      $q$ select public.approve_member('00000000-0000-4000-f000-000000000002', '{staff_writer}', 'staff_writer') $q$),
    pg_temp.attempt('00000000-0000-4000-f000-000000000005',
      $q$ select public.decline_member('00000000-0000-4000-f000-000000000002') $q$)
  ],
  array['P0001 members.stale', 'P0001 members.stale'],
  'a declined target is stale');

select is(
  array[
    pg_temp.attempt('00000000-0000-4000-f000-000000000005',
      $q$ select public.approve_member('00000000-0000-4000-f000-000000000003', '{staff_writer}', 'staff_writer') $q$),
    pg_temp.attempt('00000000-0000-4000-f000-000000000005',
      $q$ select public.decline_member('00000000-0000-4000-f000-000000000003') $q$)
  ],
  array['P0001 members.stale', 'P0001 members.stale'],
  'a deactivated former Head is stale');

select is(
  array[
    pg_temp.attempt('00000000-0000-4000-f000-000000000005',
      $q$ select public.approve_member('00000000-0000-4000-f000-000000000018', '{staff_writer}', 'staff_writer') $q$),
    pg_temp.attempt('00000000-0000-4000-f000-000000000005',
      $q$ select public.decline_member('00000000-0000-4000-f000-000000000018') $q$)
  ],
  array['P0001 members.stale', 'P0001 members.stale'],
  'a deactivated target still in role pending is stale');

select is(
  array[
    pg_temp.attempt('00000000-0000-4000-f000-000000000005',
      $q$ select public.approve_member('00000000-0000-4000-f000-0000000000ff', '{staff_writer}', 'staff_writer') $q$),
    pg_temp.attempt('00000000-0000-4000-f000-000000000005',
      $q$ select public.decline_member('00000000-0000-4000-f000-0000000000ff') $q$)
  ],
  array['P0001 members.not_found', 'P0001 members.not_found'],
  'a missing target is not found');

-- Bad positions, as the admin, on a pending target.

select is(
  pg_temp.attempt('00000000-0000-4000-f000-000000000005',
    $q$ select public.approve_member('00000000-0000-4000-f000-000000000017', '{}', 'staff_writer') $q$),
  'P0001 members.no_positions', 'no positions is refused');
select is(
  pg_temp.attempt('00000000-0000-4000-f000-000000000005',
    $q$ select public.approve_member('00000000-0000-4000-f000-000000000017', null, 'staff_writer') $q$),
  'P0001 members.no_positions', 'a null position list is refused');
select is(
  pg_temp.attempt('00000000-0000-4000-f000-000000000005',
    $q$ select public.approve_member('00000000-0000-4000-f000-000000000017', '{editor_in_chief}', 'editor_in_chief') $q$),
  'P0001 members.invalid_position', 'Editor-in-Chief is refused');
select is(
  pg_temp.attempt('00000000-0000-4000-f000-000000000005',
    $q$ select public.approve_member('00000000-0000-4000-f000-000000000017', '{staff_writer,editor_in_chief}', 'staff_writer') $q$),
  'P0001 members.invalid_position', 'Editor-in-Chief beside another position is refused');
select is(
  pg_temp.attempt('00000000-0000-4000-f000-000000000005',
    $q$ select public.approve_member('00000000-0000-4000-f000-000000000017', '{technical_adviser}', 'technical_adviser') $q$),
  'P0001 members.invalid_position', 'an unknown position (Technical Adviser) is refused');
select is(
  pg_temp.attempt('00000000-0000-4000-f000-000000000005',
    $q$ select public.approve_member('00000000-0000-4000-f000-000000000017', array['staff_writer', null], 'staff_writer') $q$),
  'P0001 members.invalid_position', 'a null position is refused');
select is(
  pg_temp.attempt('00000000-0000-4000-f000-000000000005',
    $q$ select public.approve_member('00000000-0000-4000-f000-000000000017', '{staff_writer}', 'head_cartoonist') $q$),
  'P0001 members.invalid_primary', 'a primary that isn''t among the positions is refused');
select is(
  pg_temp.attempt('00000000-0000-4000-f000-000000000005',
    $q$ select public.approve_member('00000000-0000-4000-f000-000000000017', '{staff_writer}', null) $q$),
  'P0001 members.invalid_primary', 'no primary is refused');

-- Success.

select lives_ok(
  $$ select pg_temp.run_as('00000000-0000-4000-f000-000000000005',
       $q$ select public.approve_member('00000000-0000-4000-f000-000000000013',
             '{staff_writer}', 'staff_writer') $q$) $$,
  'the admin approves a member as Staff Writer');
select lives_ok(
  $$ select pg_temp.run_as('00000000-0000-4000-f000-000000000005',
       $q$ select public.approve_member('00000000-0000-4000-f000-000000000014',
             '{head_photojournalist,staff_photojournalist}', 'staff_photojournalist') $q$) $$,
  'the admin approves a member as Head Photojournalist and Staff Photojournalist, the Staff position primary');
select lives_ok(
  $$ select pg_temp.run_as('00000000-0000-4000-f000-000000000005',
       $q$ select public.approve_member('00000000-0000-4000-f000-000000000015',
             '{staff_cartoonist,staff_writer,staff_cartoonist}', 'staff_cartoonist') $q$) $$,
  'the admin approves a member with a repeated position');

select results_eq(
  $$ select m.id, m.role::text from public.members m
     where m.id in ('00000000-0000-4000-f000-000000000013',
                    '00000000-0000-4000-f000-000000000014',
                    '00000000-0000-4000-f000-000000000015')
     order by m.id $$,
  $$ values ('00000000-0000-4000-f000-000000000013'::uuid, 'staff'),
            ('00000000-0000-4000-f000-000000000014'::uuid, 'editorial_admin'),
            ('00000000-0000-4000-f000-000000000015'::uuid, 'staff') $$,
  'the role follows the positions: Staff only is staff, any Board position editorial_admin');

select results_eq(
  $$ select mp.member_id, mp.position, mp.is_primary from public.member_positions mp
     where mp.member_id in ('00000000-0000-4000-f000-000000000013',
                            '00000000-0000-4000-f000-000000000014',
                            '00000000-0000-4000-f000-000000000015')
     order by mp.member_id, mp.position $$,
  $$ values ('00000000-0000-4000-f000-000000000013'::uuid, 'staff_writer', true),
            ('00000000-0000-4000-f000-000000000014'::uuid, 'head_photojournalist', false),
            ('00000000-0000-4000-f000-000000000014'::uuid, 'staff_photojournalist', true),
            ('00000000-0000-4000-f000-000000000015'::uuid, 'staff_cartoonist', true),
            ('00000000-0000-4000-f000-000000000015'::uuid, 'staff_writer', false) $$,
  'each position is written once, the chosen one primary');

select is(
  (select count(*) from (
     select mp.member_id from public.member_positions mp
     where mp.member_id in ('00000000-0000-4000-f000-000000000013',
                            '00000000-0000-4000-f000-000000000014',
                            '00000000-0000-4000-f000-000000000015')
     group by mp.member_id
     having count(*) filter (where mp.is_primary) = 1
   ) one_primary),
  3::bigint,
  'each approved member has exactly one primary position');

select ok(
  private.is_member_active('00000000-0000-4000-f000-000000000013')
    and private.is_member_active('00000000-0000-4000-f000-000000000014')
    and private.is_member_active('00000000-0000-4000-f000-000000000015'),
  'approved members are active');

select is(
  pg_temp.q_as('00000000-0000-4000-f000-000000000004',
    $q$ select count(*)::text from public.member_directory d
        where d.id in ('00000000-0000-4000-f000-000000000013',
                       '00000000-0000-4000-f000-000000000014',
                       '00000000-0000-4000-f000-000000000015') $q$),
  '3', 'approved members are listed in member_directory');

select is(
  (select count(*) from public.members m
   where m.id in ('00000000-0000-4000-f000-000000000013',
                  '00000000-0000-4000-f000-000000000014',
                  '00000000-0000-4000-f000-000000000015')
     and m.updated_by = '00000000-0000-4000-f000-000000000005'),
  3::bigint, 'an approval records the admin as updated_by');

-- Decline.

select lives_ok(
  $$ select pg_temp.run_as('00000000-0000-4000-f000-000000000005',
       $q$ select public.decline_member('00000000-0000-4000-f000-000000000016') $q$) $$,
  'the admin declines a pending member');

select ok(
  (select m.role = 'pending'
     and m.declined_at is not null
     and m.updated_by = '00000000-0000-4000-f000-000000000005'
   from public.members m where m.id = '00000000-0000-4000-f000-000000000016')
  and not exists (select 1 from public.member_positions mp
                  where mp.member_id = '00000000-0000-4000-f000-000000000016')
  and not private.is_member_active('00000000-0000-4000-f000-000000000016'),
  'a declined member''s row is kept: pending, no positions, declined_at set, not active');

select is(
  array[
    pg_temp.attempt('00000000-0000-4000-f000-000000000005',
      $q$ select public.approve_member('00000000-0000-4000-f000-000000000016', '{staff_writer}', 'staff_writer') $q$),
    pg_temp.attempt('00000000-0000-4000-f000-000000000005',
      $q$ select public.decline_member('00000000-0000-4000-f000-000000000016') $q$)
  ],
  array['P0001 members.stale', 'P0001 members.stale'],
  'approving or declining a member again after a decline is stale');

select is(
  array[
    pg_temp.attempt('00000000-0000-4000-f000-000000000005',
      $q$ select public.approve_member('00000000-0000-4000-f000-000000000013', '{staff_writer}', 'staff_writer') $q$),
    pg_temp.attempt('00000000-0000-4000-f000-000000000005',
      $q$ select public.decline_member('00000000-0000-4000-f000-000000000013') $q$)
  ],
  array['P0001 members.stale', 'P0001 members.stale'],
  'approving or declining a member again after an approval is stale');

select results_eq(
  $$ select a.entity_id, a.actor_id, a.action from public.activity a
     where a.entity_type = 'member'
       and a.entity_id::text like '00000000-0000-4000-f000-%'
     order by a.entity_id $$,
  $$ values ('00000000-0000-4000-f000-000000000013'::uuid, '00000000-0000-4000-f000-000000000005'::uuid, 'approved'),
            ('00000000-0000-4000-f000-000000000014'::uuid, '00000000-0000-4000-f000-000000000005'::uuid, 'approved'),
            ('00000000-0000-4000-f000-000000000015'::uuid, '00000000-0000-4000-f000-000000000005'::uuid, 'approved'),
            ('00000000-0000-4000-f000-000000000016'::uuid, '00000000-0000-4000-f000-000000000005'::uuid, 'declined') $$,
  'each approval and decline logs one activity row, and refusals log none');

-- The positions the picker offers (src/features/members/position-groups.ts
-- derives the same groups from the same flags): every position but
-- Editor-in-Chief, 21 in all.

select results_eq(
  $$ select g, count(*)::int
     from (
       select case
         when not p.is_board then 'Staff'
         when p.heads_section_id is not null then 'Section Editors'
         when p.heads_desk_id is not null then 'Heads'
         when p.is_top_editor then 'Top editors'
         else 'Management'
       end as g
       from public.positions p
       where p.id <> 'editor_in_chief'
     ) offered
     group by g
     order by g $$,
  $$ values ('Heads', 5), ('Management', 3), ('Section Editors', 5),
            ('Staff', 6), ('Top editors', 2) $$,
  '21 positions are offered: 6 Staff, 5 Section Editors, 5 Heads, 2 Top editors, 3 Management');

select is(
  (select count(*) from public.positions p
   where p.title ~* 'advis[eo]r' or p.id ~* 'advis[eo]r'),
  0::bigint,
  'there is no Technical Adviser position to approve anyone as');

select * from finish();

rollback;
