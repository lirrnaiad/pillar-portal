-- One active-member helper (Story 1.13): `private.is_member_active(uuid)` is
-- the only definition of "active", pinned like the other private member
-- helpers and equivalent to the predicate it replaced for every member in the
-- database (seeded or not) plus a pending fixture, an unknown id and null.
-- Everything is rolled back; it runs locally and on staging.

begin;

set local role postgres;
set local search_path = "$user", public, extensions;

select plan(13);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000',
        '00000000-0000-4000-b000-000000000001', 'authenticated',
        'authenticated', 'pending-fixture@active-helper.test',
        '{"name": "Pending Fixture"}');

select is(
  (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
     and pg_get_userbyid(p.proowner) = 'postgres'
   from pg_proc p where p.oid = 'private.is_member_active(uuid)'::regprocedure),
  true,
  'is_member_active is security definer, stable, owned by postgres, empty search_path'
);

select is(
  (select has_function_privilege('authenticated', 'private.is_member_active(uuid)', 'execute')
       or has_function_privilege('anon', 'private.is_member_active(uuid)', 'execute')),
  false,
  'is_member_active is granted to neither authenticated nor anon'
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
  (select count(*) from public.members m
   where private.is_member_active(m.id) is distinct from (m.role <> 'pending')),
  0::bigint,
  'the helper equals the old predicate for every member'
);

select is(
  (select count(*) from public.member_directory d
   join public.members m on m.id = d.id where m.role = 'pending'),
  0::bigint,
  'member_directory lists no pending member'
);

select is(
  (select count(*) from public.members m
   where m.role <> 'pending'
     and not exists (select 1 from public.member_directory d where d.id = m.id)),
  0::bigint,
  'member_directory lists every active member'
);

-- Caller helpers, run as one member at a time.
create function pg_temp.as_member(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true)
$$;

select pg_temp.as_member('00000000-0000-4000-b000-000000000001');
select is(
  (select private.is_active_member() or private.is_admin() or private.is_top_editor()
     or private.current_member_id() is not null),
  false,
  'a pending caller is not active, admin or top editor'
);

select is(
  (select count(*) from public.members m
   where m.role = 'editorial_admin' and not private.is_member_active(m.id)),
  0::bigint,
  'every editorial_admin is active'
);

create temp table caller_mismatches (member_id uuid);
grant all on caller_mismatches to public;

do $$
declare
  m record;
begin
  for m in select id, role from public.members loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', m.id, 'role', 'authenticated')::text, true);
    if private.is_active_member() is distinct from (m.role <> 'pending')
      or (private.current_member_id() is not null) is distinct from (m.role <> 'pending')
      or private.is_admin() is distinct from (m.role = 'editorial_admin')
      or private.is_top_editor() is distinct from (
        m.role <> 'pending' and exists (
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
  'is_active_member, current_member_id, is_admin and is_top_editor match the old predicates for every member'
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
