-- P2 tables (docs/ARCHITECTURE.md §5.2): coins, leagues, quests, entitlements, webhooks, Web Push.
-- Created now (expand-only) so later waves need no schema work; nothing reads them until their
-- feature flags are on.

-- ---------------------------------------------------------------------------------------------
-- Coins
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.wallet (
  user_id     uuid PRIMARY KEY REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  coins       integer NOT NULL DEFAULT 0 CHECK (coins >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Append-only. `ref` makes grants idempotent (e.g. reason 'quest', ref '<date>:<quest id>').
CREATE TABLE public.coin_ledger (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  amount      integer NOT NULL CHECK (amount <> 0),
  reason      text NOT NULL,
  ref         text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, reason, ref)
);
CREATE INDEX coin_ledger_user_created_idx ON public.coin_ledger (user_id, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- Leagues (§6): weekly cohorts of at most 30, joined under pg_advisory_xact_lock(week, tier).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.league_weeks (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  starts_at  timestamptz NOT NULL UNIQUE,
  ends_at    timestamptz NOT NULL,
  closed_at  timestamptz,
  CHECK (ends_at > starts_at)
);

CREATE TABLE public.league_cohorts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  week_id     bigint NOT NULL REFERENCES public.league_weeks (id) ON DELETE CASCADE,
  tier        text NOT NULL CHECK (tier IN ('mes', 'noqreh', 'tala', 'firouzeh', 'aqiq', 'lajvard', 'yaqut',
                                            'zomorrod', 'morvarid', 'almas')),
  size        integer NOT NULL DEFAULT 0 CHECK (size BETWEEN 0 AND 30),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, week_id)
);
CREATE INDEX league_cohorts_week_tier_idx ON public.league_cohorts (week_id, tier, size);

CREATE TABLE public.league_members (
  cohort_id   bigint NOT NULL,
  week_id     bigint NOT NULL,
  user_id     uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  weekly_xp   integer NOT NULL DEFAULT 0 CHECK (weekly_xp >= 0),
  final_rank  integer CHECK (final_rank >= 1),
  outcome     text CHECK (outcome IN ('promote', 'stay', 'demote')),
  joined_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cohort_id, user_id),
  -- one cohort per learner per week
  UNIQUE (week_id, user_id),
  FOREIGN KEY (cohort_id, week_id) REFERENCES public.league_cohorts (id, week_id) ON DELETE CASCADE
);
CREATE INDEX league_members_cohort_xp_idx ON public.league_members (cohort_id, weekly_xp DESC);
CREATE INDEX league_members_user_idx ON public.league_members (user_id);

CREATE TABLE public.user_league (
  user_id     uuid PRIMARY KEY REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  tier        text NOT NULL DEFAULT 'mes' CHECK (tier IN ('mes', 'noqreh', 'tala', 'firouzeh', 'aqiq', 'lajvard',
                                                          'yaqut', 'zomorrod', 'morvarid', 'almas')),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------
-- Quests
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.quest_defs (
  id        text PRIMARY KEY CHECK (id ~ '^[a-z0-9_]{1,40}$'),
  template  text NOT NULL,
  target    integer NOT NULL CHECK (target > 0),
  reward    integer NOT NULL CHECK (reward >= 0),
  active    boolean NOT NULL DEFAULT true
);

CREATE TABLE public.user_quests (
  user_id     uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  local_date  date NOT NULL,
  quest_id    text NOT NULL REFERENCES public.quest_defs (id),
  progress    integer NOT NULL DEFAULT 0 CHECK (progress >= 0),
  claimed     boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, local_date, quest_id)
);

-- ---------------------------------------------------------------------------------------------
-- Billing and notifications
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.entitlements (
  user_id      uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  entitlement  text NOT NULL CHECK (entitlement IN ('plus')),
  source       text NOT NULL CHECK (source IN ('stripe', 'revenuecat', 'grant')),
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, entitlement)
);
CREATE INDEX entitlements_expires_idx ON public.entitlements (expires_at) WHERE expires_at IS NOT NULL;

-- Stripe webhook de-duplication (insert ... ON CONFLICT DO NOTHING). System scope only.
CREATE TABLE public.webhook_events (
  event_id     text PRIMARY KEY,
  type         text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE CHECK (endpoint ~ '^https://'),
  keys        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------------------------
-- RLS helpers for leagues
-- ---------------------------------------------------------------------------------------------
-- True when the scoped user is a member of the cohort. SECURITY DEFINER so the check itself is
-- not filtered by league_members' own policy (which would recurse).
CREATE OR REPLACE FUNCTION rls.is_cohort_member(cohort bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.cohort_id = cohort AND m.user_id = rls.app_user_id()
  )
$$;
REVOKE ALL ON FUNCTION rls.is_cohort_member(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rls.is_cohort_member(bigint) TO app_server;

-- ---------------------------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wallet', 'coin_ledger', 'user_league', 'user_quests', 'entitlements', 'push_subscriptions']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format(
      'CREATE POLICY app_server_own_rows ON public.%I TO app_server USING (rls.can_access(user_id)) WITH CHECK (rls.can_access(user_id))',
      t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['league_weeks', 'league_cohorts', 'quest_defs']
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

-- A learner joins a cohort inside their own commit transaction (user scope), which creates or
-- fills a cohort. Cohorts hold no personal data, so any user-scoped transaction may insert/update.
CREATE POLICY app_server_user_join_insert ON public.league_cohorts FOR INSERT TO app_server
  WITH CHECK (rls.app_user_id() IS NOT NULL);
CREATE POLICY app_server_user_join_update ON public.league_cohorts FOR UPDATE TO app_server
  USING (rls.app_user_id() IS NOT NULL) WITH CHECK (rls.app_user_id() IS NOT NULL);

-- league_members: a learner sees their own rows and their own cohort's members (the leaderboard);
-- writes are owner/system-only.
ALTER TABLE public.league_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.league_members FROM anon, authenticated;
CREATE POLICY app_server_own_rows ON public.league_members TO app_server
  USING (rls.can_access(user_id)) WITH CHECK (rls.can_access(user_id));
CREATE POLICY app_server_read_cohort ON public.league_members FOR SELECT TO app_server
  USING (rls.is_cohort_member(cohort_id));

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_events FROM anon, authenticated;
CREATE POLICY app_server_system_only ON public.webhook_events TO app_server
  USING (rls.is_system()) WITH CHECK (rls.is_system());

-- coin_ledger is append-only, like xp_ledger.
REVOKE UPDATE, DELETE, TRUNCATE ON public.coin_ledger FROM app_server;
