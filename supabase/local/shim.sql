-- LOCAL-ONLY Supabase shim. Never applied to a real Supabase project, where all of this already exists.
--
-- Mirrors the parts of a Supabase database that our migrations and tests depend on:
--   * roles: postgres (NOT superuser, migration owner), anon, authenticated, service_role,
--     authenticator, supabase_auth_admin
--   * schemas: auth (owned by supabase_auth_admin), extensions
--   * auth.users / auth.identities (subset of columns) and auth.uid()/auth.role()/auth.jwt()
--   * Supabase's default privileges on schema public (ALL to anon/authenticated/service_role),
--     which our migrations must explicitly revoke.
-- Runs as the cluster superuser `supabase_admin`. Idempotent.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE ROLE postgres LOGIN NOSUPERUSER CREATEROLE CREATEDB REPLICATION BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin LOGIN NOINHERIT CREATEROLE;
  END IF;
END
$$;

GRANT anon, authenticated, service_role TO authenticator;
-- In PG16 a CREATEROLE role needs ADMIN OPTION to manage roles it did not create.
GRANT anon, authenticated, service_role TO postgres WITH ADMIN OPTION;

-- Database-level privileges the migration role needs (Supabase grants these to postgres).
DO $$
BEGIN
  EXECUTE format('GRANT ALL ON DATABASE %I TO postgres', current_database());
  EXECUTE format('ALTER DATABASE %I OWNER TO postgres', current_database());
END
$$;
ALTER SCHEMA public OWNER TO postgres;

CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- pg_cron lives in its own schema, as on Supabase. Only the cron.database_name database can host it.
DO $$
BEGIN
  IF current_database() = current_setting('cron.database_name', true) THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    GRANT USAGE ON SCHEMA cron TO postgres;
    GRANT ALL ON ALL TABLES IN SCHEMA cron TO postgres;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- auth schema (subset of Supabase Auth's tables and helper functions)
-- ---------------------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
GRANT USAGE ON SCHEMA auth TO postgres, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aud                 text NOT NULL DEFAULT 'authenticated',
  role                text NOT NULL DEFAULT 'authenticated',
  email               text UNIQUE,
  is_anonymous        boolean NOT NULL DEFAULT false,
  raw_app_meta_data   jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_user_meta_data  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at     timestamptz,
  deleted_at          timestamptz
);
ALTER TABLE auth.users OWNER TO supabase_auth_admin;

CREATE TABLE IF NOT EXISTS auth.identities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  provider       text NOT NULL,
  provider_id    text NOT NULL,
  identity_data  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_id)
);
ALTER TABLE auth.identities OWNER TO supabase_auth_admin;

-- Supabase lets the postgres role reference auth.users (FKs, triggers).
GRANT SELECT, REFERENCES, TRIGGER ON auth.users TO postgres;
GRANT SELECT ON auth.identities TO postgres;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.jwt() OWNER TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO postgres, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Supabase's default privileges on schema public: everything is granted to the API roles and
-- protection relies on RLS. Our migrations revoke these explicitly (see ADR 0009).
-- ---------------------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- Supabase CLI migration tracking table (same shape as `supabase db push` uses).
CREATE SCHEMA IF NOT EXISTS supabase_migrations AUTHORIZATION postgres;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version     text PRIMARY KEY,
  statements  text[],
  name        text
);
ALTER TABLE supabase_migrations.schema_migrations OWNER TO postgres;
