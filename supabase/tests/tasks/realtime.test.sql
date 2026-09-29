-- Live Board (AD-14): the private `task-changes` channel's one policy on
-- realtime.messages, and private.can_join_task_changes(), the condition it
-- asks. The policy is SELECT-only for `authenticated` and covers the broadcast
-- extension only; there is no INSERT policy, so nobody can send. The function
-- is run here as each caller, since realtime.messages is partitioned and
-- `postgres` can't add a partition to hold test rows.
--
-- Fixture auth users are created here and everything is rolled back, so it
-- runs locally and on staging (`supabase test db --linked`), seeded or not.

begin;

-- See responses_and_moves.test.sql: run as `postgres` with `extensions` on the
-- path, whichever role `supabase test db --linked` connected as.
set local role postgres;
set local search_path = "$user", public, extensions;

select plan(14);

-- Fixtures: an active staff member, an active admin (a desk Head) and a
-- pending member (no positions).

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

select pg_temp.new_member('00000000-0000-4000-d000-000000000001', 'rt-staff@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-d000-000000000002', 'rt-head@example.com', 'head_cartoonist');
select pg_temp.new_member('00000000-0000-4000-d000-000000000003', 'rt-pending@example.com', null);

-- Ask can_join_task_changes() as the given caller (null: no claims at all)
-- while Realtime is authorizing the given topic (null: no topic set).
create function pg_temp.can_join_as(p_caller uuid, p_topic text)
returns boolean
language plpgsql as $$
declare
  v_result boolean;
begin
  perform set_config(
    'request.jwt.claims',
    case when p_caller is null then '{}'
         else jsonb_build_object('sub', p_caller, 'role', 'authenticated')::text
    end,
    true
  );
  perform set_config('realtime.topic', coalesce(p_topic, ''), true);
  set local role authenticated;
  select private.can_join_task_changes() into v_result;
  set local role postgres;
  return v_result;
end;
$$;

-- The policy.

select policies_are(
  'realtime',
  'messages',
  array['messages_select_task_changes'],
  'realtime.messages holds exactly the task-changes SELECT policy'
);

select policy_cmd_is(
  'realtime',
  'messages',
  'messages_select_task_changes',
  'select',
  'the policy is SELECT only (nobody can send on the channel)'
);

select policy_roles_are(
  'realtime',
  'messages',
  'messages_select_task_changes',
  array['authenticated'],
  'the policy applies to authenticated only'
);

select ok(
  (select qual from pg_policies
    where schemaname = 'realtime' and tablename = 'messages'
      and policyname = 'messages_select_task_changes') like '%''broadcast''%',
  'the policy covers the broadcast extension'
);

select ok(
  (select qual from pg_policies
    where schemaname = 'realtime' and tablename = 'messages'
      and policyname = 'messages_select_task_changes') like '%can_join_task_changes()%',
  'the policy asks private.can_join_task_changes()'
);

-- The function's pins: the caller's rights, stable, an empty search_path.

select isnt_definer('private', 'can_join_task_changes', array[]::text[],
  'private.can_join_task_changes() is security invoker');
select volatility_is('private', 'can_join_task_changes', array[]::text[], 'stable',
  'private.can_join_task_changes() is stable');
select is(
  (select p.proconfig from pg_proc p
    where p.oid = 'private.can_join_task_changes()'::regprocedure),
  array['search_path=""'],
  'private.can_join_task_changes() sets search_path = '''''
);

-- Who may join, and which topic.

select is(
  pg_temp.can_join_as('00000000-0000-4000-d000-000000000001', 'task-changes'),
  true,
  'an active staff member may join task-changes'
);
select is(
  pg_temp.can_join_as('00000000-0000-4000-d000-000000000002', 'task-changes'),
  true,
  'an active admin may join task-changes'
);
select is(
  pg_temp.can_join_as('00000000-0000-4000-d000-000000000003', 'task-changes'),
  false,
  'a pending member may not join task-changes'
);
select is(
  pg_temp.can_join_as(null, 'task-changes'),
  false,
  'a caller with no claims may not join task-changes'
);
select is(
  pg_temp.can_join_as('00000000-0000-4000-d000-000000000001', 'other-topic'),
  false,
  'an active member may not join another topic through this policy'
);
select is(
  pg_temp.can_join_as('00000000-0000-4000-d000-000000000001', null),
  false,
  'outside a channel join (no topic) the answer is false, not null'
);

select * from finish();
rollback;
