-- Every table has RLS on, is reachable by app_server only through explicit policies, and has no
-- policy that applies to the browser's roles (docs/ARCHITECTURE.md §9, ADR 0009).
BEGIN;
SET LOCAL search_path = extensions, public;
SELECT plan(7);

SELECT cmp_ok(
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')),
  '>=', 32, 'public schema has all MVP + P2 tables');

SELECT is_empty(
  $$ SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity $$,
  'every public table has row level security enabled');

SELECT is_empty(
  $$ SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname
                       AND 'app_server' = ANY (p.roles)) $$,
  'every public table has at least one app_server policy');

SELECT is_empty(
  $$ SELECT tablename, policyname, roles FROM pg_policies
     WHERE schemaname = 'public' AND roles && ARRAY['public', 'anon', 'authenticated', 'service_role']::name[] $$,
  'no policy applies to public, anon, authenticated or service_role');

SELECT is_empty(
  $$ SELECT tablename, policyname FROM pg_policies
     WHERE schemaname = 'public' AND roles <> ARRAY['app_server']::name[] $$,
  'every policy targets app_server only');

-- User-owned tables must scope rows by rls.can_access(user_id) (or, for leaderboards, cohort membership).
SELECT is_empty(
  $$ SELECT c.table_name FROM information_schema.columns c
     JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'user_id'
       AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.table_name
                       AND p.policyname = 'app_server_own_rows'
                       AND p.qual = 'rls.can_access(user_id)' AND p.with_check = 'rls.can_access(user_id)') $$,
  'every user-owned table has the app_server_own_rows policy');

SELECT is_empty(
  $$ SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relforcerowsecurity $$,
  'no table forces RLS on its owner (housekeeping and FK actions run as the owner)');

SELECT * FROM finish();
ROLLBACK;
