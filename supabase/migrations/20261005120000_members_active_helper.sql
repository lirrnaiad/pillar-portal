-- members_active_helper: "is this member active?" is defined once (Story 1.13).
--
-- `private.is_member_active(member_id)` is the only place that says what
-- active means: today, a `members` row whose role isn't `pending`. Story 2.1's
-- declined and deactivated states change this one function. Every helper,
-- `member_directory` and `create_task`'s slot-member check call it, and the
-- admin and approver checks go through it too, so they imply active.
--
-- Not granted to anyone: each caller is a `security definer` function owned
-- by `postgres`, or the owner-run `member_directory` view. Behavior is
-- unchanged; signatures, grants and the view's columns stay as they were.

create function private.is_member_active(p_member_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    where m.id = p_member_id
      and m.role <> 'pending'
  )
$$;

create or replace function private.current_member_id()
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select m.id
  from public.members m
  where m.id = (select auth.uid())
    and private.is_member_active(m.id)
$$;

create or replace function private.is_active_member()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select private.is_member_active((select auth.uid()))
$$;

create or replace function private.is_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    where m.id = (select auth.uid())
      and private.is_member_active(m.id)
      and m.role = 'editorial_admin'
  )
$$;

create or replace function private.is_top_editor()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    join public.member_positions mp on mp.member_id = m.id
    join public.positions p on p.id = mp.position
    where m.id = (select auth.uid())
      and private.is_member_active(m.id)
      and p.is_top_editor
  )
$$;

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
      and private.is_member_active(m.id)
      and m.role = 'editorial_admin'
      and (
        p.is_top_editor
        or p.heads_section_id = t.owning_section_id
        or p.heads_desk_id = t.owning_desk_id
      )
  )
$$;

create or replace view public.member_directory
  with (security_barrier = true) as
select
  m.id,
  m.name,
  m.avatar_url,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'position', mp.position,
        'is_primary', mp.is_primary,
        'desk_id', p.desk_id
      )
      order by mp.is_primary desc, mp.position
    ) filter (where mp.position is not null),
    '[]'::jsonb
  ) as positions
from public.members m
left join public.member_positions mp on mp.member_id = m.id
left join public.positions p on p.id = mp.position
where private.is_member_active(m.id)
group by m.id, m.name, m.avatar_url;

-- create_task is unchanged except the slot-member check.
create or replace function public.create_task(
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
    where not private.is_member_active((s.value ->> 'member_id')::uuid)
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
