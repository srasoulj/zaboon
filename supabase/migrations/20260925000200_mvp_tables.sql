-- Remaining MVP tables (docs/ARCHITECTURE.md §5.1), the profile trigger on auth.users, and
-- integrity hardening for the core tables created in 20260925000100_core.sql.
--
-- Isolation model (unchanged, ADR 0009):
--   * anon/authenticated: no grants, no policies (deny-all).
--   * user-scoped tables: `app_server_own_rows` policy USING/WITH CHECK rls.can_access(user_id).
--   * shared tables: app_server may read; writes need `app.scope = system`.

-- ---------------------------------------------------------------------------------------------
-- Profiles are created by a trigger on auth.users insert (§5.1, §10.1). Idempotent, so code that
-- still inserts profiles itself with ON CONFLICT DO NOTHING keeps working.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.handle_new_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.public_profiles (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION internal.handle_new_auth_user() FROM PUBLIC;

CREATE TRIGGER zaboon_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION internal.handle_new_auth_user();

-- ---------------------------------------------------------------------------------------------
-- Core-table hardening
-- ---------------------------------------------------------------------------------------------
-- A child row that names a session must belong to the session's owner. Enforced in the database
-- with composite foreign keys (FK checks bypass RLS, so a plain session_id FK would let one user
-- attach rows to another user's session). ON UPDATE CASCADE lets account merge move a guest's
-- sessions, together with their events, answers and ledger rows, by updating sessions.user_id.
ALTER TABLE public.sessions ADD CONSTRAINT sessions_id_user_key UNIQUE (id, user_id);

ALTER TABLE public.session_events
  ADD CONSTRAINT session_events_session_owner_fkey FOREIGN KEY (session_id, user_id)
  REFERENCES public.sessions (id, user_id) ON UPDATE CASCADE ON DELETE CASCADE;
CREATE INDEX session_events_user_idx ON public.session_events (user_id);

ALTER TABLE public.xp_ledger
  ADD CONSTRAINT xp_ledger_session_owner_fkey FOREIGN KEY (session_id, user_id)
  REFERENCES public.sessions (id, user_id) ON UPDATE CASCADE ON DELETE SET NULL (session_id);

-- Stale-session sweep (internal.expire_stale_sessions).
CREATE INDEX sessions_started_expires_idx ON public.sessions (expires_at) WHERE status = 'started';

-- Non-negative counters on core tables.
ALTER TABLE public.daily_activity
  ADD CONSTRAINT daily_activity_xp_check CHECK (xp >= 0),
  ADD CONSTRAINT daily_activity_sessions_check CHECK (sessions >= 0);
ALTER TABLE public.enrollments ADD CONSTRAINT enrollments_xp_total_check CHECK (xp_total >= 0);
ALTER TABLE public.enrollments ADD CONSTRAINT enrollments_content_version_check CHECK (content_version > 0);
ALTER TABLE public.public_profiles
  ADD CONSTRAINT public_profiles_streak_current_check CHECK (streak_current >= 0),
  ADD CONSTRAINT public_profiles_xp_total_check CHECK (xp_total >= 0);

-- xp_ledger is append-only (§5.1): the server may insert and read, never rewrite history.
-- Referential actions (cascade / set null / account merge moves) run as the table owner.
REVOKE UPDATE, DELETE, TRUNCATE ON public.xp_ledger FROM app_server;

-- ---------------------------------------------------------------------------------------------
-- New MVP tables
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.consents (
  user_id     uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('analytics', 'marketing')),
  granted     boolean NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE public.level_progress (
  user_id       uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  course_id     text NOT NULL,
  level_id      text NOT NULL,
  lessons_done  integer NOT NULL DEFAULT 0 CHECK (lessons_done >= 0),
  legendary     boolean NOT NULL DEFAULT false,
  completed_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id, level_id)
);

CREATE TABLE public.session_answers (
  session_id       uuid NOT NULL,
  user_id          uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  idx              integer NOT NULL CHECK (idx >= 0),
  attempt_seq      integer NOT NULL CHECK (attempt_seq >= 0),
  challenge_type   text NOT NULL,
  item_refs        text[] NOT NULL DEFAULT '{}',
  content_version  integer NOT NULL CHECK (content_version > 0),
  response         jsonb NOT NULL,
  verdict          text NOT NULL CHECK (verdict IN ('correct', 'typo', 'spelling', 'wrong', 'skipped')),
  ms               integer NOT NULL CHECK (ms >= 0),
  hinted           boolean NOT NULL DEFAULT false,
  rolled_up        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, idx, attempt_seq),
  FOREIGN KEY (session_id, user_id) REFERENCES public.sessions (id, user_id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX session_answers_user_idx ON public.session_answers (user_id);
CREATE INDEX session_answers_created_idx ON public.session_answers (created_at);
CREATE INDEX session_answers_pending_rollup_idx ON public.session_answers (created_at) WHERE NOT rolled_up;

CREATE TABLE public.user_items (
  user_id     uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  item        text NOT NULL CHECK (item ~ '^[a-z0-9_]{1,40}$'),
  qty         integer NOT NULL DEFAULT 0 CHECK (qty >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item)
);

-- FSRS cards mirror the contracts' FsrsCard (ts-fsrs Card).
CREATE TABLE public.lexeme_memory (
  user_id         uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  lexeme_id       text NOT NULL,
  due             timestamptz NOT NULL,
  stability       double precision NOT NULL CHECK (stability >= 0),
  difficulty      double precision NOT NULL,
  elapsed_days    double precision NOT NULL DEFAULT 0 CHECK (elapsed_days >= 0),
  scheduled_days  double precision NOT NULL DEFAULT 0 CHECK (scheduled_days >= 0),
  learning_steps  integer NOT NULL DEFAULT 0 CHECK (learning_steps >= 0),
  reps            integer NOT NULL DEFAULT 0 CHECK (reps >= 0),
  lapses          integer NOT NULL DEFAULT 0 CHECK (lapses >= 0),
  state           smallint NOT NULL DEFAULT 0 CHECK (state BETWEEN 0 AND 3),
  last_review     timestamptz,
  exposures       integer NOT NULL DEFAULT 0 CHECK (exposures >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lexeme_id)
);
CREATE INDEX lexeme_memory_due_idx ON public.lexeme_memory (user_id, due);

CREATE TABLE public.letter_memory (
  user_id         uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  letter_id       text NOT NULL,
  due             timestamptz NOT NULL,
  stability       double precision NOT NULL CHECK (stability >= 0),
  difficulty      double precision NOT NULL,
  elapsed_days    double precision NOT NULL DEFAULT 0 CHECK (elapsed_days >= 0),
  scheduled_days  double precision NOT NULL DEFAULT 0 CHECK (scheduled_days >= 0),
  learning_steps  integer NOT NULL DEFAULT 0 CHECK (learning_steps >= 0),
  reps            integer NOT NULL DEFAULT 0 CHECK (reps >= 0),
  lapses          integer NOT NULL DEFAULT 0 CHECK (lapses >= 0),
  state           smallint NOT NULL DEFAULT 0 CHECK (state BETWEEN 0 AND 3),
  last_review     timestamptz,
  exposures       integer NOT NULL DEFAULT 0 CHECK (exposures >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, letter_id)
);
CREATE INDEX letter_memory_due_idx ON public.letter_memory (user_id, due);

CREATE TABLE public.mistakes (
  user_id        uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  item_ref       text NOT NULL CHECK (item_ref ~ '^(lexeme|sentence|letter|chat):[a-z0-9_-]+$'),
  times_wrong    integer NOT NULL DEFAULT 1 CHECK (times_wrong >= 1),
  last_wrong_at  timestamptz NOT NULL,
  resolved_at    timestamptz,
  PRIMARY KEY (user_id, item_ref)
);
CREATE INDEX mistakes_open_idx ON public.mistakes (user_id, last_wrong_at DESC) WHERE resolved_at IS NULL;

CREATE TABLE public.reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  session_id  uuid,
  item_ref    text NOT NULL CHECK (item_ref ~ '^(lexeme|sentence|letter|chat):[a-z0-9_-]+$'),
  kind        text NOT NULL CHECK (kind IN ('answer_should_be_accepted', 'audio_problem', 'content_error', 'other')),
  answer      text CHECK (char_length(answer) <= 500),
  text        text CHECK (char_length(text) <= 1000),
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'rejected')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, user_id) REFERENCES public.sessions (id, user_id)
    ON UPDATE CASCADE ON DELETE SET NULL (session_id)
);
CREATE INDEX reports_status_created_idx ON public.reports (status, created_at DESC);
CREATE INDEX reports_user_idx ON public.reports (user_id);

-- Nightly content-QA roll-up of session_answers (internal.rollup_item_stats). Shared table.
CREATE TABLE public.item_stats (
  item_ref           text NOT NULL,
  content_version    integer NOT NULL CHECK (content_version > 0),
  attempts           integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  wrong              integer NOT NULL DEFAULT 0 CHECK (wrong >= 0 AND wrong <= attempts),
  error_rate         double precision NOT NULL DEFAULT 0 CHECK (error_rate BETWEEN 0 AND 1),
  top_wrong_answers  jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_ref, content_version)
);

-- Token buckets for per-user / per-IP rate limits (§7, §9). Keys are opaque strings chosen by the
-- route layer (e.g. "sessions:<user id>"); not user-owned rows, so app_server may use any key.
CREATE TABLE public.rate_limits (
  key         text PRIMARY KEY CHECK (char_length(key) BETWEEN 1 AND 200),
  tokens      double precision NOT NULL CHECK (tokens >= 0),
  updated_at  timestamptz NOT NULL
);
CREATE INDEX rate_limits_updated_idx ON public.rate_limits (updated_at);

-- ---------------------------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['consents', 'level_progress', 'session_answers', 'user_items', 'lexeme_memory',
                           'letter_memory', 'mistakes', 'reports']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format(
      'CREATE POLICY app_server_own_rows ON public.%I TO app_server USING (rls.can_access(user_id)) WITH CHECK (rls.can_access(user_id))',
      t);
  END LOOP;
END
$$;

ALTER TABLE public.item_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.item_stats FROM anon, authenticated;
CREATE POLICY app_server_read ON public.item_stats FOR SELECT TO app_server USING (true);
CREATE POLICY app_server_system_write ON public.item_stats FOR ALL TO app_server
  USING (rls.is_system()) WITH CHECK (rls.is_system());

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM anon, authenticated;
CREATE POLICY app_server_all ON public.rate_limits TO app_server USING (true) WITH CHECK (true);

-- Answers are written once per completed session and pruned by cron; the server never edits them.
REVOKE UPDATE ON public.session_answers FROM app_server;
