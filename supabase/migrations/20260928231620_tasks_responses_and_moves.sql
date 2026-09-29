-- tasks_responses_and_moves: slot responses, column moves, and the one
-- place the task transition table lives (AD-1, AD-4, AD-16, AD-19).
--
-- - `assignment_reasons` holds a slot's optional hand-back reason, at most
--   one per slot. Only the slot's assignee and the task's approver read it;
--   nobody writes it directly.
-- - `private.is_task_approver` is the only approver definition: an active
--   `editorial_admin` holding a position that heads the task's owner, or a
--   top editor. Opinion and Editorial have no head, so only top editors
--   approve their tasks.
-- - `private.can_respond_to_slot` and `private.can_move_task` are the
--   transition table. The two commands check them after locking the row, and
--   `task_capabilities` builds its answer from them, so what the page offers
--   and what the database accepts can't drift apart. TypeScript never
--   derives an offered action itself.
-- - `respond_to_slot` and `move_task` follow create_task's shape: `security
--   definer` owned by `postgres` with an empty search_path, EXECUTE to
--   `authenticated` only; resolve the actor, lock the row, ask the helper,
--   write and log `activity` in one transaction. Errors are `P0001` with the
--   code as the message.
-- - The activity SELECT policy widens to the slot entity type these commands
--   log.

-- Task detail and task_capabilities list slots in creation order, but every
-- slot one create_task call inserts shares that transaction's now(), which
-- would leave the order to the random ids. clock_timestamp() advances
-- between the inserts. Rows already stored keep their value.
alter table public.task_assignments
  alter column created_at set default clock_timestamp();

-- A slot's hand-back reason. The command trims it and stores it only for a
-- `needs_reassignment` slot with a non-blank reason; the CHECK is the
-- backstop (trimmed of any whitespace, tabs and newlines too, non-blank, at
-- most 280 characters, mirrored by slotRespondSchema).
create table public.assignment_reasons (
  assignment_id uuid primary key
    references public.task_assignments (id) on delete cascade,
  reason text not null
    constraint assignment_reasons_reason_format check (
      char_length(reason) <= 280
      and reason <> ''
      and reason = regexp_replace(reason, '^[[:space:]]+|[[:space:]]+$', '', 'g')
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.assignment_reasons enable row level security;

-- The caller is an active admin whose position heads the task's owning
-- section or desk, or a top editor (Editor-in-Chief, Associate Editor,
-- Managing Editor). False for a missing task and for anyone not active.
create function private.is_task_approver(p_task_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    join public.members m on m.id = (select auth.uid())
    join public.member_positions mp on mp.member_id = m.id
    join public.positions p on p.id = mp.position
    where t.id = p_task_id
      and m.role = 'editorial_admin'
      and (
        p.is_top_editor
        or p.heads_section_id = t.owning_section_id
        or p.heads_desk_id = t.owning_desk_id
      )
  )
$$;

-- The slot edge: `awaiting_response` -> `on_it` | `needs_reassignment`, on
-- the caller's own slot only (each slot a member holds is answered
-- separately). The target state is checked by respond_to_slot itself.
-- False for a missing slot and for anyone not active.
create function private.can_respond_to_slot(p_slot_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce((
    select a.state = 'awaiting_response'
      and a.member_id = private.current_member_id()
    from public.task_assignments a
    where a.id = p_slot_id
      and private.is_active_member()
  ), false)
$$;

-- The move edges. An assignee whose slot on the task is `on_it` moves it
-- among `to_do`, `doing` and `for_review`, either way. Nothing leaves
-- `done`, and a same-column move is refused. False for a missing task and
-- for anyone not active.
create function private.can_move_task(
  p_task_id uuid,
  p_to_column public.task_column
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce((
    select t."column" <> 'done'
      and t."column" <> p_to_column
      and (
        (
          p_to_column <> 'done'
          and exists (
            select 1
            from public.task_assignments a
            where a.task_id = t.id
              and a.member_id = private.current_member_id()
              and a.state = 'on_it'
          )
        )
        -- Prototype edge: any active member moves For Review -> Done.
        -- Epic 3 deletes this branch, when approvers get Mark done.
        or (t."column" = 'for_review' and p_to_column = 'done')
      )
    from public.tasks t
    where t.id = p_task_id
      and private.is_active_member()
  ), false)
$$;

-- Called from RLS (is_task_approver) and from task_capabilities, which runs
-- with the caller's rights.
grant execute on function
  private.is_task_approver(uuid),
  private.can_respond_to_slot(uuid),
  private.can_move_task(uuid, public.task_column)
to authenticated;

-- The slot's own assignee, or the task's approver. `task_assignments` is
-- itself RLS-scoped to active members, so a pending caller matches nothing.
create policy assignment_reasons_select_assignee_or_approver
  on public.assignment_reasons
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.task_assignments a
      where a.id = assignment_reasons.assignment_id
        and (
          a.member_id = (select private.current_member_id())
          or private.is_task_approver(a.task_id)
        )
    )
  );

grant select on public.assignment_reasons to authenticated;

-- A slot's own entity type joins the task's, for active members. Never
-- holds reason text (that stays in assignment_reasons).
alter policy activity_select_task
  on public.activity
  using (
    entity_type in ('task', 'task_assignment')
    and (select private.is_active_member())
  );

-- The caller answers their own awaiting slot: `on_it` or
-- `needs_reassignment`, with an optional reason for the latter. Afterwards
-- the slot has an `assignment_reasons` row only when it is
-- `needs_reassignment` with a non-blank reason; any other row is deleted.
-- Logs one `activity` row for the slot (`slot_<new state>`), never the
-- reason. Raises `auth.not_active`, `tasks.not_found` (no such slot) or
-- `tasks.not_allowed` (not the caller's awaiting slot, or not a response).
create function public.respond_to_slot(
  slot_id uuid,
  response public.slot_state,
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
  where a.id = respond_to_slot.slot_id
  for update;

  if v_slot_id is null then
    raise exception using errcode = 'P0001', message = 'tasks.not_found';
  end if;

  if respond_to_slot.response is null
    or respond_to_slot.response not in ('on_it', 'needs_reassignment')
    or not private.can_respond_to_slot(v_slot_id)
  then
    raise exception using errcode = 'P0001', message = 'tasks.not_allowed';
  end if;

  update public.task_assignments a
  set state = respond_to_slot.response,
      updated_at = now()
  where a.id = v_slot_id;

  v_reason := nullif(
    regexp_replace(
      coalesce(respond_to_slot.reason, ''),
      '^[[:space:]]+|[[:space:]]+$', '', 'g'
    ),
    ''
  );

  if respond_to_slot.response = 'needs_reassignment' and v_reason is not null then
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
    v_op, 'task_assignment', v_slot_id, v_actor,
    'slot_' || respond_to_slot.response::text
  );
end;
$$;

-- The caller moves a task to another column, as private.can_move_task
-- allows. Logs one `activity` row for the task (`moved_to_<column>`).
-- Raises `auth.not_active`, `tasks.not_found` (no such task) or
-- `tasks.not_allowed`.
create function public.move_task(
  task_id uuid,
  to_column public.task_column
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_member_id();
  v_op uuid := gen_random_uuid();
  v_task_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  select t.id into v_task_id
  from public.tasks t
  where t.id = move_task.task_id
  for update;

  if v_task_id is null then
    raise exception using errcode = 'P0001', message = 'tasks.not_found';
  end if;

  if not private.can_move_task(v_task_id, move_task.to_column) then
    raise exception using errcode = 'P0001', message = 'tasks.not_allowed';
  end if;

  update public.tasks t
  set "column" = move_task.to_column,
      updated_at = now()
  where t.id = v_task_id;

  perform private.log_activity(
    v_op, 'task', v_task_id, v_actor,
    'moved_to_' || move_task.to_column::text
  );
end;
$$;

-- What the caller may do on each task: the columns it may move to (in enum
-- order) and the slots it may answer (in creation order). The only source of
-- the actions a page offers. Runs with the caller's rights, so it returns
-- rows only for tasks the caller can read.
create function public.task_capabilities(ids uuid[])
returns table (
  task_id uuid,
  allowed_moves public.task_column[],
  respondable_slot_ids uuid[]
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
    )
  from public.tasks t
  where t.id = any (ids)
$$;

grant execute on function
  public.respond_to_slot(uuid, public.slot_state, text),
  public.move_task(uuid, public.task_column),
  public.task_capabilities(uuid[])
to authenticated;
