-- One active-member helper (Stories 1.13, 2.1): `private.is_member_active(uuid)`
-- is the only definition of "active" (a role other than pending, and neither
-- declined_at nor deactivated_at set), pinned like the other private member
-- helpers, and checked against that predicate for every member in the
-- database (seeded or not) plus pending, declined, deactivated and active
-- fixtures, an unknown id and null. Everything is rolled back; it runs
-- locally and on staging.

begin;

set local role postgres;
set local search_path = "$user", public, extensions;

select plan(16);

-- b..01 pending, 02 declined, 03 deactivated Head Layout Artist (an
-- editorial_admin by role), 04 active Staff Writer.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-b000-000000000001',
   'authenticated', 'authenticated', 'pending-fixture@active-helper.test',
   '{"name": "Pending Fixture"}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-b000-000000000002',
   'authenticated', 'authenticated', 'declined-fixture@active-helper.test',
   '{"name": "Declined Fixture"}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-b000-000000000003',
   'authenticated', 'authenticated', 'deactivated-fixture@active-helper.test',
   '{"name": "Deactivated Fixture"}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-b000-000000000004',
   'authenticated', 'authenticated', 'active-fixture@active-helper.test',
   '{"name": "Active Fixture"}');

insert into public.member_positions (member_id, position, is_primary) values
  ('00000000-0000-4000-b000-000000000003', 'head_layout_artist', true),
  ('00000000-0000-4000-b000-000000000004', 'staff_writer', true);

update public.members set declined_at = now()
where id = '00000000-0000-4000-b000-000000000002';
update public.members set deactivated_at = now()
where id = '00000000-0000-4000-b000-000000000003';

select is(
  (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
     and pg_get_userbyid(p.proowner) = 'postgres'
   from pg_proc p where p.oid = 'private.is_member_active(uuid)'::regprocedure),
  true,
  'is_member_active is security definer, stable, owned by postgres, empty search_path'
);

-- member_directory calls it, and a view checks EXECUTE against the querying
-- role, so `authenticated` needs it; `anon` never does.
select is(
  (select has_function_privilege('authenticated', 'private.is_member_active(uuid)', 'execute')
       and not has_function_privilege('anon', 'private.is_member_active(uuid)', 'execute')),
  true,
  'is_member_active is granted to authenticated, not anon'
);

select is(
  (select role from public.members where id = '00000000-0000-4000-b000-000000000001'),
  'pending'::public.member_role,
  'the fixture is a pending member'
);

select is(
  private.is_member_active('00000000-0000-4000-b000-000000000001'),
  false,
  'a pending member is not active'
);

select is(private.is_member_active(gen_random_uuid()), false, 'an unknown id is not active');
select is(private.is_member_active(null), false, 'a null id is not active');

select is(
  private.is_member_active('00000000-0000-4000-b000-000000000002'),
  false,
  'a declined member is not active'
);

select is(
  private.is_member_active('00000000-0000-4000-b000-000000000003'),
  false,
  'a deactivated member is not active, whatever positions they still hold'
);

select is(
  private.is_member_active('00000000-0000-4000-b000-000000000004'),
  true,
  'a staff member with neither timestamp set is active'
);

select is(
  (select count(*) from public.members m
   where private.is_member_active(m.id) is distinct from (
     m.role <> 'pending' and m.declined_at is null and m.deactivated_at is null
   )),
  0::bigint,
  'the helper equals the active predicate for every member'
);

-- Caller helpers and the directory, run as one member at a time (still as
-- `postgres`, so the checks below can read every members row).
create function pg_temp.as_member(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true)
$$;

-- member_directory answers only an active caller.
select pg_temp.as_member('00000000-0000-4000-b000-000000000004');

select is(
  (select count(*) from public.member_directory d
   join public.members m on m.id = d.id
   where not (m.role <> 'pending' and m.declined_at is null and m.deactivated_at is null)),
  0::bigint,
  'member_directory lists no member who isn''t active'
);

select is(
  (select count(*) from public.members m
   where m.role <> 'pending' and m.declined_at is null and m.deactivated_at is null
     and not exists (select 1 from public.member_directory d where d.id = m.id)),
  0::bigint,
  'member_directory lists every active member'
);

select pg_temp.as_member('00000000-0000-4000-b000-000000000001');
select is(
  (select private.is_active_member() or private.is_admin() or private.is_top_editor()
     or private.current_member_id() is not null),
  false,
  'a pending caller is not active, admin or top editor'
);

select pg_temp.as_member('00000000-0000-4000-b000-000000000003');
select is(
  (select private.is_active_member() or private.is_admin() or private.is_top_editor()
     or private.current_member_id() is not null),
  false,
  'a deactivated editorial_admin is not active, admin or top editor'
);

create temp table caller_mismatches (member_id uuid);
grant all on caller_mismatches to public;

do $$
declare
  m record;
  v_active boolean;
begin
  for m in select id, role, declined_at, deactivated_at from public.members loop
    v_active := m.role <> 'pending'
      and m.declined_at is null
      and m.deactivated_at is null;
    perform set_config('request.jwt.claims',
      json_build_object('sub', m.id, 'role', 'authenticated')::text, true);
    if private.is_active_member() is distinct from v_active
      or (private.current_member_id() is not null) is distinct from v_active
      or private.is_admin() is distinct from (v_active and m.role = 'editorial_admin')
      or private.is_top_editor() is distinct from (
        v_active and exists (
          select 1 from public.member_positions mp
          join public.positions p on p.id = mp.position
          where mp.member_id = m.id and p.is_top_editor))
    then
      insert into caller_mismatches values (m.id);
    end if;
  end loop;
end;
$$;

select is(
  (select count(*) from caller_mismatches),
  0::bigint,
  'is_active_member, current_member_id, is_admin and is_top_editor follow the active predicate for every member'
);

select pg_temp.as_member(null);
select is(
  (select private.is_active_member() or private.is_admin() or private.is_top_editor()
     or private.current_member_id() is not null),
  false,
  'a caller with no claims is not active'
);

select * from finish();
rollback;
