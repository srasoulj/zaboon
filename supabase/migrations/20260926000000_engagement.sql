-- P2 engagement (Wave 3, ws-engagement): leagues, daily quests, coins and the shop.
-- Expand-only: constraints, policies, an index and seed rows on the tables that
-- 20260925000300_p2_tables.sql created. Nothing here changes an MVP table.

-- ---------------------------------------------------------------------------------------------
-- League weeks: [Monday 00:00 UTC, next Monday 00:00 UTC), whatever the session's TimeZone.
-- (`+ interval '168 hours'` is exact; `+ interval '7 days'` would follow the session's DST rules.)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.league_weeks
  ADD CONSTRAINT league_weeks_monday_utc CHECK (
    date_trunc('week', starts_at AT TIME ZONE 'UTC') = starts_at AT TIME ZONE 'UTC'
    AND ends_at = starts_at + interval '168 hours'
  );

-- The first XP of a week happens in a learner's own commit (user scope), which creates the week's
-- row with INSERT … ON CONFLICT (starts_at) DO NOTHING. Only an open week can be created there;
-- closing a week (UPDATE closed_at) stays system-only (the rollover cron).
CREATE POLICY app_server_user_open_week ON public.league_weeks FOR INSERT TO app_server
  WITH CHECK (rls.app_user_id() IS NOT NULL AND closed_at IS NULL);

-- ---------------------------------------------------------------------------------------------
-- Coins: a shop purchase is one negative coin_ledger row with reason = the item and
-- ref = the client's purchaseId. A purchaseId buys at most one item, whatever the item.
-- ---------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX coin_ledger_purchase_ref_uniq ON public.coin_ledger (user_id, ref)
  WHERE reason IN ('streak_freeze', 'heart_refill');

ALTER TABLE public.coin_ledger
  ADD CONSTRAINT coin_ledger_purchase_is_debit CHECK (
    reason NOT IN ('streak_freeze', 'heart_refill') OR (amount < 0 AND ref IS NOT NULL)
  );

-- ---------------------------------------------------------------------------------------------
-- Quest definitions: exactly @zaboon/game-rules QUEST_TEMPLATES (id, template = metric, target;
-- reward = DEFAULT_APP_CONFIG.quests.rewardCoins). A drift test keeps the two equal.
-- ---------------------------------------------------------------------------------------------
INSERT INTO public.quest_defs (id, template, target, reward) VALUES
  ('xp_20', 'xp', 20, 10),
  ('xp_40', 'xp', 40, 10),
  ('xp_60', 'xp', 60, 10),
  ('lessons_1', 'lessons', 1, 10),
  ('lessons_2', 'lessons', 2, 10),
  ('lessons_3', 'lessons', 3, 10),
  ('perfect_1', 'perfect_sessions', 1, 10),
  ('perfect_2', 'perfect_sessions', 2, 10),
  ('practice_1', 'practice_sessions', 1, 10),
  ('letters_1', 'letters_sessions', 1, 10)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- Indexes for the reads the engagement routes make.
-- ---------------------------------------------------------------------------------------------
CREATE INDEX league_weeks_open_idx ON public.league_weeks (starts_at) WHERE closed_at IS NULL;
