-- Members (AD-5): the new-user trigger, role derivation, the constraints, the
-- `private` helpers, RLS on `members` and `member_positions`, and the
-- password invariants of the seeded users.
--
-- Fixture auth users are created here, so the test doesn't depend on the
-- seed; everything is rolled back. It runs locally and on staging
-- (`supabase test db --linked`), seeded or not. The caller matrix is
-- table-driven: each row of `callers` is a caller and what they should see,
-- a DO block records what each one actually sees, and one set_eq compares
-- the two. A later account state (declined, deactivated) is a new row.

begin;

select plan(35);

-- Fixtures.

create function pg_temp.new_auth_user(p_id uuid, p_email text, p_meta jsonb)
returns void
language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated',
          'authenticated', p_email, p_meta)
$$;

create function pg_temp.add_position(p_member uuid, p_position text, p_primary boolean)
returns void
language sql as $$
  insert into public.member_positions (member_id, position, is_primary)
  values (p_member, p_position, p_primary)
$$;

create function pg_temp.role_of(p_member uuid)
returns text
language sql as $$
  select role::text from public.members where id = p_member
$$;

-- The new-user trigger.

-- Supabase Auth inserts users as `supabase_auth_admin`, which `postgres`
-- can't `set role` to, so these pin what that path depends on instead: the
-- function runs as its owner, `postgres`, with an empty search_path, and the
-- trigger is there and enabled.
select is_definer(
  'private', 'handle_new_user', '{}'::name[],
  'private.handle_new_user() is security definer'
);

select function_owner_is(
  'private', 'handle_new_user', '{}'::name[], 'postgres',
  'private.handle_new_user() is owned by postgres'
);

select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'private.handle_new_user()'::regprocedure),
  array['search_path=""'],
  'private.handle_new_user() sets search_path = '''''
);

select trigger_is(
  'auth', 'users', 'on_auth_user_created', 'private', 'handle_new_user',
  'on_auth_user_created on auth.users runs private.handle_new_user()'
);

select ok(
  (select t.tgenabled in ('O', 'A') from pg_trigger t
   where t.tgrelid = 'auth.users'::regclass
     and t.tgname = 'on_auth_user_created'),
  'on_auth_user_created is enabled'
);

select pg_temp.new_auth_user(
  '00000000-0000-4000-8000-000000000010',
  ' Mixed@Case.Test ',
  jsonb_build_object(
    'full_name', '  Test Person  ',
    'name', 'Ignored Name',
    'avatar_url', 'https://example.com/' || repeat('a', 81),
    'role', 'editorial_admin',
    'positions', jsonb_build_array('editor_in_chief')
  )
);

select results_eq(
  $$ select name, avatar_url, email, role::text from public.members
     where id = '00000000-0000-4000-8000-000000000010' $$,
  $$ values ('Test Person', null::text, 'mixed@case.test', 'pending') $$,
  'a new auth user becomes a pending member: trimmed full_name, no 101-character avatar, normalized email, metadata role ignored'
);

select is_empty(
  $$ select position from public.member_positions
     where member_id = '00000000-0000-4000-8000-000000000010' $$,
  'a new member holds no position, whatever the metadata says'
);

select pg_temp.new_auth_user(
  '00000000-0000-4000-8000-000000000011',
  'only-name@example.com',
  jsonb_build_object(
    'name', 'Only Name',
    'avatar_url', 'https://example.com/' || repeat('a', 80)
  )
);

select results_eq(
  $$ select name, char_length(avatar_url) from public.members
     where id = '00000000-0000-4000-8000-000000000011' $$,
  $$ values ('Only Name', 100) $$,
  'the name falls back to `name`, and a 100-character avatar URL is kept'
);

select pg_temp.new_auth_user(
  '00000000-0000-4000-8000-000000000012',
  'local.part@example.com',
  '{}'
);

select results_eq(
  $$ select name from public.members
     where id = '00000000-0000-4000-8000-000000000012' $$,
  array['local.part'],
  'with no name in the metadata, the name is the email''s local part'
);

select pg_temp.new_auth_user(
  '00000000-0000-4000-8000-000000000013',
  'long-name@example.com',
  jsonb_build_object(
    'full_name', repeat('x', 250),
    'avatar_url', 'javascript:alert(1)'
  )
);

select results_eq(
  $$ select char_length(name), avatar_url from public.members
     where id = '00000000-0000-4000-8000-000000000013' $$,
  $$ values (200, null::text) $$,
  'the name is capped at 200 characters, and a non-http(s) avatar URL is dropped'
);

select pg_temp.new_auth_user(
  '00000000-0000-4000-8000-000000000014',
  'blank-name@example.com',
  jsonb_build_object('full_name', E'\t\n', 'name', E' \r\n\t ')
);

select results_eq(
  $$ select name from public.members
     where id = '00000000-0000-4000-8000-000000000014' $$,
  array['blank-name'],
  'a full_name and name of tabs and newlines count as blank, so the name is the email''s local part'
);

-- Role derivation.

select pg_temp.new_auth_user(
  '00000000-0000-4000-8000-000000000020', 'derive@example.com', '{}'
);
select pg_temp.new_auth_user(
  '00000000-0000-4000-8000-000000000021', 'derive-2@example.com', '{}'
);

select pg_temp.add_position(
  '00000000-0000-4000-8000-000000000020', 'staff_writer', true
);

select is(
  pg_temp.role_of('00000000-0000-4000-8000-000000000020'),
  'staff',
  'a Staff position makes the member staff'
);

select pg_temp.add_position(
  '00000000-0000-4000-8000-000000000020', 'sports_editor', false
);

select is(
  pg_temp.role_of('00000000-0000-4000-8000-000000000020'),
  'editorial_admin',
  'adding a Board position makes them editorial_admin'
);

delete from public.member_positions
where member_id = '00000000-0000-4000-8000-000000000020';

select is(
  pg_temp.role_of('00000000-0000-4000-8000-000000000020'),
  'pending',
  'removing every position makes them pending again'
);

select pg_temp.add_position(
  '00000000-0000-4000-8000-000000000020', 'staff_cartoonist', true
);
update public.member_positions
set member_id = '00000000-0000-4000-8000-000000000021'
where member_id = '00000000-0000-4000-8000-000000000020';

select results_eq(
  $$ select pg_temp.role_of('00000000-0000-4000-8000-000000000020'),
            pg_temp.role_of('00000000-0000-4000-8000-000000000021') $$,
  $$ values ('pending', 'staff') $$,
  'moving a position to another member updates both roles'
);

select throws_ok(
  $$ update public.members set role = 'editorial_admin'
     where id = '00000000-0000-4000-8000-000000000021' $$,
  'P0001',
  'members.role_follows_positions',
  'setting a role the positions don''t imply raises members.role_follows_positions'
);

select lives_ok(
  $$ update public.members set role = 'staff'
     where id = '00000000-0000-4000-8000-000000000021' $$,
  'setting the role it already has is a no-op'
);

-- Moving a held position on or off the Board re-syncs its holders.
update public.positions set is_board = true where id = 'staff_cartoonist';

select is(
  pg_temp.role_of('00000000-0000-4000-8000-000000000021'),
  'editorial_admin',
  'a position moved onto the Board makes its holders editorial_admin'
);

update public.positions set is_board = false where id = 'staff_cartoonist';

select is(
  pg_temp.role_of('00000000-0000-4000-8000-000000000021'),
  'staff',
  'and moving it back makes them staff again'
);

delete from public.members where id = '00000000-0000-4000-8000-000000000020';

select throws_ok(
  $$ insert into public.members (id, name, email, role)
     values ('00000000-0000-4000-8000-000000000020', 'Derive',
             'derive@example.com', 'staff') $$,
  'P0001',
  'members.role_follows_positions',
  'a member can''t be inserted with a role other than pending'
);

-- Constraints.

select pg_temp.new_auth_user(
  '00000000-0000-4000-8000-000000000030', 'constraints-1@example.com', '{}'
);
select pg_temp.new_auth_user(
  '00000000-0000-4000-8000-000000000031', 'constraints-2@example.com', '{}'
);
select pg_temp.add_position(
  '00000000-0000-4000-8000-000000000030', 'staff_writer', true
);

select throws_ok(
  $$ select pg_temp.add_position(
       '00000000-0000-4000-8000-000000000030', 'staff_cartoonist', true) $$,
  '23505',
  null,
  'a member has at most one primary position'
);

select throws_ok(
  $$ select pg_temp.add_position(
       '00000000-0000-4000-8000-000000000030', 'staff_writer', false) $$,
  '23505',
  null,
  'a member holds a position at most once'
);

-- Clear any seeded Editor-in-Chief so the first insert below is allowed.
delete from public.member_positions where position = 'editor_in_chief';

select lives_ok(
  $$ select pg_temp.add_position(
       '00000000-0000-4000-8000-000000000030', 'editor_in_chief', false) $$,
  'one Editor-in-Chief is allowed'
);

select throws_ok(
  $$ select pg_temp.add_position(
       '00000000-0000-4000-8000-000000000031', 'editor_in_chief', true) $$,
  '23505',
  null,
  'a second Editor-in-Chief is refused'
);

select throws_ok(
  $$ update public.members set email = 'Upper@Example.com'
     where id = '00000000-0000-4000-8000-000000000030' $$,
  '23514',
  null,
  'a member''s email must be lowercase'
);

select throws_ok(
  $$ update public.members set email = ' spaced@example.com'
     where id = '00000000-0000-4000-8000-000000000030' $$,
  '23514',
  null,
  'a member''s email must be trimmed'
);

select throws_ok(
  $$ update public.members set avatar_url = 'ftp://example.com/a.png'
     where id = '00000000-0000-4000-8000-000000000030' $$,
  '23514',
  null,
  'an avatar URL must be http(s)'
);

select throws_ok(
  $$ update public.members set name = '   '
     where id = '00000000-0000-4000-8000-000000000030' $$,
  '23514',
  null,
  'a member''s name can''t be blank'
);

select throws_ok(
  $$ update public.members set name = E'\t\n'
     where id = '00000000-0000-4000-8000-000000000030' $$,
  '23514',
  null,
  'a name of tabs and newlines is blank too'
);

select throws_ok(
  $$ select pg_temp.add_position(
       '00000000-0000-4000-8000-000000000031', 'not_a_position', true) $$,
  '23503',
  null,
  'a member position must be one of the positions'
);

-- The caller matrix.

select pg_temp.new_auth_user(
  '00000000-0000-4000-8000-000000000001', 'caller-pending@example.com', '{}'
);
select pg_temp.new_auth_user(
  '00000000-0000-4000-8000-000000000002', 'caller-staff@example.com', '{}'
);
select pg_temp.new_auth_user(
  '00000000-0000-4000-8000-000000000003', 'caller-admin@example.com', '{}'
);
select pg_temp.new_auth_user(
  '00000000-0000-4000-8000-000000000004', 'caller-top@example.com', '{}'
);
select pg_temp.add_position(
  '00000000-0000-4000-8000-000000000002', 'staff_writer', true
);
select pg_temp.add_position(
  '00000000-0000-4000-8000-000000000003', 'head_layout_artist', true
);
select pg_temp.add_position(
  '00000000-0000-4000-8000-000000000004', 'associate_editor', true
);
select pg_temp.add_position(
  '00000000-0000-4000-8000-000000000004', 'online_manager', false
);

-- Each caller, and what they should get:
--   is_current_member  private.current_member_id() returns their id (else null)
--   is_active, is_admin, is_top  the other three helpers
--   sees  'own': only their own members row and positions; 'all': every row;
--         'none': no row at all (a signed-in `sub` with no members row)
--   sees_org  every sections, desks and positions row (35), or none
-- `extra_claims` is merged into the JWT claims: role and positions must come
-- from the tables, never from claims.
create temp table callers (
  label text primary key,
  member_id uuid not null,
  extra_claims jsonb not null default '{}',
  is_current_member boolean not null,
  is_active boolean not null,
  is_admin boolean not null,
  is_top boolean not null,
  sees text not null check (sees in ('none', 'own', 'all')),
  sees_org boolean not null
);

insert into callers values
  ('pending', '00000000-0000-4000-8000-000000000001', '{}',
   false, false, false, false, 'own', false),
  ('pending, with admin claims in the JWT',
   '00000000-0000-4000-8000-000000000001',
   '{"app_metadata": {"role": "editorial_admin", "positions": ["editor_in_chief"]},
     "user_metadata": {"role": "editorial_admin"},
     "user_role": "editorial_admin"}',
   false, false, false, false, 'own', false),
  ('active staff (Staff Writer)', '00000000-0000-4000-8000-000000000002', '{}',
   true, true, false, false, 'own', true),
  ('admin (Head Layout Artist)', '00000000-0000-4000-8000-000000000003', '{}',
   true, true, true, false, 'all', true),
  ('top editor (Associate Editor)', '00000000-0000-4000-8000-000000000004', '{}',
   true, true, true, true, 'all', true),
  ('signed in, with no members row', '00000000-0000-4000-8000-000000000005',
   '{}', false, false, false, false, 'none', false);

create temp table expected as
select c.label,
       case when c.is_current_member then c.member_id end as current_member_id,
       c.is_active,
       c.is_admin,
       c.is_top,
       case c.sees
         when 'none' then 0
         when 'own' then 1
         else (select count(*) from public.members)::int
       end as members_seen,
       c.sees <> 'none' as own_member_seen,
       case c.sees
         when 'none' then 0
         when 'own' then (select count(*) from public.member_positions mp
                          where mp.member_id = c.member_id)::int
         else (select count(*) from public.member_positions)::int
       end as positions_seen,
       (select count(*) from public.member_positions mp
        where mp.member_id = c.member_id)::int as own_positions_seen,
       case when c.sees_org then 35 else 0 end as org_rows,
       true as writes_denied
from callers c;

create temp table observed (like expected);

do $$
declare
  v_callers callers[];
  c callers;
  o observed;
begin
  -- Read the fixtures while still `postgres`: `authenticated` can't read
  -- temp tables.
  select array_agg(x) into v_callers from callers x;

  foreach c in array v_callers loop
    perform set_config(
      'request.jwt.claims',
      (jsonb_build_object('sub', c.member_id, 'role', 'authenticated')
        || c.extra_claims)::text,
      true
    );
    set local role authenticated;

    o.label := c.label;
    o.current_member_id := private.current_member_id();
    o.is_active := private.is_active_member();
    o.is_admin := private.is_admin();
    o.is_top := private.is_top_editor();
    o.members_seen := (select count(*) from public.members);
    o.own_member_seen := exists (
      select 1 from public.members m where m.id = c.member_id
    );
    o.positions_seen := (select count(*) from public.member_positions);
    o.own_positions_seen := (
      select count(*) from public.member_positions mp
      where mp.member_id = c.member_id
    );
    o.org_rows := (select count(*) from public.sections)
      + (select count(*) from public.desks)
      + (select count(*) from public.positions);

    -- Clients write nothing, whatever their role.
    o.writes_denied := true;
    begin
      insert into public.member_positions (member_id, position, is_primary)
      values (c.member_id, 'finance_manager', false);
      o.writes_denied := false;
    exception when insufficient_privilege then null;
    end;
    begin
      update public.members set name = 'Changed' where id = c.member_id;
      o.writes_denied := false;
    exception when insufficient_privilege then null;
    end;
    begin
      delete from public.member_positions where member_id = c.member_id;
      o.writes_denied := false;
    exception when insufficient_privilege then null;
    end;
    begin
      insert into public.sections (id, name, sort_order)
      values ('caller_section', 'Caller Section', 99);
      o.writes_denied := false;
    exception when insufficient_privilege then null;
    end;

    reset role;
    insert into observed select o.*;
  end loop;
end
$$;

select set_eq(
  $$ select * from observed $$,
  $$ select * from expected $$,
  'each caller gets the expected helper results, row visibility and no writes'
);

-- Invariants over every member, seeded and fixture alike.

select is_empty(
  $$ select m.id, m.role from public.members m
     where m.role <> private.role_for_positions(m.id) $$,
  'every member''s role is the role their positions imply'
);

select is_empty(
  $$ select m.id from public.members m
     where m.role <> 'pending'
       and (select count(*) from public.member_positions mp
            where mp.member_id = m.id and mp.is_primary) <> 1 $$,
  'every active member has exactly one primary position'
);

-- Password invariants, which hold locally and on staging: the committed local
-- persona password belongs to the three local personas only, and synthetic
-- members have no password at all.

select is_empty(
  $$ select u.email from auth.users u
     where u.email not in ('persona-staff_layout_artist@example.com',
                           'persona-head_layout_artist@example.com',
                           'persona-editor_in_chief@example.com')
       and u.encrypted_password like '$2%'
       and u.encrypted_password
           = extensions.crypt('local-persona-password', u.encrypted_password) $$,
  'no user but the three personas has the local persona password'
);

select is_empty(
  $$ select u.email from auth.users u
     where u.email like 'demo-%@example.com'
       and coalesce(u.encrypted_password, '') <> '' $$,
  'no synthetic member has a password'
);

select * from finish();

rollback;
