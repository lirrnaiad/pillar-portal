-- Catalog test (AD-6): nothing in the `public` or `private` schemas is
-- reachable beyond what a migration granted on purpose.
--
-- Each check is a pg_temp function that returns the offending objects by name,
-- and each assertion expects it to return nothing, so a failure prints what
-- broke the rule. The self-test at the end creates violations and asserts the
-- checks report them (and that allowed objects are not reported); the
-- rollback discards everything it created.
--
-- Two lists live outside the checks, and each later story updates them in the
-- same change as the migration that adds the object:
--   - function-grants.txt: every EXECUTE grant on a function (check 6)
--   - expected_realtime_tables below: the Realtime publication (check 8)
--
-- `supabase test db` runs this file with pg_prove from supabase/tests, so the
-- grants file path is relative to that directory.

begin;

-- `supabase test db --linked` connects as the CLI's login role
-- (`cli_login_postgres`), which can't use the `extensions` schema where pgTAP
-- lives and has the default "$user", public search_path. Run as `postgres`,
-- as locally, with `extensions` on the path, rather than rely on how the
-- session was opened.
set local role postgres;
set local search_path = "$user", public, extensions;

-- The tables in the `supabase_realtime` publication, as `schema.table`
-- (AD-14). Empty until the tasks slice publishes its tables.
\set expected_realtime_tables '{}'

-- If `cat` fails, psql prints the error and leaves this empty, which would
-- make check 6 expect no grants at all; the first assertion catches that.
\set grants_txt `cat 00_security/function-grants.txt`

select plan(30);

-- The file's entries: comments and blank lines dropped, each run of
-- whitespace collapsed to one space.
create temp table expected_function_grants as
select regexp_replace(btrim(line, E' \t\r'), '\s+', ' ', 'g') as line
from regexp_split_to_table(:'grants_txt', E'\n') as line
where btrim(line, E' \t\r') <> ''
  and btrim(line, E' \t\r') not like '#%';

-- Relations in scope: tables, views, materialized views, foreign tables and
-- sequences in `public` and `private`.
create function pg_temp.relations()
returns table (oid oid, nsp name, relkind "char", label text)
language sql stable as $$
  select c.oid,
         n.nspname,
         c.relkind,
         format(
           '%s %I.%I',
           case c.relkind
             when 'r' then 'table'
             when 'p' then 'table'
             when 'v' then 'view'
             when 'm' then 'materialized view'
             when 'f' then 'foreign table'
             when 'S' then 'sequence'
           end,
           n.nspname,
           c.relname
         )
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private')
    and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
$$;

-- Functions (and procedures and aggregates) in `public` and `private`, with a
-- signature such as `public.f(uuid, integer)`.
create function pg_temp.functions()
returns table (
  oid oid,
  signature text,
  owner oid,
  acl aclitem[],
  is_definer boolean,
  config text[]
)
language sql stable as $$
  select p.oid,
         format(
           '%s.%s(%s)',
           p.pronamespace::regnamespace,
           p.proname,
           oidvectortypes(p.proargtypes)
         ),
         p.proowner,
         p.proacl,
         p.prosecdef,
         p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
$$;

-- Check 1: everything `grantee` holds any privilege on. The has_*_privilege
-- functions count grants to PUBLIC and inherited roles too.
create function pg_temp.privileges_held(grantee name)
returns setof text
language sql stable as $$
  select format('schema %I', n.nspname)
  from pg_namespace n
  where n.nspname in ('public', 'private')
    and has_schema_privilege(grantee, n.oid, 'USAGE, CREATE')
  union all
  select r.label
  from pg_temp.relations() r
  where case
    when r.relkind = 'S' then
      has_sequence_privilege(grantee, r.oid, 'USAGE, SELECT, UPDATE')
    else
      has_table_privilege(
        grantee,
        r.oid,
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'
      )
      or has_any_column_privilege(
        grantee,
        r.oid,
        'SELECT, INSERT, UPDATE, REFERENCES'
      )
  end
  union all
  select 'function ' || f.signature
  from pg_temp.functions() f
  where has_function_privilege(grantee, f.oid, 'EXECUTE')
$$;

-- Check 2: `authenticated` may hold USAGE on the two schemas and SELECT
-- (table- or column-level) on `public` relations, and nothing else: no CREATE
-- on either schema, nothing on `private` relations and nothing on sequences.
create function pg_temp.authenticated_excess()
returns setof text
language sql stable as $$
  select format('schema %I', n.nspname)
  from pg_namespace n
  where n.nspname in ('public', 'private')
    and has_schema_privilege('authenticated', n.oid, 'CREATE')
  union all
  select r.label
  from pg_temp.relations() r
  where case
    when r.relkind = 'S' then
      has_sequence_privilege('authenticated', r.oid, 'USAGE, SELECT, UPDATE')
    when r.nsp = 'private' then
      has_table_privilege(
        'authenticated',
        r.oid,
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'
      )
      or has_any_column_privilege(
        'authenticated',
        r.oid,
        'SELECT, INSERT, UPDATE, REFERENCES'
      )
    else
      has_table_privilege(
        'authenticated',
        r.oid,
        'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'
      )
      or has_any_column_privilege(
        'authenticated',
        r.oid,
        'INSERT, UPDATE, REFERENCES'
      )
  end
$$;

-- Check 3: `public` relations that row level security can't cover: tables
-- without it enabled, and any materialized view or foreign table, since
-- neither can have RLS (AD-19: no materialized views in exposed schemas).
create function pg_temp.public_relations_without_rls()
returns setof text
language sql stable as $$
  select r.label
  from pg_temp.relations() r
  join pg_class c on c.oid = r.oid
  where r.nsp = 'public'
    and (
      (r.relkind in ('r', 'p') and not c.relrowsecurity)
      or r.relkind in ('m', 'f')
    )
$$;

-- Check 4: `security definer` functions without `set search_path = ''`.
create function pg_temp.definers_without_empty_search_path()
returns setof text
language sql stable as $$
  select f.signature
  from pg_temp.functions() f
  where f.is_definer
    and not coalesce('search_path=""' = any(f.config), false)
$$;

-- Check 5: views that run with their owner's rights. `member_directory` is
-- the one owner-rights view (AD-19).
create function pg_temp.views_not_security_invoker()
returns setof text
language sql stable as $$
  select r.label
  from pg_temp.relations() r
  join pg_class c on c.oid = r.oid
  where r.relkind = 'v'
    and r.label <> 'view public.member_directory'
    and not coalesce(
      (
        select o.option_value::boolean
        from pg_options_to_table(c.reloptions) o
        where o.option_name = 'security_invoker'
      ),
      false
    )
$$;

-- Check 6: every EXECUTE grant other than the owner's, as
-- `<grantee> <signature>`. A null ACL means the built-in default, which grants
-- EXECUTE to PUBLIC.
create function pg_temp.function_grants()
returns setof text
language sql stable as $$
  select case a.grantee
           when 0 then 'public'
           else a.grantee::regrole::text
         end || ' ' || f.signature
  from pg_temp.functions() f
  cross join lateral aclexplode(coalesce(f.acl, acldefault('f', f.owner))) a
  where a.privilege_type = 'EXECUTE'
    and a.grantee <> f.owner
$$;

-- Check 7: public Storage buckets.
create function pg_temp.public_buckets()
returns setof text
language sql stable as $$
  select format('bucket %s', b.id)
  from storage.buckets b
  where b.public
$$;

-- Check 8: differences between the `supabase_realtime` publication and the
-- expected tables.
create function pg_temp.realtime_drift(expected text[])
returns setof text
language sql stable as $$
  with published as (
    select t.schemaname || '.' || t.tablename as name
    from pg_publication_tables t
    where t.pubname = 'supabase_realtime'
  )
  select 'publication supabase_realtime is missing'
  where not exists (
    select from pg_publication p where p.pubname = 'supabase_realtime'
  )
  union all
  select 'supabase_realtime publishes all tables'
  from pg_publication p
  where p.pubname = 'supabase_realtime'
    and p.puballtables
  union all
  (
    select 'published, not expected: ' || name from published
    except
    select 'published, not expected: ' || e from unnest(expected) e
  )
  union all
  (
    select 'expected, not published: ' || e from unnest(expected) e
    except
    select 'expected, not published: ' || name from published
  )
$$;

-- The checks.

select ok(
  strpos(:'grants_txt', 'Every EXECUTE grant on a function') > 0,
  'function-grants.txt was read (its header is present)'
);

select is_empty(
  $$ select * from pg_temp.privileges_held('anon') $$,
  'check 1: anon holds nothing on public or private, or on anything in them'
);

select is_empty(
  $$ select * from pg_temp.authenticated_excess() $$,
  'check 2: authenticated holds at most USAGE on the schemas and SELECT on public relations'
);

select is_empty(
  $$ select * from pg_temp.public_relations_without_rls() $$,
  'check 3: every public table has row level security, and public holds no materialized view or foreign table'
);

select is_empty(
  $$ select * from pg_temp.definers_without_empty_search_path() $$,
  'check 4: every security definer function sets search_path = '''''
);

select is_empty(
  $$ select * from pg_temp.views_not_security_invoker() $$,
  'check 5: every view but public.member_directory is security_invoker'
);

select set_eq(
  $$ select * from pg_temp.function_grants() $$,
  $$ select line from expected_function_grants $$,
  'check 6: function EXECUTE grants match function-grants.txt'
);

select is_empty(
  $$ select * from pg_temp.public_buckets() $$,
  'check 7: no Storage bucket is public'
);

select is_empty(
  format(
    'select * from pg_temp.realtime_drift(%L::text[])',
    :'expected_realtime_tables'
  ),
  'check 8: supabase_realtime publishes exactly the expected tables'
);

select hasnt_extension(
  'pg_graphql',
  'pg_graphql is not installed (core_security_baseline drops it)'
);

-- Positive/negative controls for the tasks slice's new objects (tasks_tasks,
-- tasks_responses_and_moves): these assert against the real, migrated
-- objects rather than self-test fixtures, since they already exist by the
-- time this file runs.

select ok(
  'authenticated public.create_task(text, text, text, text, timestamp with time zone, text, jsonb)'
    in (select * from pg_temp.function_grants()),
  'positive control: create_task''s EXECUTE grant to authenticated is present'
);

select is_empty(
  $$ select * from pg_temp.authenticated_excess() p
     where p in ('table public.activity', 'table public.tasks',
                 'table public.task_assignments') $$,
  'negative control: authenticated holds only SELECT on activity, tasks and task_assignments'
);

-- tasks_responses_and_moves: the one source of offered actions is callable,
-- and the hand-back reasons are read-only to clients (the table's SELECT is
-- held, and nothing beyond it).

select ok(
  'authenticated public.task_capabilities(uuid[])'
    in (select * from pg_temp.function_grants()),
  'positive control: task_capabilities''s EXECUTE grant to authenticated is present'
);

select ok(
  has_table_privilege('authenticated', 'public.assignment_reasons', 'SELECT')
    and not exists (
      select 1 from pg_temp.authenticated_excess() p
      where p = 'table public.assignment_reasons'
    ),
  'negative control: authenticated holds only SELECT on assignment_reasons'
);

-- Self-test, part 1: objects created in `public` without grants give the API
-- roles nothing (the baseline's default privileges). The identity column
-- adds an owned sequence.

create table public.catalog_selftest_plain (
  id integer generated always as identity primary key
);
alter table public.catalog_selftest_plain enable row level security;
create sequence public.catalog_selftest_sequence;
create view public.catalog_selftest_view
  with (security_invoker = on) as select 1 as x;
create function public.catalog_selftest_function()
  returns integer language sql as 'select 1';

select is_empty(
  $$ select * from pg_temp.privileges_held('anon') p
     where p like '%catalog\_selftest%' $$,
  'self-test: anon holds nothing on a new table, sequence, view or function'
);

select is_empty(
  $$ select * from pg_temp.privileges_held('authenticated') p
     where p like '%catalog\_selftest%' $$,
  'self-test: authenticated holds nothing on a new table, sequence, view or function'
);

select is_empty(
  $$ select * from pg_temp.function_grants() g
     where g like '%catalog\_selftest%' $$,
  'self-test: a new function is granted to no role'
);

-- Self-test, part 2: violations are reported by name, one for every branch
-- of each check.

-- check 1: a function, a sequence and a schema privilege held by anon
create function public.catalog_selftest_anon()
  returns integer language sql as 'select 1';
grant execute on function public.catalog_selftest_anon() to anon;
grant select on sequence public.catalog_selftest_sequence to anon;
grant create on schema public to anon;

-- check 2: a write on a public table, a sequence, a private table and CREATE
-- on a schema held by authenticated
create table public.catalog_selftest_no_rls (id integer);
grant insert on public.catalog_selftest_no_rls to authenticated;
grant usage on sequence public.catalog_selftest_sequence to authenticated;
create table private.catalog_selftest_private (id integer);
grant select on private.catalog_selftest_private to authenticated;
grant create on schema private to authenticated;

-- check 3: a table without RLS (above) and a materialized view
create materialized view public.catalog_selftest_matview as select 1 as x;

-- check 4: a security definer function without search_path
create function public.catalog_selftest_definer()
  returns integer language sql security definer as 'select 1';

-- check 5: an owner-rights view
create view public.catalog_selftest_owner_view as select 1 as x;

-- check 7: a public bucket
insert into storage.buckets (id, name, public)
values ('catalog-selftest', 'catalog-selftest', true);

-- check 8: a table published but not expected
alter publication supabase_realtime add table public.catalog_selftest_plain;

select set_has(
  $$ select * from pg_temp.privileges_held('anon') $$,
  $$ values ('function public.catalog_selftest_anon()'),
            ('sequence public.catalog_selftest_sequence'),
            ('schema public') $$,
  'self-test: check 1 reports a function, a sequence and a schema held by anon'
);

select set_has(
  $$ select * from pg_temp.authenticated_excess() $$,
  $$ values ('table public.catalog_selftest_no_rls'),
            ('sequence public.catalog_selftest_sequence'),
            ('table private.catalog_selftest_private'),
            ('schema private') $$,
  'self-test: check 2 reports a public write, a sequence, a private table and schema CREATE'
);

select set_has(
  $$ select * from pg_temp.public_relations_without_rls() $$,
  $$ values ('table public.catalog_selftest_no_rls'),
            ('materialized view public.catalog_selftest_matview') $$,
  'self-test: check 3 reports a table without RLS and a materialized view'
);

select set_has(
  $$ select * from pg_temp.definers_without_empty_search_path() $$,
  $$ values ('public.catalog_selftest_definer()') $$,
  'self-test: check 4 reports a security definer function without search_path'
);

select set_has(
  $$ select * from pg_temp.views_not_security_invoker() $$,
  $$ values ('view public.catalog_selftest_owner_view') $$,
  'self-test: check 5 reports an owner-rights view'
);

select set_has(
  $$ select * from pg_temp.function_grants()
     except select line from expected_function_grants $$,
  $$ values ('anon public.catalog_selftest_anon()') $$,
  'self-test: check 6 reports a grant missing from function-grants.txt'
);

-- check 6, the other direction: a line in the file that nothing grants
insert into expected_function_grants
values ('authenticated public.catalog_selftest_missing(uuid)');

select set_has(
  $$ select line from expected_function_grants
     except select * from pg_temp.function_grants() $$,
  $$ values ('authenticated public.catalog_selftest_missing(uuid)') $$,
  'self-test: check 6 reports a line in function-grants.txt that nothing grants'
);

select set_has(
  $$ select * from pg_temp.public_buckets() $$,
  $$ values ('bucket catalog-selftest') $$,
  'self-test: check 7 reports a public bucket'
);

select set_has(
  $$ select * from pg_temp.realtime_drift('{public.catalog_selftest_missing}') $$,
  $$ values ('published, not expected: public.catalog_selftest_plain'),
            ('expected, not published: public.catalog_selftest_missing') $$,
  'self-test: check 8 reports a table published but not expected, and one expected but not published'
);

-- check 8, the publication itself: missing, then publishing all tables.
drop publication supabase_realtime;

select set_has(
  $$ select * from pg_temp.realtime_drift('{}') $$,
  $$ values ('publication supabase_realtime is missing') $$,
  'self-test: check 8 reports a missing publication'
);

create publication supabase_realtime for all tables;

select set_has(
  $$ select * from pg_temp.realtime_drift('{}') $$,
  $$ values ('supabase_realtime publishes all tables') $$,
  'self-test: check 8 reports a publication of all tables'
);

-- Negative controls: allowed objects are not reported.

create function public.catalog_selftest_definer_ok()
  returns integer language sql security definer set search_path = ''
  as 'select 1';
-- public.member_directory is now a real, migrated view (tasks_tasks's
-- predecessor, members_directory) that already isn't security_invoker, so
-- the exception is exercised by production data rather than a fixture here.

select set_hasnt(
  $$ select * from pg_temp.definers_without_empty_search_path() $$,
  $$ values ('public.catalog_selftest_definer_ok()') $$,
  'self-test: check 4 passes a security definer function with search_path = '''''
);

select set_hasnt(
  $$ select * from pg_temp.views_not_security_invoker() $$,
  $$ values ('view public.catalog_selftest_view'),
            ('view public.member_directory') $$,
  'self-test: check 5 passes a security_invoker view and public.member_directory'
);

select * from finish();

rollback;
