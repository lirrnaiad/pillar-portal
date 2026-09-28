-- tasks_tasks: the tasks slice's schema and its one command (AD-1, AD-2,
-- AD-4, AD-19).
--
-- - A task has exactly one owner: a content section (an article) or a desk
--   (supplementary or desk work), never both and never the Writers desk
--   (`tasks_owner_xor`, `tasks_owner_not_writers`).
-- - Every slot starts `awaiting_response`. Story 1.6 adds the transition
--   helpers that move a slot to `on_it` or `needs_reassignment`.
-- - `create_task` is the only way any of these three tables gets written:
--   `security definer` owned by `postgres` with an empty search_path, granted
--   to `authenticated` only. It resolves the actor, checks they're an active
--   admin, validates the owner and slots, inserts the task and its slots, and
--   logs one `activity` row for the task it created, all in one transaction.
-- - RLS lets active members read every row; nobody writes directly. Mirrors
--   core_org_reference_read's `using ((select private.is_active_member()))`
--   shape.

create type public.task_column as enum ('to_do', 'doing', 'for_review', 'done');

create type public.slot_state as enum (
  'awaiting_response',
  'on_it',
  'needs_reassignment'
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null
    constraint tasks_title_length check (
      char_length(title) <= 200
      and btrim(title) <> ''
    ),
  description text
    constraint tasks_description_length check (
      description is null or char_length(description) <= 5000
    ),
  owning_section_id text references public.sections (id),
  owning_desk_id text references public.desks (id),
  due_at timestamptz not null,
  reference_url text
    constraint tasks_reference_url_format check (
      reference_url is null
      or (reference_url ~ '^https?://\S+$' and char_length(reference_url) <= 2048)
    ),
  -- Quoted: `column` is a reserved word in Postgres's grammar.
  "column" public.task_column not null default 'to_do',
  created_by uuid references public.members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_owner_xor
    check (num_nonnulls(owning_section_id, owning_desk_id) = 1),
  constraint tasks_owner_not_writers
    check (owning_desk_id is distinct from 'writers')
);

create index tasks_owning_section_idx on public.tasks (owning_section_id);
create index tasks_owning_desk_idx on public.tasks (owning_desk_id);
create index tasks_due_at_idx on public.tasks (due_at);

create table public.task_assignments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  member_id uuid not null references public.members (id),
  role public.production_role not null,
  state public.slot_state not null default 'awaiting_response',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, member_id, role)
);

create index task_assignments_task_idx on public.task_assignments (task_id);
create index task_assignments_member_idx on public.task_assignments (member_id);

alter table public.tasks enable row level security;
alter table public.task_assignments enable row level security;

create policy tasks_select_active
  on public.tasks
  for select
  to authenticated
  using ((select private.is_active_member()));

create policy task_assignments_select_active
  on public.task_assignments
  for select
  to authenticated
  using ((select private.is_active_member()));

-- The first `activity` SELECT policy (core_activity enabled RLS with none).
-- Scoped to this slice's own entity type, per epic-1-context.md.
create policy activity_select_task
  on public.activity
  for select
  to authenticated
  using (
    entity_type = 'task'
    and (select private.is_active_member())
  );

grant select on public.tasks, public.task_assignments to authenticated;

-- Creates a task in `to_do` with one slot per element of `slots`
-- (`[{"role": "layout_artist", "member_id": "<uuid>"}, ...]`), every slot
-- `awaiting_response`. Raises `auth.not_active` when the caller isn't an
-- active member, `tasks.not_admin` when they're active but not
-- `editorial_admin`. Two owners, no owner, or the Writers desk as owner are
-- refused by the table's own CHECK constraints. `tasks.no_slots` and
-- `tasks.invalid_slot_member` are backstops the UI never reaches (the slot
-- member picker only offers active members, and Zod requires at least one
-- slot) but that a direct call still can't get past.
create function public.create_task(
  title text,
  description text,
  owning_section_id text,
  owning_desk_id text,
  due_at timestamptz,
  reference_url text,
  slots jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_member_id();
  v_op uuid := gen_random_uuid();
  v_id uuid;
  v_slot jsonb;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  if not private.is_admin() then
    raise exception using errcode = 'P0001', message = 'tasks.not_admin';
  end if;

  if slots is null
    or jsonb_typeof(slots) <> 'array'
    or jsonb_array_length(slots) < 1
  then
    raise exception using errcode = 'P0001', message = 'tasks.no_slots';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(slots) as s
    where not exists (
      select 1
      from public.members m
      where m.id = (s.value ->> 'member_id')::uuid
        and m.role <> 'pending'
    )
  ) then
    raise exception using errcode = 'P0001', message = 'tasks.invalid_slot_member';
  end if;

  insert into public.tasks (
    title, description, owning_section_id, owning_desk_id, due_at,
    reference_url, created_by
  )
  values (
    title, description, owning_section_id, owning_desk_id, due_at,
    reference_url, v_actor
  )
  returning id into v_id;

  for v_slot in select * from jsonb_array_elements(slots)
  loop
    insert into public.task_assignments (task_id, member_id, role)
    values (
      v_id,
      (v_slot ->> 'member_id')::uuid,
      (v_slot ->> 'role')::public.production_role
    );
  end loop;

  perform private.log_activity(v_op, 'task', v_id, v_actor, 'created');

  return v_id;
end;
$$;

grant execute on function public.create_task(
  text, text, text, text, timestamptz, text, jsonb
) to authenticated;
