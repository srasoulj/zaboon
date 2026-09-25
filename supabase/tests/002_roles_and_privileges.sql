-- The browser's roles have no privileges on anything we own; internal/rls are server-only;
-- app_server is an ordinary role (docs/ARCHITECTURE.md §9).
BEGIN;
SET LOCAL search_path = extensions, public;
SELECT plan(15);

SELECT is_empty(
  $$ SELECT r.rolname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r (rolname)
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
       AND has_table_privilege(r.rolname, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') $$,
  'anon and authenticated have no privileges on any public table or view');

SELECT is_empty(
  $$ SELECT r.rolname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r (rolname)
     WHERE n.nspname = 'public' AND c.relkind = 'S'
       AND has_sequence_privilege(r.rolname, c.oid, 'USAGE, SELECT, UPDATE') $$,
  'anon and authenticated have no privileges on any public sequence');

SELECT is_empty(
  $$ SELECT r.rolname, n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r (rolname)
     WHERE n.nspname IN ('public', 'internal', 'rls')
       AND has_function_privilege(r.rolname, p.oid, 'EXECUTE') $$,
  'anon and authenticated cannot execute any function in public, internal or rls');

SELECT ok(NOT has_schema_privilege('anon', 'internal', 'USAGE'), 'anon has no USAGE on internal');
SELECT ok(NOT has_schema_privilege('authenticated', 'internal', 'USAGE'), 'authenticated has no USAGE on internal');
SELECT ok(NOT has_schema_privilege('anon', 'rls', 'USAGE'), 'anon has no USAGE on rls');
SELECT ok(NOT has_schema_privilege('authenticated', 'rls', 'USAGE'), 'authenticated has no USAGE on rls');

SELECT is_empty(
  $$ SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'internal' AND has_function_privilege('app_server', p.oid, 'EXECUTE') $$,
  'app_server cannot execute internal housekeeping functions');
SELECT ok(NOT has_schema_privilege('app_server', 'internal', 'USAGE'), 'app_server has no USAGE on internal');

SELECT is_empty(
  $$ SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'rls' AND NOT has_function_privilege('app_server', p.oid, 'EXECUTE') $$,
  'app_server can execute every rls helper');

SELECT is(
  (SELECT row(rolsuper, rolbypassrls, rolcreaterole, rolcreatedb)::text FROM pg_roles WHERE rolname = 'app_server'),
  row(false, false, false, false)::text,
  'app_server is not a superuser, has no BYPASSRLS and cannot create roles or databases');

SELECT is_empty(
  $$ SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'internal', 'rls') AND p.prosecdef
       AND NOT coalesce(p.proconfig @> ARRAY['search_path=""'], false) $$,
  'every SECURITY DEFINER function sets search_path to empty');

-- Append-only ledgers.
SELECT ok(NOT has_table_privilege('app_server', 'public.xp_ledger', 'UPDATE')
          AND NOT has_table_privilege('app_server', 'public.xp_ledger', 'DELETE'),
  'xp_ledger is append-only for app_server');
SELECT ok(NOT has_table_privilege('app_server', 'public.coin_ledger', 'UPDATE')
          AND NOT has_table_privilege('app_server', 'public.coin_ledger', 'DELETE'),
  'coin_ledger is append-only for app_server');

-- A hung request can never hold a pooled connection forever (20260925000700_app_server_timeouts).
SELECT set_eq(
  $$ SELECT unnest(s.setconfig) FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
     WHERE r.rolname = 'app_server' AND s.setdatabase = 0 $$,
  ARRAY['lock_timeout=10s', 'idle_in_transaction_session_timeout=60s', 'statement_timeout=15s'],
  'app_server sessions start with lock, idle-in-transaction and statement timeouts');

SELECT * FROM finish();
ROLLBACK;
