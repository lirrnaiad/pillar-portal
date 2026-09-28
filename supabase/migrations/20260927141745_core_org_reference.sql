-- core_org_reference: The Pillar's content sections, desks and positions
-- (AD-5, spine › Org reference data).
--
-- These are reference data, keyed by text slugs (`news`, `layout`,
-- `staff_writer`) rather than uuids, so an id is the same in every
-- environment and code can name one. The rows come from the next migration,
-- core_org_reference_data, which is idempotent. No command writes these
-- tables.
--
-- RLS is on with no policy yet, so nobody reads a row until
-- core_org_reference_read adds the active-member policies. That migration
-- runs after members_members, because the policies call
-- `private.is_active_member()`, which reads `members`.

-- What a desk produces. Task slots and applicant positions reuse it, so the
-- display labels live in one TypeScript map
-- (src/features/members/production-roles.ts).
create type public.production_role as enum (
  'writer',
  'layout_artist',
  'cartoonist',
  'photojournalist',
  'broadcast_journalist',
  'videojournalist'
);

-- Content sections own articles. Opinion and Editorial have no Section
-- Editor, so only top editors approve their tasks.
create table public.sections (
  id text primary key constraint sections_id_slug check (id ~ '^[a-z][a-z0-9_]*$'),
  name text not null unique constraint sections_name_present check (btrim(name) <> ''),
  sort_order integer not null
);

-- Desks group people. Each desk does one production role.
create table public.desks (
  id text primary key constraint desks_id_slug check (id ~ '^[a-z][a-z0-9_]*$'),
  name text not null unique constraint desks_name_present check (btrim(name) <> ''),
  production_role public.production_role not null unique,
  sort_order integer not null
);

-- The 22 positions. `desk_id` is the desk a member holding this position as
-- their primary belongs to (null for top editors and management). A position
-- heads at most one desk or one content section. Top editors are always on
-- the Editorial Board.
create table public.positions (
  id text primary key constraint positions_id_slug check (id ~ '^[a-z][a-z0-9_]*$'),
  title text not null unique constraint positions_title_present check (btrim(title) <> ''),
  report_title text not null constraint positions_report_title_present check (btrim(report_title) <> ''),
  desk_id text references public.desks (id),
  heads_desk_id text references public.desks (id),
  heads_section_id text references public.sections (id),
  is_top_editor boolean not null default false,
  is_board boolean not null default false,
  sort_order integer not null,
  constraint positions_heads_at_most_one
    check (num_nonnulls(heads_desk_id, heads_section_id) <= 1),
  constraint positions_top_editor_is_board
    check (not is_top_editor or is_board)
);

alter table public.sections enable row level security;
alter table public.desks enable row level security;
alter table public.positions enable row level security;

-- Read-only for signed-in callers; the policies decide which rows.
grant select on public.sections, public.desks, public.positions to authenticated;
