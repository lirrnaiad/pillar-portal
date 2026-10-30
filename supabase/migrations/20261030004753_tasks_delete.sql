-- tasks_delete: the approver deletes a task, softly (Story 3.2, AD-1, AD-4,
-- AD-16, AD-19, AD-21).
--
-- - `deleted_at` marks a deleted task. Nothing is removed: the task, its
--   slots, their reasons and the activity stay stored, and every read and
--   every command treats them as missing.
-- - Hidden everywhere: `tasks_select_active`, `task_assignments_select_active`
--   and `activity_select_task` each require a live task (a `task` activity
--   row its task, a `task_assignment` row its slot on a live task).
--   `assignment_reasons_select_assignee_or_approver` is unchanged: its
--   subquery reads the RLS-filtered slots, and `private.is_task_approver`
--   refuses a deleted task.
-- - Missing = deleted. The `security definer` helpers and commands bypass
--   RLS, so each loads its id argument with the read predicate:
--   `can_respond_to_slot`, `can_hand_back_slot`, `can_move_task`,
--   `can_review_task`, `can_reopen_task` and `is_task_approver` return false
--   on a deleted task, and `open_slots` (invoker) states it too. The task
--   commands lock `where t.id = ... and t.deleted_at is null for update`,
--   and the slot commands lock the task with the same predicate after the
--   slot; no row is `tasks.not_found`. Signatures, grants and behavior are
--   otherwise unchanged.
-- - `delete_task(task_id, expected_updated_at)` checks, in order: active
--   (`auth.not_active`), the lock (`tasks.not_found`), the approver
--   (`tasks.not_approver`), then the version the confirmation was rendered
--   from (`tasks.stale`). It sets `deleted_at` and `updated_at` and logs
--   `deleted`; the column, `done_at`, the revision note and the slots are
--   untouched.
-- - `task_capabilities` gains `can_manage`: the caller is the task's
--   approver. Every approver is an admin, so `(select private.is_admin())`,
--   an InitPlan run once per call, spares a staff caller the per-task
--   approver check.
--
-- Realtime: a soft delete sends no event. Realtime delivers a change only to
-- a subscriber who can still read the row, and after the update nobody can.
-- Open Boards drop the card on their next refetch for any reason; Broadcast
-- and the publication are unchanged.
--
-- Lock order, as tasks_approver_review set it: a slot command locks its
-- slot, then the task (`respond_to_slot`, `hand_back_slot`). A task command
-- locks only the task (`move_task`, `mark_done`, `send_back_task`,
-- `reopen_task`, `delete_task`), and `delete_task` never reads the slots. No
-- command locks a slot after its task, so two commands can't wait on each
-- other.

alter table public.tasks
  add column deleted_at timestamptz;

-- Reads: a deleted task, its slots and their activity are hidden from every
-- caller.
alter policy tasks_select_active
  on public.tasks
  using (
    (select private.is_active_member())
    and deleted_at is null
  );

alter policy task_assignments_select_active
  on public.task_assignments
  using (
    (select private.is_active_member())
    and exists (
      select 1
      from public.tasks t
      where t.id = task_assignments.task_id
        and t.deleted_at is null
    )
  );

alter policy activity_select_task
  on public.activity
  using (
    (select private.is_active_member())
    and (
      (
        entity_type = 'task'
        and exists (
          select 1
          from public.tasks t
          where t.id = activity.entity_id
            and t.deleted_at is null
        )
      )
      or (
        entity_type = 'task_assignment'
        and exists (
          select 1
          from public.task_assignments a
          join public.tasks t on t.id = a.task_id
          where a.id = activity.entity_id
            and t.deleted_at is null
        )
      )
    )
  );

-- The approver definition, now false for a deleted task. Otherwise
-- unchanged.
create or replace function private.is_task_approver(p_task_id uuid)
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
      and t.deleted_at is null
      and private.is_member_active(m.id)
      and m.role = 'editorial_admin'
      and (
        p.is_top_editor
        or p.heads_section_id = t.owning_section_id
        or p.heads_desk_id = t.owning_desk_id
      )
  )
$$;

-- The slot edges, now false on a deleted task. Otherwise unchanged.
create or replace function private.can_respond_to_slot(p_slot_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce((
    select a.state = 'awaiting_response'
      and a.member_id = private.current_member_id()
      and t."column" <> 'done'
    from public.task_assignments a
    join public.tasks t on t.id = a.task_id
    where a.id = p_slot_id
      and t.deleted_at is null
      and private.is_active_member()
  ), false)
$$;

create or replace function private.can_hand_back_slot(p_slot_id uuid)
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
      and t.deleted_at is null
      and private.is_active_member()
  ), false)
$$;

-- The move edges, now false on a deleted task. Otherwise unchanged.
create or replace function private.can_move_task(
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
      and p_to_column <> 'done'
      and t."column" <> p_to_column
      and exists (
        select 1
        from public.task_assignments a
        where a.task_id = t.id
          and a.member_id = private.current_member_id()
          and a.state = 'on_it'
      )
    from public.tasks t
    where t.id = p_task_id
      and t.deleted_at is null
      and private.is_active_member()
  ), false)
$$;

-- The review edges, now false on a deleted task. Otherwise unchanged.
create or replace function private.can_review_task(p_task_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce((
    select case
      when t."column" = 'for_review' then private.is_task_approver(t.id)
      else false
    end
    from public.tasks t
    where t.id = p_task_id
      and t.deleted_at is null
  ), false)
$$;

create or replace function private.can_reopen_task(p_task_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce((
    select case
      when t."column" = 'done' then private.is_task_approver(t.id)
      else false
    end
    from public.tasks t
    where t.id = p_task_id
      and t.deleted_at is null
  ), false)
$$;

-- Open slots: a deleted task's slots are never open. It runs with the
-- caller's rights, so RLS already hides them; the predicate is stated anyway
-- (tasks_open_slots's header). Otherwise unchanged.
create or replace function private.open_slots(p_member_id uuid)
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
    and t.deleted_at is null
$$;

-- Unchanged but for the task lock, which now finds no deleted task.
create or replace function public.respond_to_slot(
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
  v_task_id uuid;
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

  -- Lock the task too, as hand_back_slot does, so a Mark done can't commit
  -- between the check below and the write. A deleted task is missing.
  select t.id into v_task_id
  from public.tasks t
  join public.task_assignments a on a.task_id = t.id
  where a.id = v_slot_id
    and t.deleted_at is null
  for update of t;

  if v_task_id is null then
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

-- Unchanged but for the task lock, which now finds no deleted task.
create or replace function public.hand_back_slot(
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
  v_task_id uuid;
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
  -- between the check below and the write. A deleted task is missing.
  select t.id into v_task_id
  from public.tasks t
  join public.task_assignments a on a.task_id = t.id
  where a.id = v_slot_id
    and t.deleted_at is null
  for update of t;

  if v_task_id is null then
    raise exception using errcode = 'P0001', message = 'tasks.not_found';
  end if;

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

-- Unchanged but for the lock, which now finds no deleted task.
create or replace function public.move_task(
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
  where t.id = move_task.task_id and t.deleted_at is null
  for update;

  if v_task_id is null then
    raise exception using errcode = 'P0001', message = 'tasks.not_found';
  end if;

  if not private.can_move_task(v_task_id, move_task.to_column) then
    raise exception using errcode = 'P0001', message = 'tasks.not_allowed';
  end if;

  update public.tasks t
  set "column" = move_task.to_column,
      revision_note = null,
      revision_note_by = null,
      revision_note_at = null,
      updated_at = now()
  where t.id = v_task_id;

  perform private.log_activity(
    v_op, 'task', v_task_id, v_actor,
    'moved_to_' || move_task.to_column::text
  );
end;
$$;

-- Unchanged but for the lock, which now finds no deleted task.
create or replace function public.mark_done(task_id uuid)
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
  where t.id = mark_done.task_id and t.deleted_at is null
  for update;

  if v_task_id is null then
    raise exception using errcode = 'P0001', message = 'tasks.not_found';
  end if;

  if not private.can_review_task(v_task_id) then
    raise exception using errcode = 'P0001', message =
      case when private.is_task_approver(v_task_id)
        then 'tasks.stale' else 'tasks.not_approver' end;
  end if;

  update public.tasks t
  set "column" = 'done',
      done_at = now(),
      revision_note = null,
      revision_note_by = null,
      revision_note_at = null,
      updated_at = now()
  where t.id = v_task_id;

  perform private.log_activity(v_op, 'task', v_task_id, v_actor, 'marked_done');
end;
$$;

-- Unchanged but for the lock, which now finds no deleted task.
create or replace function public.send_back_task(task_id uuid, note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_member_id();
  v_op uuid := gen_random_uuid();
  v_task_id uuid;
  v_note text;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  select t.id into v_task_id
  from public.tasks t
  where t.id = send_back_task.task_id and t.deleted_at is null
  for update;

  if v_task_id is null then
    raise exception using errcode = 'P0001', message = 'tasks.not_found';
  end if;

  if not private.can_review_task(v_task_id) then
    raise exception using errcode = 'P0001', message =
      case when private.is_task_approver(v_task_id)
        then 'tasks.stale' else 'tasks.not_approver' end;
  end if;

  v_note := regexp_replace(
    coalesce(send_back_task.note, ''),
    '^[[:space:]]+|[[:space:]]+$', '', 'g'
  );

  if v_note = '' or char_length(v_note) > 5000 then
    raise exception using errcode = 'P0001', message = 'tasks.invalid_note';
  end if;

  update public.tasks t
  set "column" = 'doing',
      revision_note = v_note,
      revision_note_by = v_actor,
      revision_note_at = now(),
      updated_at = now()
  where t.id = v_task_id;

  perform private.log_activity(v_op, 'task', v_task_id, v_actor, 'sent_back');
end;
$$;

-- Unchanged but for the lock, which now finds no deleted task.
create or replace function public.reopen_task(task_id uuid)
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
  where t.id = reopen_task.task_id and t.deleted_at is null
  for update;

  if v_task_id is null then
    raise exception using errcode = 'P0001', message = 'tasks.not_found';
  end if;

  if not private.can_reopen_task(v_task_id) then
    raise exception using errcode = 'P0001', message =
      case when private.is_task_approver(v_task_id)
        then 'tasks.stale' else 'tasks.not_approver' end;
  end if;

  update public.tasks t
  set "column" = 'doing',
      done_at = null,
      revision_note = null,
      revision_note_by = null,
      revision_note_at = null,
      updated_at = now()
  where t.id = v_task_id;

  perform private.log_activity(v_op, 'task', v_task_id, v_actor, 'reopened');
end;
$$;

-- The approver deletes a task in any column, passing the `updated_at` the
-- confirmation was rendered from (AD-21). Sets `deleted_at` and
-- `updated_at`, logs `deleted`, and touches nothing else. Raises
-- `auth.not_active`, `tasks.not_found` (no such task, or already deleted),
-- `tasks.not_approver` or `tasks.stale` (the task changed since, or no
-- version was given). It locks only the task and never reads its slots.
create function public.delete_task(
  task_id uuid,
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
  v_task_id uuid;
  v_updated_at timestamptz;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  select t.id, t.updated_at into v_task_id, v_updated_at
  from public.tasks t
  where t.id = delete_task.task_id and t.deleted_at is null
  for update;

  if v_task_id is null then
    raise exception using errcode = 'P0001', message = 'tasks.not_found';
  end if;

  if not private.is_task_approver(v_task_id) then
    raise exception using errcode = 'P0001', message = 'tasks.not_approver';
  end if;

  if v_updated_at is distinct from delete_task.expected_updated_at then
    raise exception using errcode = 'P0001', message = 'tasks.stale';
  end if;

  update public.tasks t
  set deleted_at = now(),
      updated_at = now()
  where t.id = v_task_id;

  perform private.log_activity(v_op, 'task', v_task_id, v_actor, 'deleted');
end;
$$;

grant execute on function
  public.delete_task(uuid, timestamptz)
to authenticated;

-- A new column changes the return type, so the function is replaced.
drop function public.task_capabilities(uuid[]);

-- What the caller may do on each task: the columns it may move to (in enum
-- order), the slots it may answer and hand back (in creation order), whether
-- it may review (Mark done, Send back) or reopen the task, and whether it may
-- manage it (Delete; Story 3.7 adds Edit). The only source of the actions a
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
  can_manage boolean
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
    ),
    private.can_review_task(t.id),
    private.can_reopen_task(t.id),
    -- Every approver is an admin: the InitPlan runs once per call, so a
    -- staff caller pays nothing per task.
    case
      when (select private.is_admin()) then private.is_task_approver(t.id)
      else false
    end
  from public.tasks t
  where t.id = any (ids)
$$;

grant execute on function public.task_capabilities(uuid[]) to authenticated;
