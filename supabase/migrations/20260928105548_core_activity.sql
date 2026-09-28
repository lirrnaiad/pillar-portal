-- core_activity: one shared audit trail every slice logs to (AD-2, AD-16).
--
-- Each command writes one row per entity it affects, sharing one `op_id` so a
-- single command's rows can be grouped. There is no reason text here (a
-- slot's hand-back reason, for instance, lives with the slice that owns it).
--
-- RLS is on with no policy: nobody reads a row until a slice adds its own
-- SELECT policy scoped to the entity types it owns (tasks_tasks adds the
-- first, for `entity_type = 'task'`). Mirrors core_org_reference's
-- grant-now-policy-later shape.
--
-- `private.log_activity` is a plain (not `security definer`) helper: it only
-- ever runs nested inside a command that already is `security definer` (such
-- as create_task), so it executes with that command's privileges and needs
-- no EXECUTE grant of its own.

create table public.activity (
  id uuid primary key default gen_random_uuid(),
  op_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  actor_id uuid references public.members (id),
  action text not null,
  created_at timestamptz not null default now()
);

create index activity_entity_idx on public.activity (entity_type, entity_id);
create index activity_op_id_idx on public.activity (op_id);

alter table public.activity enable row level security;

grant select on public.activity to authenticated;

create function private.log_activity(
  p_op_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_actor_id uuid,
  p_action text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.activity (op_id, entity_type, entity_id, actor_id, action)
  values (p_op_id, p_entity_type, p_entity_id, p_actor_id, p_action);
end;
$$;
