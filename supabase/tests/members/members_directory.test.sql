-- member_directory (AD-19): the one way an active member reads another.
-- Not covered elsewhere — supabase/tests/00_security/catalog.test.sql only
-- asserts the view is exempt from "every view is security_invoker"; nothing
-- in the suite selects from it or checks its filter, join, or shape.

begin;

set local role postgres;
set local search_path = "$user", public, extensions;

select plan(7);

-- Fixtures: a pending member (no position, so not "active"), and an active
-- member with two positions on two desks, secondary added first so the
-- primary-first ordering claim isn't trivially true by insertion order.

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

-- Active-only: the pending member's row never appears.

select is(
  (select count(*)::int from public.member_directory
   where id = '00000000-0000-4000-9000-0000000000d1'),
  0,
  'a pending member has no row in member_directory'
);

select is(
  (select count(*)::int from public.member_directory
   where id = '00000000-0000-4000-9000-0000000000d2'),
  1,
  'an active member has exactly one row in member_directory'
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
