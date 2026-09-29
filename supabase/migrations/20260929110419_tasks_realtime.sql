-- Live Board (AD-14): tasks and task_assignments join the Realtime publication
-- so an open Board can refetch when either changes. The browser only uses the
-- event as a signal and never reads its payload.
--
-- Each table is added only if it isn't published yet: a table switched on in a
-- project's dashboard would otherwise make this migration fail there.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'task_assignments'
  ) then
    alter publication supabase_realtime add table public.task_assignments;
  end if;
end
$$;

-- Whether the caller may join the private `task-changes` channel: the topic
-- Realtime is authorizing is `task-changes` (realtime.topic() is null outside
-- a join) and the caller is an active member. It is a function rather than
-- inline in the policy so pgTAP can run it as each caller: realtime.messages
-- is partitioned, and `postgres` can't add a partition to hold test rows.
-- Invoker: it only combines realtime.topic() and private.is_active_member().
create function private.can_join_task_changes()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select realtime.topic()) = 'task-changes', false)
    and (select private.is_active_member())
$$;

grant execute on function private.can_join_task_changes() to authenticated;

-- The channel is private: with "Allow public access" off, Realtime rejects
-- non-private joins, and a private join needs SELECT on realtime.messages for
-- its topic. Active members may join `task-changes`; postgres_changes delivery
-- is then gated by the tables' own RLS. There is no INSERT policy, so nobody
-- can send on the channel and Broadcast stays unused.
create policy messages_select_task_changes on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select private.can_join_task_changes())
  );
