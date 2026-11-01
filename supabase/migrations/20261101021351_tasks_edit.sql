-- tasks_edit: the approver edits a task: its title, description, due date,
-- reference link and who holds which slot (Story 3.7, AD-1, AD-4, AD-16,
-- AD-21).
--
-- - `update_task(task_id, title, description, due_at, reference_url, slots)`
--   checks, in order: active (`auth.not_active`), the locks (every slot of
--   the task, then the live task, else `tasks.not_found`), the approver
--   (`tasks.not_approver`), no slot added since the slot lock
--   (`tasks.stale`), then the slot list: not an array or empty
--   (`tasks.no_slots`); an id that isn't one of this task's slots, an id
--   listed twice, or an id whose role differs from the stored one
--   (`tasks.stale`: a slot's role is fixed, so changing it is a remove and
--   an add); on a Done task, any slot removed, reassigned or added
--   (`tasks.not_allowed`: a Done task's slots offer no answers, so its edits
--   are text-only); a new row's member, or a changed member, who isn't
--   active (`tasks.invalid_slot_member`; an unchanged slot keeps its member
--   even if they're inactive now); the same (role, member) twice
--   (`tasks.duplicate_slot`, an explicit check rather than the unique
--   constraint).
-- - Writes: the text fields, the due date and `updated_at` are last-write-
--   wins free fields (AD-21), with no version argument. The owner, the
--   column, `done_at` and the revision note are never touched. The slots are
--   diffed by id: an existing slot left out is deleted (its reason row
--   cascades); the same id with a new member goes through
--   `private.reassign_slot_member`; the same id and member is untouched and
--   keeps its state; a row without an id is inserted `awaiting_response`.
--   It returns true when any slot got a new member (reassigned or added), so
--   the page can offer Copy for Messenger. A save that changes nothing (every
--   field `is not distinct from` the stored one, no slot removed, reassigned
--   or added) writes nothing, logs nothing and returns false; a change to
--   the slots alone still bumps `updated_at` and logs `updated`.
-- - Activity shares one `op_id`: `('task', id, 'updated')`, plus one row per
--   affected slot (`slot_reassigned`, `slot_added`, `slot_removed`), never
--   reason text. A removed slot's rows become unreadable in the app:
--   `activity_select_task` needs the slot to exist (AD-16).
-- - `private.reassign_slot_member` is the one reassign branch, which Story
--   3.3's `reassign_slot` reuses. It sets the member, `awaiting_response` and
--   `updated_at`, deletes the slot's reason row (a new assignee never reads
--   the old one's reason), and logs `slot_reassigned`; the same member
--   simply resets the slot, and no such slot raises `tasks.not_found` with
--   nothing logged. Like `private.log_activity` it is a plain helper: not
--   `security definer`, no grant, run only inside a command that has already
--   locked the slot and the task and checked the approver and the member.
-- - `task_assignments_task_id_member_id_role_key` is re-created `deferrable
--   initially immediate`. Only `update_task` defers it, so two same-role
--   slots can trade members, and it sets it back to immediate before it
--   returns, which checks what it wrote there and then. Every other write,
--   `create_task` included, still raises 23505 at once. Postgres refuses a
--   deferrable constraint as an ON CONFLICT arbiter, so no INSERT ... ON
--   CONFLICT may name these columns or this constraint.
--
-- Lock order, as tasks_approver_review set it and tasks_delete kept it: a
-- slot command locks its slot, then the task (`respond_to_slot`,
-- `hand_back_slot`). `update_task` writes slots, so it locks every slot of
-- the task, in id order, before the task, and keeps the ids it locked. A
-- task command locks only the task (`move_task`, `mark_done`,
-- `send_back_task`, `reopen_task`, `delete_task`). No command locks a slot
-- after its task, so two commands can't wait on each other. Only another
-- `update_task` adds a slot, and it holds the task while it does, so once
-- this one has the task no slot can appear; one that appeared between the
-- two locks (added while this one waited for the task) was never locked, so
-- `update_task` raises `tasks.stale` rather than lock or write it after the
-- task. A slot the form still holds but that is gone raises `tasks.stale`
-- too.

alter table public.task_assignments
  drop constraint task_assignments_task_id_member_id_role_key,
  add constraint task_assignments_task_id_member_id_role_key
    unique (task_id, member_id, role) deferrable initially immediate;

-- The one reassign branch: the slot gets `p_member_id`, starts over as
-- `awaiting_response`, loses its reason row, and logs `slot_reassigned`
-- under the caller's `p_op`; no such slot raises `tasks.not_found` before
-- anything is logged. The caller has locked the slot and its task and
-- checked the approver and the member.
create function private.reassign_slot_member(
  p_slot_id uuid,
  p_member_id uuid,
  p_actor uuid,
  p_op uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.task_assignments a
  set member_id = p_member_id,
      state = 'awaiting_response',
      updated_at = now()
  where a.id = p_slot_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'tasks.not_found';
  end if;

  delete from public.assignment_reasons r
  where r.assignment_id = p_slot_id;

  perform private.log_activity(
    p_op, 'task_assignment', p_slot_id, p_actor, 'slot_reassigned'
  );
end;
$$;

-- The approver saves the task form in edit mode. `slots` is
-- `[{"id": "<uuid>"?, "role": "<role>", "member_id": "<uuid>"}, ...]`: a row
-- with an id is that existing slot, one without is a new slot. Raises
-- `auth.not_active`, `tasks.not_found` (no such task, or deleted),
-- `tasks.not_approver`, `tasks.stale`, `tasks.no_slots`,
-- `tasks.not_allowed`, `tasks.invalid_slot_member` or
-- `tasks.duplicate_slot` (see the header). Returns true when any slot got a
-- new member.
create function public.update_task(
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
  -- respond_to_slot or hand_back_slot, nor with another update_task. The ids
  -- locked here are the only slots this command may write.
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
  -- it), an id listed twice, or an id whose role isn't the stored one.
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
