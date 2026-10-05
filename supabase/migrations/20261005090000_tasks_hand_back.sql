-- tasks_hand_back: an assignee who is On it hands the slot back (AD-1, AD-4).
--
-- - `private.can_hand_back_slot` is the one definition of the edge
--   `on_it` -> `needs_reassignment` on the caller's own slot, on a task that
--   isn't Done. `hand_back_slot` checks it after locking the slot, and
--   `task_capabilities` builds `hand_back_slot_ids` from it, so what the page
--   offers and what the database accepts can't drift apart.
-- - The command follows respond_to_slot's shape. The reason is stored (or
--   replaced) only when non-blank; a blank one removes any earlier row. The
--   activity row never holds it. The task's column is never touched.

create function private.can_hand_back_slot(p_slot_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce((
    select a.state = 'on_it'
      and a.member_id = private.current_member_id()
      and t."column" <> 'done'
    from public.task_assignments a
    join public.tasks t on t.id = a.task_id
    where a.id = p_slot_id
      and private.is_active_member()
  ), false)
$$;

grant execute on function private.can_hand_back_slot(uuid) to authenticated;

-- Raises `auth.not_active`, `tasks.not_found` (no such slot) or
-- `tasks.not_allowed` (not the caller's On it slot, or the task is Done).
create function public.hand_back_slot(
  slot_id uuid,
  reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_member_id();
  v_op uuid := gen_random_uuid();
  v_slot_id uuid;
  v_reason text;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  select a.id into v_slot_id
  from public.task_assignments a
  where a.id = hand_back_slot.slot_id
  for update;

  if v_slot_id is null then
    raise exception using errcode = 'P0001', message = 'tasks.not_found';
  end if;

  -- Lock the task too, as move_task does, so a move to Done can't commit
  -- between the check below and the write.
  perform 1
  from public.tasks t
  join public.task_assignments a on a.task_id = t.id
  where a.id = v_slot_id
  for update of t;

  if not private.can_hand_back_slot(v_slot_id) then
    raise exception using errcode = 'P0001', message = 'tasks.not_allowed';
  end if;

  update public.task_assignments a
  set state = 'needs_reassignment',
      updated_at = now()
  where a.id = v_slot_id;

  v_reason := nullif(
    regexp_replace(
      coalesce(hand_back_slot.reason, ''),
      '^[[:space:]]+|[[:space:]]+$', '', 'g'
    ),
    ''
  );

  if v_reason is not null then
    insert into public.assignment_reasons (assignment_id, reason)
    values (v_slot_id, v_reason)
    on conflict (assignment_id) do update
      set reason = excluded.reason,
          updated_at = now();
  else
    delete from public.assignment_reasons r
    where r.assignment_id = v_slot_id;
  end if;

  perform private.log_activity(
    v_op, 'task_assignment', v_slot_id, v_actor, 'slot_needs_reassignment'
  );
end;
$$;

grant execute on function public.hand_back_slot(uuid, text) to authenticated;

-- A new column changes the return type, so the function is replaced.
drop function public.task_capabilities(uuid[]);

create function public.task_capabilities(ids uuid[])
returns table (
  task_id uuid,
  allowed_moves public.task_column[],
  respondable_slot_ids uuid[],
  hand_back_slot_ids uuid[]
)
language sql
security invoker
stable
set search_path = ''
as $$
  select
    t.id,
    array(
      select c.col
      from unnest(enum_range(null::public.task_column)) with ordinality as c (col, n)
      where private.can_move_task(t.id, c.col)
      order by c.n
    ),
    array(
      select a.id
      from public.task_assignments a
      where a.task_id = t.id
        and private.can_respond_to_slot(a.id)
      order by a.created_at, a.id
    ),
    array(
      select a.id
      from public.task_assignments a
      where a.task_id = t.id
        and private.can_hand_back_slot(a.id)
      order by a.created_at, a.id
    )
  from public.tasks t
  where t.id = any (ids)
$$;

grant execute on function public.task_capabilities(uuid[]) to authenticated;
