-- tasks_approver_review: only the task's approver closes the loop: Mark
-- done, Send back with a note, Reopen (Story 3.1, AD-1, AD-4, AD-16).
--
-- - The prototype edge is gone: `private.can_move_task` refuses Done as
--   either end of a move, so `move_task` never touches Done and
--   `allowed_moves` never contains or leaves it.
-- - `private.can_review_task` (For Review, and the caller is the approver)
--   and `private.can_reopen_task` (Done, and the caller is the approver) are
--   the only definition of the review edges. Each tests the column first, in
--   a CASE, so `private.is_task_approver` (unchanged, still the only approver
--   definition) runs only on For Review or Done rows. `mark_done`,
--   `send_back_task` and `reopen_task` check them after locking the task;
--   `task_capabilities` offers `can_review` and `can_reopen` from them.
-- - A refused review command raises `tasks.not_approver` when the caller
--   isn't the task's approver, and `tasks.stale` when they are but the task
--   is no longer in the column the edge needs. The helper is the gate; the
--   second check only chooses the message.
-- - The revision note: `send_back_task` writes it (trimmed, 1-5,000
--   characters) with its author and time. Every other column change
--   (`move_task`, `mark_done`, `reopen_task`) clears all three. Activity rows
--   (`marked_done`, `sent_back`, `reopened`) never hold it.
-- - `done_at` is set by `mark_done` and cleared by `reopen_task`. Done tasks
--   already stored get their latest `moved_to_done` activity time, else
--   `updated_at`, before the CHECK that ties it to the column is added.
-- - A Done task's awaiting slots are no longer respondable
--   (`private.can_respond_to_slot` joins the task), and `respond_to_slot`
--   now locks the task after the slot, as `hand_back_slot` does, so a Mark
--   done can't commit between its check and its write.
--
-- Lock order: a slot command locks its slot, then the task
-- (`hand_back_slot`, `respond_to_slot`). A task command locks only the task
-- (`move_task`, `mark_done`, `send_back_task`, `reopen_task`). No command
-- locks a slot after its task, so two commands can't wait on each other.

alter table public.tasks
  add column revision_note text,
  add column revision_note_by uuid references public.members (id),
  add column revision_note_at timestamptz,
  add column done_at timestamptz,
  -- Trimmed of any whitespace, tabs and newlines too, 1-5,000 characters
  -- (mirrored by taskSendBackSchema).
  add constraint tasks_revision_note_format check (
    revision_note is null
    or (
      char_length(revision_note) between 1 and 5000
      and revision_note = regexp_replace(
        revision_note, '^[[:space:]]+|[[:space:]]+$', '', 'g'
      )
    )
  ),
  add constraint tasks_revision_note_complete check (
    num_nonnulls(revision_note, revision_note_by, revision_note_at) in (0, 3)
  );

update public.tasks t
set done_at = coalesce(
  (
    select max(a.created_at)
    from public.activity a
    where a.entity_type = 'task'
      and a.entity_id = t.id
      and a.action = 'moved_to_done'
  ),
  t.updated_at
)
where t."column" = 'done';

alter table public.tasks
  add constraint tasks_done_at_matches_column check (
    ("column" = 'done') = (done_at is not null)
  );

-- The slot edge, now only on a task that isn't Done. Otherwise unchanged.
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
      and private.is_active_member()
  ), false)
$$;

-- The move edges: an assignee whose slot on the task is `on_it` moves it
-- among `to_do`, `doing` and `for_review`, either way. Neither end may be
-- `done` (only the review commands move a task into or out of Done), and a
-- same-column move is refused. False for a missing task and for anyone not
-- active.
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
      and private.is_active_member()
  ), false)
$$;

-- The review edges. False for a missing task, a task in another column, and
-- anyone who isn't the task's approver (is_task_approver implies active).
create function private.can_review_task(p_task_id uuid)
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
  ), false)
$$;

create function private.can_reopen_task(p_task_id uuid)
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
  ), false)
$$;

-- Called from task_capabilities, which runs with the caller's rights.
grant execute on function
  private.can_review_task(uuid),
  private.can_reopen_task(uuid)
to authenticated;

-- Unchanged but for the task lock after the slot lock.
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
  -- between the check below and the write.
  perform 1
  from public.tasks t
  join public.task_assignments a on a.task_id = t.id
  where a.id = v_slot_id
  for update of t;

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

-- Unchanged but for clearing the revision note: every successful move
-- clears it.
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

-- The approver marks a For Review task Done. Sets `done_at`, clears the
-- revision note, logs `marked_done`. Raises `auth.not_active`,
-- `tasks.not_found`, `tasks.not_approver` or `tasks.stale`.
create function public.mark_done(task_id uuid)
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
  where t.id = mark_done.task_id
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

-- The approver sends a For Review task back to Doing with a note, stored
-- trimmed with its author and time. Logs `sent_back`, never the note.
-- Raises `auth.not_active`, `tasks.not_found`, `tasks.not_approver`,
-- `tasks.stale`, or, once those pass, `tasks.invalid_note` (blank, or over
-- 5,000 characters once trimmed: a backstop taskSendBackSchema keeps the UI
-- from reaching).
create function public.send_back_task(task_id uuid, note text)
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
  where t.id = send_back_task.task_id
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

-- The approver reopens a Done task into Doing. Clears `done_at` and the
-- revision note, logs `reopened`. Raises `auth.not_active`,
-- `tasks.not_found`, `tasks.not_approver` or `tasks.stale`.
create function public.reopen_task(task_id uuid)
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
  where t.id = reopen_task.task_id
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

grant execute on function
  public.mark_done(uuid),
  public.send_back_task(uuid, text),
  public.reopen_task(uuid)
to authenticated;

-- Two new columns change the return type, so the function is replaced.
drop function public.task_capabilities(uuid[]);

-- What the caller may do on each task: the columns it may move to (in enum
-- order), the slots it may answer and hand back (in creation order), and
-- whether it may review (Mark done, Send back) or reopen the task. The only
-- source of the actions a page offers. Runs with the caller's rights, so it
-- returns rows only for tasks the caller can read.
create function public.task_capabilities(ids uuid[])
returns table (
  task_id uuid,
  allowed_moves public.task_column[],
  respondable_slot_ids uuid[],
  hand_back_slot_ids uuid[],
  can_review boolean,
  can_reopen boolean
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
    private.can_reopen_task(t.id)
  from public.tasks t
  where t.id = any (ids)
$$;

grant execute on function public.task_capabilities(uuid[]) to authenticated;
