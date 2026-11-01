-- tasks_reassign: the approver gives one slot to someone, from a picker that
-- shows each member's load (Story 3.3, AD-1, AD-4, AD-16, AD-19, AD-21).
--
-- - `reassign_slot(slot_id, member_id, expected_updated_at)` checks, in
--   order: active (`auth.not_active`), the locks (the slot, then its live
--   task, else `tasks.not_found`), the approver (`tasks.not_approver`), a
--   Done task (`tasks.not_allowed`), the slot's version (`tasks.stale`), the
--   member (`tasks.invalid_slot_member`, the current member included), then
--   another slot of the task with the same role and member
--   (`tasks.duplicate_slot`, an explicit check: the unique constraint stays
--   immediate, and its 23505 is only a backstop). It then calls
--   `private.reassign_slot_member`, unchanged since tasks_edit: the slot
--   takes the member, starts over as `awaiting_response` and loses its
--   reason row, and the helper logs one `('task_assignment', slot,
--   'slot_reassigned')` row under a fresh `op_id`, never reason text. The
--   same member resets the slot the same way. The task row (column,
--   `updated_at`, `done_at`, the revision note) is never touched.
-- - The version (AD-21) is the slot's `updated_at`, the one the picker was
--   rendered from. `respond_to_slot`, `hand_back_slot` and the reassign
--   helper all bump it, and an unchanged slot in `update_task` doesn't, so
--   two approvers picking at once, or an assignee answering while the picker
--   is open, both raise `tasks.stale`. Comparing only the member would miss
--   the answer.
-- - A Done task is refused (decided 2026-11-01). tasks_edit made a Done task
--   text-only, and a slot reassigned there would wait for an answer nobody
--   can give: a Done task offers no slot responses.
-- - `task_capabilities` gains `can_reassign`: the caller is the task's
--   approver and the task isn't Done. The approver check runs once per task,
--   in a materialized CTE that `can_manage` and `can_reassign` share (a plain
--   subquery would be flattened, repeating the call); every approver is an
--   admin, so `(select private.is_admin())`, an InitPlan run once per call,
--   still spares a staff caller the per-task check. Every other column and
--   the grant are unchanged.
-- - `member_open_slot_counts()` is the picker's load: one row per
--   `member_directory` member, counting `private.open_slots(member)`, the one
--   definition of an open slot (AD-19). It runs with the caller's rights, so
--   it adds no predicate of its own: `member_directory` lists active members,
--   and only to an active caller; `open_slots` reads through RLS, which shows
--   an active member every live task's slots. The counts are what the Board
--   already shows, and a caller who isn't active gets no rows.
-- - `update_task` is replaced, with the same signature and grant. Each slot
--   row with an `id` must carry `loaded_member_id`, the member the form
--   loaded, equal to the stored one, else `tasks.stale` (beside the other id
--   checks), so a save no longer silently reverts a reassignment made after
--   the form loaded. A slot added after the form loaded is still removed: no
--   reassign adds a slot, so that half stays deferred. Otherwise unchanged.
--
-- Lock order, as tasks_approver_review set it and tasks_delete and tasks_edit
-- kept it: a slot command locks its slot, then the task (`respond_to_slot`,
-- `hand_back_slot`, `reassign_slot`). `update_task` writes slots, so it locks
-- every slot of the task, in id order, before the task, and keeps the ids it
-- locked. A task command locks only the task (`move_task`, `mark_done`,
-- `send_back_task`, `reopen_task`, `delete_task`). No command locks a slot
-- after its task, so two commands can't wait on each other. `reassign_slot`
-- reads the task's other slots for its duplicate check without locking them,
-- which is safe because every slot writer holds the task lock. Only another
-- `update_task` adds a slot, and it holds the task while it does, so once
-- `update_task` has the task no slot can appear; one that appeared between
-- its two locks (added while it waited for the task) was never locked, so it
-- raises `tasks.stale` rather than lock or write it after the task. A slot
-- the form still holds but that is gone, or whose member changed since the
-- form loaded, raises `tasks.stale` too.

-- The approver saves the task form in edit mode. `slots` is
-- `[{"id": "<uuid>"?, "loaded_member_id": "<uuid>"?, "role": "<role>",
-- "member_id": "<uuid>"}, ...]`: a row with an id is that existing slot, and
-- carries the member the form loaded it with; one without is a new slot.
-- Raises `auth.not_active`, `tasks.not_found` (no such task, or deleted),
-- `tasks.not_approver`, `tasks.stale`, `tasks.no_slots`,
-- `tasks.not_allowed`, `tasks.invalid_slot_member` or
-- `tasks.duplicate_slot` (see tasks_edit's header). Returns true when any
-- slot got a new member.
create or replace function public.update_task(
  task_id uuid,
  title text,
  description text,
  due_at timestamptz,
  reference_url text,
  slots jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_member_id();
  v_op uuid := gen_random_uuid();
  v_locked_slots uuid[];
  v_task public.tasks%rowtype;
  v_fields_changed boolean;
  v_slots_changed boolean;
  v_new_member boolean := false;
  v_slot record;
  v_slot_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  -- Slots before their task, in id order, so this can't deadlock with
  -- respond_to_slot, hand_back_slot or reassign_slot, nor with another
  -- update_task. The ids locked here are the only slots this command may
  -- write.
  select coalesce(array_agg(l.id), '{}') into v_locked_slots
  from (
    select a.id
    from public.task_assignments a
    where a.task_id = update_task.task_id
    order by a.id
    for update
  ) as l;

  select t.* into v_task
  from public.tasks t
  where t.id = update_task.task_id and t.deleted_at is null
  for update;

  if v_task.id is null then
    raise exception using errcode = 'P0001', message = 'tasks.not_found';
  end if;

  if not private.is_task_approver(v_task.id) then
    raise exception using errcode = 'P0001', message = 'tasks.not_approver';
  end if;

  -- A slot another update_task added while this one waited for the task
  -- isn't locked, and locking it now would lock a slot after its task.
  if exists (
    select 1
    from public.task_assignments a
    where a.task_id = v_task.id
      and a.id <> all (v_locked_slots)
  ) then
    raise exception using errcode = 'P0001', message = 'tasks.stale';
  end if;

  if update_task.slots is null
    or jsonb_typeof(update_task.slots) <> 'array'
    or jsonb_array_length(update_task.slots) < 1
  then
    raise exception using errcode = 'P0001', message = 'tasks.no_slots';
  end if;

  -- An id that isn't one of this task's slots (another approver removed
  -- it), an id listed twice, an id whose role isn't the stored one, or an id
  -- whose stored member isn't the one the form loaded (another approver
  -- reassigned it since; a missing loaded member counts as a mismatch).
  if exists (
    select 1
    from jsonb_array_elements(update_task.slots) as s
    where s.value ->> 'id' is not null
      and not exists (
        select 1
        from public.task_assignments a
        where a.id = (s.value ->> 'id')::uuid
          and a.task_id = v_task.id
          and a.role = (s.value ->> 'role')::public.production_role
      )
  ) or exists (
    select 1
    from jsonb_array_elements(update_task.slots) as s
    where s.value ->> 'id' is not null
    group by (s.value ->> 'id')::uuid
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_array_elements(update_task.slots) as s
    join public.task_assignments a
      on a.id = (s.value ->> 'id')::uuid
    where s.value ->> 'id' is not null
      and a.member_id is distinct from (s.value ->> 'loaded_member_id')::uuid
  ) then
    raise exception using errcode = 'P0001', message = 'tasks.stale';
  end if;

  -- Whether any slot is removed (a stored slot left out), reassigned (same
  -- id, another member) or added (no id).
  v_slots_changed := exists (
    select 1
    from public.task_assignments a
    where a.task_id = v_task.id
      and not exists (
        select 1
        from jsonb_array_elements(update_task.slots) as s
        where (s.value ->> 'id')::uuid = a.id
      )
  ) or exists (
    select 1
    from jsonb_array_elements(update_task.slots) as s
    left join public.task_assignments a
      on a.id = (s.value ->> 'id')::uuid
    where a.id is null
       or a.member_id is distinct from (s.value ->> 'member_id')::uuid
  );

  -- A Done task's slots offer no answers, so its edits are text-only.
  if v_task."column" = 'done' and v_slots_changed then
    raise exception using errcode = 'P0001', message = 'tasks.not_allowed';
  end if;

  -- A new row's member, or a changed member, must be active. An unchanged
  -- slot keeps its member, active or not.
  if exists (
    select 1
    from jsonb_array_elements(update_task.slots) as s
    left join public.task_assignments a
      on a.id = (s.value ->> 'id')::uuid
    where (a.id is null
           or a.member_id is distinct from (s.value ->> 'member_id')::uuid)
      and not private.is_member_active((s.value ->> 'member_id')::uuid)
  ) then
    raise exception using errcode = 'P0001', message = 'tasks.invalid_slot_member';
  end if;

  -- The list is the final set of slots, so a duplicate is one within it.
  if exists (
    select 1
    from jsonb_array_elements(update_task.slots) as s
    group by (s.value ->> 'role')::public.production_role,
             (s.value ->> 'member_id')::uuid
    having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'tasks.duplicate_slot';
  end if;

  v_fields_changed :=
    v_task.title is distinct from update_task.title
    or v_task.description is distinct from update_task.description
    or v_task.due_at is distinct from update_task.due_at
    or v_task.reference_url is distinct from update_task.reference_url;

  -- Nothing to save: no write, no activity, the version stays.
  if not v_fields_changed and not v_slots_changed then
    return false;
  end if;

  update public.tasks t
  set title = update_task.title,
      description = update_task.description,
      due_at = update_task.due_at,
      reference_url = update_task.reference_url,
      updated_at = now()
  where t.id = v_task.id;

  -- Two same-role slots may trade members, which holds a duplicate pair
  -- between the two writes. Set back to immediate below.
  set constraints public.task_assignments_task_id_member_id_role_key deferred;

  -- Every slot left out (all of them locked above). Its reason row
  -- cascades.
  for v_slot_id in
    delete from public.task_assignments a
    where a.task_id = v_task.id
      and not exists (
        select 1
        from jsonb_array_elements(update_task.slots) as s
        where (s.value ->> 'id')::uuid = a.id
      )
    returning a.id
  loop
    perform private.log_activity(
      v_op, 'task_assignment', v_slot_id, v_actor, 'slot_removed'
    );
  end loop;

  -- The same id with a new member. The loop's query reads the slots as they
  -- stood before it, so each slot's stored member is compared once.
  for v_slot in
    select a.id, (s.value ->> 'member_id')::uuid as member_id
    from jsonb_array_elements(update_task.slots) with ordinality as s (value, n)
    join public.task_assignments a on a.id = (s.value ->> 'id')::uuid
    where a.member_id is distinct from (s.value ->> 'member_id')::uuid
    order by s.n
  loop
    perform private.reassign_slot_member(
      v_slot.id, v_slot.member_id, v_actor, v_op
    );
    v_new_member := true;
  end loop;

  -- Rows without an id, in the form's order (created_at is clock_timestamp,
  -- so they list in that order too).
  for v_slot in
    select (s.value ->> 'member_id')::uuid as member_id,
           (s.value ->> 'role')::public.production_role as role
    from jsonb_array_elements(update_task.slots) with ordinality as s (value, n)
    where s.value ->> 'id' is null
    order by s.n
  loop
    insert into public.task_assignments (task_id, member_id, role)
    values (v_task.id, v_slot.member_id, v_slot.role)
    returning id into v_slot_id;

    perform private.log_activity(
      v_op, 'task_assignment', v_slot_id, v_actor, 'slot_added'
    );
    v_new_member := true;
  end loop;

  -- Checks the pairs written above now, and leaves the rest of the
  -- transaction as every other command expects it.
  set constraints public.task_assignments_task_id_member_id_role_key immediate;

  perform private.log_activity(v_op, 'task', v_task.id, v_actor, 'updated');

  return v_new_member;
end;
$$;

grant execute on function
  public.update_task(uuid, text, text, timestamptz, text, jsonb)
to authenticated;

-- A new column changes the return type, so the function is replaced.
drop function public.task_capabilities(uuid[]);

-- What the caller may do on each task: the columns it may move to (in enum
-- order), the slots it may answer and hand back (in creation order), whether
-- it may review (Mark done, Send back) or reopen the task, whether it may
-- manage it (Edit, Delete), and whether it may reassign its slots (the
-- approver, on a task that isn't Done). The only source of the actions a
-- page offers. Runs with the caller's rights, so it returns rows only for
-- tasks the caller can read: never a deleted one.
create function public.task_capabilities(ids uuid[])
returns table (
  task_id uuid,
  allowed_moves public.task_column[],
  respondable_slot_ids uuid[],
  hand_back_slot_ids uuid[],
  can_review boolean,
  can_reopen boolean,
  can_manage boolean,
  can_reassign boolean
)
language sql
security invoker
stable
set search_path = ''
as $$
  -- The approver check, once per task, shared by can_manage and
  -- can_reassign. Every approver is an admin: the InitPlan runs once per
  -- call, so a staff caller pays nothing per task. Materialized, so it isn't
  -- flattened into the select below and run once per column.
  with ap as materialized (
    select
      t.id,
      case
        when (select private.is_admin()) then private.is_task_approver(t.id)
        else false
      end as is_approver
    from public.tasks t
    where t.id = any (ids)
  )
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
    ),
    private.can_review_task(t.id),
    private.can_reopen_task(t.id),
    ap.is_approver,
    ap.is_approver and t."column" <> 'done'
  from public.tasks t
  join ap on ap.id = t.id
$$;

grant execute on function public.task_capabilities(uuid[]) to authenticated;

-- The picker's load: each member the caller's member_directory lists, with
-- the number of their open slots (private.open_slots, the one definition).
-- Runs with the caller's rights, so a caller who isn't active gets no rows.
create function public.member_open_slot_counts()
returns table (member_id uuid, open_slots integer)
language sql
security invoker
stable
set search_path = ''
as $$
  select
    d.id,
    (select count(*) from private.open_slots(d.id))::integer
  from public.member_directory d
$$;

grant execute on function public.member_open_slot_counts() to authenticated;

-- The approver gives one slot to `member_id`, passing the slot's
-- `updated_at` the picker was rendered from (AD-21). The slot starts over as
-- `awaiting_response` for that member, without its reason row; the same
-- member resets it. Raises `auth.not_active`, `tasks.not_found` (no such
-- slot, or its task is deleted), `tasks.not_approver`, `tasks.not_allowed`
-- (a Done task), `tasks.stale` (the slot changed since, or no version was
-- given), `tasks.invalid_slot_member` (the member isn't active) or
-- `tasks.duplicate_slot` (another slot of the task already pairs that role
-- with that member). It locks the slot, then the task, and nothing else.
create function public.reassign_slot(
  slot_id uuid,
  member_id uuid,
  expected_updated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_member_id();
  v_op uuid := gen_random_uuid();
  v_slot record;
  v_task record;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  select a.id, a.task_id, a.role, a.updated_at into v_slot
  from public.task_assignments a
  where a.id = reassign_slot.slot_id
  for update;

  if v_slot.id is null then
    raise exception using errcode = 'P0001', message = 'tasks.not_found';
  end if;

  -- The slot's task, after the slot, as respond_to_slot and hand_back_slot
  -- do. A deleted task is missing.
  select t.id, t."column" into v_task
  from public.tasks t
  where t.id = v_slot.task_id and t.deleted_at is null
  for update of t;

  if v_task.id is null then
    raise exception using errcode = 'P0001', message = 'tasks.not_found';
  end if;

  if not private.is_task_approver(v_task.id) then
    raise exception using errcode = 'P0001', message = 'tasks.not_approver';
  end if;

  -- A Done task offers no slot responses, so nobody could answer.
  if v_task."column" = 'done' then
    raise exception using errcode = 'P0001', message = 'tasks.not_allowed';
  end if;

  if v_slot.updated_at is distinct from reassign_slot.expected_updated_at then
    raise exception using errcode = 'P0001', message = 'tasks.stale';
  end if;

  -- The current member too: someone who left can't be given the slot back.
  if not private.is_member_active(reassign_slot.member_id) then
    raise exception using errcode = 'P0001', message = 'tasks.invalid_slot_member';
  end if;

  -- Read without a lock: every slot writer holds the task, as this does.
  if exists (
    select 1
    from public.task_assignments a
    where a.task_id = v_task.id
      and a.id <> v_slot.id
      and a.role = v_slot.role
      and a.member_id = reassign_slot.member_id
  ) then
    raise exception using errcode = 'P0001', message = 'tasks.duplicate_slot';
  end if;

  perform private.reassign_slot_member(
    v_slot.id, reassign_slot.member_id, v_actor, v_op
  );
end;
$$;

grant execute on function
  public.reassign_slot(uuid, uuid, timestamptz)
to authenticated;
