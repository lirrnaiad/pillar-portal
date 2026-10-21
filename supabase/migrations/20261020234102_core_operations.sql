-- core_operations: job results and server errors kept inside the portal, and
-- the health check's database ping (Story 2.4, AD-6, NFR5, NFR9).
--
-- Vercel Hobby keeps logs for one hour, so a job's outcome and a server error
-- are written here instead, where an admin can still read them later.
--
-- - Neither table holds names, emails, messages, tokens or request bodies:
--   no error message, details, hint or stack, no request headers, cookies,
--   body, path or query. `entity_id` is only a row id (for `member` rows, a
--   member's id, which an admin can join back to a person; a later erasure
--   story covers it). The CHECKs mirror the server's sanitizer
--   (src/lib/record-error-event.ts), so even a direct caller of
--   record_error_event can't store free text in `code` or `digest`.
-- - Admins read both tables (RLS). Nobody writes them directly: the three
--   commands below are `security definer`, owned by `postgres`, and granted
--   to `service_role` only, which the server reaches through the secret-key
--   client (src/lib/supabase/admin.ts). `service_role` itself holds nothing
--   on either table: hosted projects grant it full access to every new
--   `public` table by default (locally `auto_expose_new_tables = false`
--   hides that), and it bypasses RLS, so without the revoke below the
--   secret key could read or write the rows directly. The commands still
--   write, as `postgres`. System steps log here, never to `activity`.
-- - `health_check()` is the trivial read `/api/health` makes: it proves the
--   database answers and returns nothing sensitive.
-- - Epic 4's daily job purges `error_events` older than 30 days.

create type public.job_status as enum ('ok', 'failed', 'skipped');

-- One row per run of a job (`backup`, `bootstrap`, Epic 4's `daily`). A run
-- is open while `finished_at` is null; `status` is set exactly when it
-- finishes. `step` is for Epic 4's daily steps. `detail` is a small
-- structured note (an artifact size, a reason), never data.
create table public.job_runs (
  id bigint generated always as identity primary key,
  job text not null
    constraint job_runs_job_format check (job ~ '^[a-z][a-z0-9_]{0,39}$'),
  step text
    constraint job_runs_step_format check (step ~ '^[a-z][a-z0-9_]{0,39}$'),
  status public.job_status,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  detail jsonb
    constraint job_runs_detail_size check (octet_length(detail::text) <= 2000),
  constraint job_runs_status_when_finished
    check ((status is null) = (finished_at is null)),
  constraint job_runs_finished_after_started
    check (finished_at >= started_at)
);

create index job_runs_job_started_at_idx
  on public.job_runs (job, started_at desc);

-- One row per unexpected server error.
-- - `code`: a SQLSTATE, a `PGRST...` code, an Auth code (the error's own, or
--   its cause's) or an error's class name.
-- - `route`: where, never with a query string. Errors Next.js captures are
--   `<routeType> <routePath>`: `render`, `route`, `action` or `proxy`, then
--   the route's file pattern (`action /(admin)/admin/members`). The action
--   mappers write `action <actionName>` (`action moveTaskAction`), and the
--   caught sites name themselves (`render admin-banners #<n>`,
--   `route /api/tasks/[id]/ics`, `route /auth/callback`,
--   `action signInWithGoogleAction`).
-- - `entity_type`/`entity_id`: the row an action was about.
-- - `digest`: the id Next.js shows on its error page (`<hash>@E<n>` for
--   Next's own errors).
create table public.error_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  code text not null
    constraint error_events_code_format
      check (code ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  route text not null
    constraint error_events_route_format
      check (char_length(route) between 1 and 200 and strpos(route, '?') = 0),
  entity_type text
    constraint error_events_entity_type_format
      check (entity_type ~ '^[a-z][a-z0-9_]{0,39}$'),
  entity_id uuid,
  digest text
    constraint error_events_digest_format
      check (digest ~ '^[A-Za-z0-9_@-]{1,64}$'),
  constraint error_events_entity_id_has_type
    check (entity_id is null or entity_type is not null)
);

create index error_events_occurred_at_idx
  on public.error_events (occurred_at desc);

alter table public.job_runs enable row level security;
alter table public.error_events enable row level security;

create policy job_runs_select_admin
  on public.job_runs
  for select
  to authenticated
  using ((select private.is_admin()));

create policy error_events_select_admin
  on public.error_events
  for select
  to authenticated
  using ((select private.is_admin()));

grant select on public.job_runs, public.error_events to authenticated;

-- The secret key reaches the rows only through the commands below.
revoke all on table public.job_runs, public.error_events from service_role;

-- Starts a run of `job` and returns its id, or records a `skipped` row and
-- returns null when a run of the same job is already in progress. Raises
-- `core.invalid_job` for a name that isn't a lowercase slug.
--
-- The transaction-level advisory lock serializes this check-and-insert per
-- job. It is not a session lock: each PostgREST call is its own transaction
-- on a pooled connection, so a session lock would stay on whichever
-- connection took it, and end_job_run, on another connection, couldn't
-- release it. The open row (`finished_at is null`) is what marks a run in
-- progress. A run whose process died before end_job_run stays open until
-- the next begin_job_run of the same job: if it is over an hour old by then,
-- it is closed `failed` (`{"reason":"abandoned"}`) and a new run starts.
create function public.begin_job_run(job text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not coalesce(begin_job_run.job ~ '^[a-z][a-z0-9_]{0,39}$', false) then
    raise exception using errcode = 'P0001', message = 'core.invalid_job';
  end if;

  if not pg_try_advisory_xact_lock(
    hashtextextended('job_runs:' || begin_job_run.job, 0)
  ) then
    insert into public.job_runs (job, status, finished_at)
    values (begin_job_run.job, 'skipped', now());
    return null;
  end if;

  update public.job_runs r
  set status = 'failed',
      finished_at = now(),
      detail = '{"reason":"abandoned"}'::jsonb
  where r.job = begin_job_run.job
    and r.finished_at is null
    and r.started_at < now() - interval '1 hour';

  if exists (
    select 1
    from public.job_runs r
    where r.job = begin_job_run.job
      and r.finished_at is null
  ) then
    insert into public.job_runs (job, status, finished_at)
    values (begin_job_run.job, 'skipped', now());
    return null;
  end if;

  insert into public.job_runs (job)
  values (begin_job_run.job)
  returning job_runs.id into v_id;

  return v_id;
end;
$$;

-- Finishes an open run with its status and an optional detail (no personal
-- data; at most 2000 bytes, or the CHECK refuses it). Raises
-- `core.job_run_not_open` for a run that is missing or already finished.
create function public.end_job_run(
  id bigint,
  status public.job_status,
  detail jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run bigint;
begin
  select r.id into v_run
  from public.job_runs r
  where r.id = end_job_run.id
    and r.finished_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'core.job_run_not_open';
  end if;

  update public.job_runs r
  set status = end_job_run.status,
      finished_at = now(),
      detail = end_job_run.detail
  where r.id = v_run;
end;
$$;

-- Records one server error. The server builds the arguments from an
-- allowlist (src/lib/record-error-event.ts); the table's CHECKs refuse
-- anything else.
create function public.record_error_event(
  code text,
  route text,
  entity_type text default null,
  entity_id uuid default null,
  digest text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.error_events (code, route, entity_type, entity_id, digest)
  values (
    record_error_event.code,
    record_error_event.route,
    record_error_event.entity_type,
    record_error_event.entity_id,
    record_error_event.digest
  );
end;
$$;

-- `/api/health`'s ping: the database answered. Reads and returns nothing
-- else.
create function public.health_check()
returns boolean
language sql
stable
set search_path = ''
as $$
  select true
$$;

revoke all on function
  public.begin_job_run(text),
  public.end_job_run(bigint, public.job_status, jsonb),
  public.record_error_event(text, text, text, uuid, text),
  public.health_check()
from public, anon, authenticated;

grant execute on function
  public.begin_job_run(text),
  public.end_job_run(bigint, public.job_status, jsonb),
  public.record_error_event(text, text, text, uuid, text),
  public.health_check()
to service_role;
