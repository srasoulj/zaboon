-- Core tables for the walking skeleton (profiles, sessions, XP, streaks, lives, content versions).
-- ws-db extends this with the remaining MVP + P2 tables (docs/ARCHITECTURE.md §5).
--
-- Isolation model (ADR 0009, defense in depth):
--   * anon/authenticated: no grants, no policies (deny-all).
--   * app_server: explicit policies. On user-scoped tables a row is visible only when its user_id
--     equals the transaction's `app.user_id` setting, or the transaction runs in `app.scope = system`
--     (cron/admin/merge code paths). Route handlers set these via packages/db (withUserLock, withSystem).

-- ---------------------------------------------------------------------------------------------
-- RLS helpers
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rls.app_user_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION rls.is_system() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(current_setting('app.scope', true), '') = 'system'
$$;

CREATE OR REPLACE FUNCTION rls.can_access(owner uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT owner = rls.app_user_id() OR rls.is_system()
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.profiles (
  user_id        uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  timezone       text NOT NULL DEFAULT 'UTC',
  tz_changed_at  timestamptz,
  age_confirmed  boolean NOT NULL DEFAULT false,
  onboarded      boolean NOT NULL DEFAULT false,
  settings       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.public_profiles (
  user_id         uuid PRIMARY KEY REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  username        text UNIQUE CHECK (username ~ '^[a-z0-9_]{3,20}$'),
  display_name    text CHECK (char_length(display_name) <= 40),
  avatar          jsonb,
  streak_current  integer NOT NULL DEFAULT 0,
  xp_total        integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.enrollments (
  user_id           uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  course_id         text NOT NULL,
  current_level_id  text,
  xp_total          integer NOT NULL DEFAULT 0,
  content_version   integer NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);

CREATE TABLE public.sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  course_id        text NOT NULL,
  level_id         text,
  lesson_index     integer NOT NULL DEFAULT 0,
  kind             text NOT NULL CHECK (kind IN ('lesson', 'practice', 'letters', 'unit_review', 'legendary', 'jump_test')),
  content_version  integer NOT NULL,
  seed             text NOT NULL,
  challenge_refs   jsonb NOT NULL,
  tz               text NOT NULL,
  started_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed', 'expired')),
  completed_at     timestamptz,
  result           jsonb,
  grader_version   integer NOT NULL
);
CREATE INDEX sessions_user_started_idx ON public.sessions (user_id, started_at DESC);

CREATE TABLE public.session_events (
  session_id       uuid NOT NULL REFERENCES public.sessions (id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  attempt_seq      integer NOT NULL CHECK (attempt_seq >= 0),
  challenge_index  integer NOT NULL CHECK (challenge_index >= 0),
  kind             text NOT NULL CHECK (kind IN ('wrong')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, attempt_seq)
);

CREATE TABLE public.xp_ledger (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  amount       integer NOT NULL,
  reason       text NOT NULL,
  session_id   uuid REFERENCES public.sessions (id) ON DELETE SET NULL,
  occurred_at  timestamptz NOT NULL,
  local_date   date NOT NULL,
  UNIQUE (session_id, reason)
);
CREATE INDEX xp_ledger_user_date_idx ON public.xp_ledger (user_id, local_date);

CREATE TABLE public.daily_activity (
  user_id      uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  local_date   date NOT NULL,
  xp           integer NOT NULL DEFAULT 0,
  sessions     integer NOT NULL DEFAULT 0,
  goal_met     boolean NOT NULL DEFAULT false,
  freeze_used  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, local_date)
);

CREATE TABLE public.streaks (
  user_id           uuid PRIMARY KEY REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  current           integer NOT NULL DEFAULT 0 CHECK (current >= 0),
  longest           integer NOT NULL DEFAULT 0 CHECK (longest >= 0),
  last_active_date  date,
  freezes           integer NOT NULL DEFAULT 0 CHECK (freezes >= 0),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.lives (
  user_id     uuid PRIMARY KEY REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  policy      text NOT NULL DEFAULT 'hearts' CHECK (policy IN ('hearts', 'unlimited')),
  count       integer NOT NULL CHECK (count >= 0),
  updated_at  timestamptz NOT NULL
);

CREATE TABLE public.content_versions (
  course_id        text NOT NULL,
  version          integer NOT NULL CHECK (version > 0),
  bundle_path      text NOT NULL,
  min_app_version  text NOT NULL DEFAULT '0.1.0',
  includes_drafts  boolean NOT NULL DEFAULT false,
  is_current       boolean NOT NULL DEFAULT false,
  published_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, version)
);
CREATE UNIQUE INDEX content_versions_one_current ON public.content_versions (course_id) WHERE is_current;

CREATE TABLE public.app_config (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------
-- RLS: deny-all for API roles; explicit app_server policies
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles', 'public_profiles', 'enrollments', 'sessions', 'session_events',
                           'xp_ledger', 'daily_activity', 'streaks', 'lives']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format(
      'CREATE POLICY app_server_own_rows ON public.%I TO app_server USING (rls.can_access(user_id)) WITH CHECK (rls.can_access(user_id))',
      t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['content_versions', 'app_config']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('CREATE POLICY app_server_read ON public.%I FOR SELECT TO app_server USING (true)', t);
    EXECUTE format(
      'CREATE POLICY app_server_system_write ON public.%I FOR ALL TO app_server USING (rls.is_system()) WITH CHECK (rls.is_system())',
      t);
  END LOOP;
END
$$;

-- public_profiles are readable by any signed-in user through the API (e.g. leaderboards), so
-- app_server may read them all; writes stay owner/system-only.
CREATE POLICY app_server_read_all ON public.public_profiles FOR SELECT TO app_server USING (true);
