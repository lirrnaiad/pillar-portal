-- core_security_baseline: the first migration (AD-6).
--
-- Supabase grants every new table, sequence and function in `public` to
-- `anon`, `authenticated` and `service_role` by default, and Postgres grants
-- EXECUTE on every new function to PUBLIC. Left alone, each object a later
-- migration adds would start out callable through the Data API. This
-- migration turns those defaults off, strips any existing grants, and creates
-- the unexposed `private` schema. From here on every grant is explicit, and
-- supabase/tests/00_security/catalog.test.sql fails CI on anything wider.
--
-- Migrations run as `postgres`, so only `postgres`'s default privileges can
-- be changed here. Objects created by `supabase_admin` keep that role's
-- defaults, and the catalog test catches any such object in `public` or
-- `private`.

-- New tables and sequences created by `postgres` in `public`: nothing for the
-- client roles. This leaves `service_role`'s defaults alone. On a hosted
-- project with the default Data API settings, it keeps full access to new
-- tables and sequences. Locally, `auto_expose_new_tables = false` in
-- supabase/config.toml also strips its SELECT, INSERT, UPDATE and DELETE on
-- new tables and its SELECT and USAGE on new sequences (TRUNCATE, REFERENCES,
-- TRIGGER, MAINTAIN and sequence UPDATE remain). So a migration that needs
-- `service_role` access grants it explicitly, which works the same in both
-- places.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- New functions in `public`: nothing for any API role. `service_role` is
-- revoked too, so each command is granted to exactly one role (AD-1) and
-- function-grants.txt lists only the grants a migration made on purpose.
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, service_role;

-- New functions in any schema: no EXECUTE for PUBLIC (the Postgres default).
alter default privileges for role postgres
  revoke execute on functions from public;

-- Existing objects in `public` (none yet on a fresh project, but a database
-- that has drifted is brought back to the baseline): nothing for the client
-- roles or PUBLIC, and no EXECUTE for `service_role` either, matching the
-- defaults above. Existing tables and sequences keep `service_role`'s grants.
revoke all on all tables in schema public from anon, authenticated, public;
revoke all on all sequences in schema public from anon, authenticated, public;
revoke all on all functions in schema public
  from anon, authenticated, service_role, public;

-- `anon` can't even look up names in `public`. PUBLIC's USAGE goes too, so
-- only roles granted USAGE explicitly (`authenticated`, `service_role`)
-- resolve objects there.
revoke all on schema public from public, anon;

-- pg_graphql would expose the schema through `graphql_public`, which
-- supabase/config.toml also leaves out of the API.
drop extension if exists pg_graphql;

-- `private` holds helpers and internal tables. It is not in the API's
-- exposed schemas, and only `authenticated` may resolve names in it (for
-- RLS policies that call `private` helpers).
create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
