-- member_directory (AD-19): the one way an active member reads another.
-- Not covered elsewhere — supabase/tests/00_security/catalog.test.sql only
-- asserts the view is exempt from "every view is security_invoker"; nothing
-- in the suite selects from it or checks its filter, join, or shape.
--
-- It answers an active caller only (Story 2.1), so it is read here as the
-- active fixture, through the caller's claims; it runs with its owner's
-- rights either way.

begin;

set local role postgres;
set local search_path = "$user", public, extensions;

select plan(13);

-- Fixtures: a pending member (no position, so not "active"), an active
-- member with two positions on two desks, secondary added first so the
-- primary-first ordering claim isn't trivially true by insertion order, a
-- declined member and a deactivated one who still holds a position.

create function pg_temp.new_auth_user(p_id uuid, p_email text)
returns void
language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated',
          'authenticated', p_email, '{}'::jsonb)
$$;

create function pg_temp.add_position(p_member uuid, p_position text, p_primary boolean)
returns void
language sql as $$
  insert into public.member_positions (member_id, position, is_primary)
  values (p_member, p_position, p_primary)
$$;

select pg_temp.new_auth_user(
  '00000000-0000-4000-9000-0000000000d1', 'directory-pending@example.com'
);

select pg_temp.new_auth_user(
  '00000000-0000-4000-9000-0000000000d2', 'directory-active@example.com'
);
select pg_temp.add_position(
  '00000000-0000-4000-9000-0000000000d2', 'staff_cartoonist', false
);
select pg_temp.add_position(
  '00000000-0000-4000-9000-0000000000d2', 'staff_layout_artist', true
);

select pg_temp.new_auth_user(
  '00000000-0000-4000-9000-0000000000d3', 'directory-declined@example.com'
);
update public.members set declined_at = now()
where id = '00000000-0000-4000-9000-0000000000d3';

select pg_temp.new_auth_user(
  '00000000-0000-4000-9000-0000000000d4', 'directory-deactivated@example.com'
);
select pg_temp.add_position(
  '00000000-0000-4000-9000-0000000000d4', 'staff_photojournalist', true
);
update public.members set deactivated_at = now()
where id = '00000000-0000-4000-9000-0000000000d4';

-- Read the view as a given caller (null: no claims at all).
create function pg_temp.as_member(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_id is null then ''
         else json_build_object('sub', p_id, 'role', 'authenticated')::text
    end,
    true)
$$;

-- A caller who isn't active reads nothing at all.

select pg_temp.as_member('00000000-0000-4000-9000-0000000000d1');
select is(
  (select count(*)::int from public.member_directory),
  0,
  'a pending caller reads no row of member_directory'
);

select pg_temp.as_member('00000000-0000-4000-9000-0000000000d4');
select is(
  (select count(*)::int from public.member_directory),
  0,
  'a deactivated caller reads no row of member_directory'
);

select pg_temp.as_member(null);
select is(
  (select count(*)::int from public.member_directory),
  0,
  'a caller with no claims reads no row of member_directory'
);

-- Everything below reads as the active member.
select pg_temp.as_member('00000000-0000-4000-9000-0000000000d2');

-- Active-only: the pending, declined and deactivated members' rows never
-- appear.

select is(
  (select count(*)::int from public.member_directory
   where id = '00000000-0000-4000-9000-0000000000d1'),
  0,
  'a pending member has no row in member_directory'
);

select is(
  (select count(*)::int from public.member_directory
   where id = '00000000-0000-4000-9000-0000000000d3'),
  0,
  'a declined member has no row in member_directory'
);

select is(
  (select count(*)::int from public.member_directory
   where id = '00000000-0000-4000-9000-0000000000d4'),
  0,
  'a deactivated member has no row in member_directory'
);

select is(
  (select count(*)::int from public.member_directory
   where id = '00000000-0000-4000-9000-0000000000d2'),
  1,
  'an active member has exactly one row in member_directory'
);

-- Read as the app does, as an active `authenticated` member: the view reads
-- tables with its owner's rights but checks EXECUTE on the functions it
-- calls against the caller. A missing grant raises here, failing the file.
create temp table directory_as_member (seen int);

do $$
declare
  v_seen int;
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '00000000-0000-4000-9000-0000000000d2', 'role', 'authenticated'
    )::text,
    true
  );
  set local role authenticated;
  select count(*)::int into v_seen
  from public.member_directory
  where id = '00000000-0000-4000-9000-0000000000d2';
  set local role postgres;
  insert into directory_as_member values (v_seen);
end
$$;

select is(
  (select seen from directory_as_member),
  1,
  'an active authenticated member reads member_directory'
);

-- No email column, at the catalog level (not just "unselected").

select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'member_directory'
     and column_name = 'email'),
  0,
  'member_directory has no email column'
);

-- Positions: primary first, each carrying its desk_id via the join to
-- positions, regardless of insertion order.

select is(
  (select positions -> 0 ->> 'position' from public.member_directory
   where id = '00000000-0000-4000-9000-0000000000d2'),
  'staff_layout_artist',
  'the primary position sorts first in the positions array'
);

select is(
  (select (positions -> 0 ->> 'is_primary')::boolean from public.member_directory
   where id = '00000000-0000-4000-9000-0000000000d2'),
  true,
  'the first position is flagged is_primary'
);

select is(
  (select positions -> 0 ->> 'desk_id' from public.member_directory
   where id = '00000000-0000-4000-9000-0000000000d2'),
  'layout',
  'the primary position carries its own desk_id (layout, from staff_layout_artist)'
);

select is(
  (select positions -> 1 ->> 'desk_id' from public.member_directory
   where id = '00000000-0000-4000-9000-0000000000d2'),
  'cartoons',
  'the secondary position carries its own desk_id (cartoons, from staff_cartoonist)'
);

select * from finish();

rollback;
