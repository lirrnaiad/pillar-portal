-- Open slots (AD-19): the one definition of "open", so What's mine and, later,
-- the Planner never decide it in TypeScript. A slot is open while it awaits
-- the member's answer or the member is on it, and its task isn't Done.
-- (Epic 3 adds `and t.deleted_at is null` here, and only here.)
--
-- Both functions run with the caller's rights: RLS stays in charge, so a
-- caller who isn't an active member reads no rows at all.
create function private.open_slots(p_member_id uuid)
returns setof public.task_assignments
language sql
security invoker
stable
set search_path = ''
as $$
  select a.*
  from public.task_assignments a
  join public.tasks t on t.id = a.task_id
  where a.member_id = p_member_id
    and a.state in ('awaiting_response', 'on_it')
    and t."column" <> 'done'
$$;

-- The viewer's own open slots. For a pending or rowless caller
-- current_member_id() is null, so nothing matches.
create function public.my_open_slots()
returns setof public.task_assignments
language sql
security invoker
stable
set search_path = ''
as $$
  select * from private.open_slots((select private.current_member_id()))
$$;

grant execute on function
  private.open_slots(uuid),
  public.my_open_slots()
to authenticated;
