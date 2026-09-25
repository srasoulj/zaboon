-- Base: roles, schemas and default privileges (ADR 0009).
--
-- Supabase grants ALL on new public tables/functions/sequences to anon and authenticated by
-- default and relies on RLS. Zaboon never lets the browser reach PostgREST: every read and write
-- goes through route handlers connected as `app_server`. So we remove the API roles' default
-- privileges here, and every table also gets RLS enabled with deny-all for anon/authenticated.

-- 1. Stop granting future objects to the API roles.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- 2. The server role used by Next.js route handlers (password set out of band; never in git).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_server') THEN
    CREATE ROLE app_server LOGIN NOINHERIT;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO app_server;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_server;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_server;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO app_server;

-- 3. Server-only SQL helpers (pg_cron housekeeping). Nobody but the owner may execute them.
CREATE SCHEMA IF NOT EXISTS internal;
REVOKE ALL ON SCHEMA internal FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA internal REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 4. RLS helper functions (SECURITY DEFINER, search_path = ''), callable by app_server only.
CREATE SCHEMA IF NOT EXISTS rls;
REVOKE ALL ON SCHEMA rls FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA rls TO app_server;
ALTER DEFAULT PRIVILEGES IN SCHEMA rls REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA rls GRANT EXECUTE ON FUNCTIONS TO app_server;
