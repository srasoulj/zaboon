-- P2 engagement (20260926000000_engagement.sql): league weeks are Monday 00:00 UTC weeks that a
-- learner's commit may open but never close, quest_defs is seeded from the quest templates, and a
-- shop purchase is a single debit per purchaseId.
BEGIN;
SET LOCAL search_path = extensions, public;
SELECT plan(16);

INSERT INTO auth.users (id, is_anonymous) VALUES
  ('11111111-1111-4111-8111-111111111111', false),
  ('22222222-2222-4222-8222-222222222222', false);

-- ---------------------------------------------------------------------------------------------
-- League week shape
-- ---------------------------------------------------------------------------------------------
SET LOCAL TimeZone = 'Europe/Berlin';
SELECT lives_ok(
  $$ INSERT INTO public.league_weeks (starts_at, ends_at)
     VALUES ('2026-03-23T00:00:00Z', '2026-03-30T00:00:00Z') $$,
  'a Monday 00:00 UTC week of exactly 168 hours is accepted (even across a DST change)');
SELECT throws_ok(
  $$ INSERT INTO public.league_weeks (starts_at, ends_at)
     VALUES ('2026-09-22T00:00:00Z', '2026-09-29T00:00:00Z') $$,
  '23514', NULL, 'a week must start on a Monday');
SELECT throws_ok(
  $$ INSERT INTO public.league_weeks (starts_at, ends_at)
     VALUES ('2026-09-21T00:00:00+02:00', '2026-09-28T00:00:00+02:00') $$,
  '23514', NULL, 'a week starts at 00:00 UTC, not local midnight');
SELECT throws_ok(
  $$ INSERT INTO public.league_weeks (starts_at, ends_at)
     VALUES ('2026-09-21T00:00:00Z', '2026-09-29T00:00:00Z') $$,
  '23514', NULL, 'a week lasts exactly 7 days');
RESET TimeZone;

-- ---------------------------------------------------------------------------------------------
-- Who may open and close a week
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.as_user(u uuid, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  n int;
BEGIN
  PERFORM set_config('app.user_id', u::text, true);
  SET LOCAL ROLE app_server;
  BEGIN
    EXECUTE stmt;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    PERFORM set_config('app.user_id', '', true);
    RETURN 'denied';
  END;
  RESET ROLE;
  PERFORM set_config('app.user_id', '', true);
  RETURN n::text;
END
$$;

SELECT is(
  pg_temp.as_user('11111111-1111-4111-8111-111111111111',
    $$ INSERT INTO public.league_weeks (starts_at, ends_at)
       VALUES ('2026-09-21T00:00:00Z', '2026-09-28T00:00:00Z') ON CONFLICT (starts_at) DO NOTHING $$),
  '1', 'a user-scoped commit opens the week');
SELECT is(
  pg_temp.as_user('22222222-2222-4222-8222-222222222222',
    $$ INSERT INTO public.league_weeks (starts_at, ends_at)
       VALUES ('2026-09-21T00:00:00Z', '2026-09-28T00:00:00Z') ON CONFLICT (starts_at) DO NOTHING $$),
  '0', 'a second commit finds it open (ON CONFLICT DO NOTHING)');
SELECT is(
  pg_temp.as_user('11111111-1111-4111-8111-111111111111',
    $$ INSERT INTO public.league_weeks (starts_at, ends_at, closed_at)
       VALUES ('2026-09-14T00:00:00Z', '2026-09-21T00:00:00Z', now()) $$),
  'denied', 'a user-scoped commit cannot create a closed week');
SELECT is(
  pg_temp.as_user('11111111-1111-4111-8111-111111111111',
    $$ UPDATE public.league_weeks SET closed_at = now() $$),
  '0', 'a user-scoped commit cannot close a week (no row is updatable)');
SELECT is(
  pg_temp.as_user(NULL,
    $$ INSERT INTO public.league_weeks (starts_at, ends_at)
       VALUES ('2026-10-05T00:00:00Z', '2026-10-12T00:00:00Z') $$),
  'denied', 'without a user scope nothing opens a week');

CREATE FUNCTION pg_temp.as_system(stmt text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  n int;
BEGIN
  PERFORM set_config('app.scope', 'system', true);
  SET LOCAL ROLE app_server;
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  PERFORM set_config('app.scope', '', true);
  RETURN n;
END
$$;
SELECT is(
  pg_temp.as_system($$ UPDATE public.league_weeks SET closed_at = now()
                       WHERE starts_at = '2026-09-21T00:00:00Z' $$),
  1, 'the system scope (rollover) closes a week');

-- ---------------------------------------------------------------------------------------------
-- Quest definitions
-- ---------------------------------------------------------------------------------------------
SELECT set_eq(
  $$ SELECT id, template, target, reward FROM public.quest_defs $$,
  $$ VALUES ('xp_20', 'xp', 20, 10), ('xp_40', 'xp', 40, 10), ('xp_60', 'xp', 60, 10),
            ('lessons_1', 'lessons', 1, 10), ('lessons_2', 'lessons', 2, 10), ('lessons_3', 'lessons', 3, 10),
            ('perfect_1', 'perfect_sessions', 1, 10), ('perfect_2', 'perfect_sessions', 2, 10),
            ('practice_1', 'practice_sessions', 1, 10), ('letters_1', 'letters_sessions', 1, 10) $$,
  'quest_defs holds the quest templates');
SELECT lives_ok(
  $$ INSERT INTO public.user_quests (user_id, local_date, quest_id, progress)
     VALUES ('11111111-1111-4111-8111-111111111111', '2026-09-25', 'xp_20', 5) $$,
  'user_quests can reference a seeded quest');

-- ---------------------------------------------------------------------------------------------
-- Purchases
-- ---------------------------------------------------------------------------------------------
INSERT INTO public.coin_ledger (user_id, amount, reason, ref)
  VALUES ('11111111-1111-4111-8111-111111111111', -100, 'streak_freeze', 'a0000000-0000-4000-8000-000000000001');
SELECT throws_ok(
  $$ INSERT INTO public.coin_ledger (user_id, amount, reason, ref)
     VALUES ('11111111-1111-4111-8111-111111111111', -150, 'heart_refill', 'a0000000-0000-4000-8000-000000000001') $$,
  '23505', NULL, 'a purchaseId buys one item only');
SELECT lives_ok(
  $$ INSERT INTO public.coin_ledger (user_id, amount, reason, ref)
     VALUES ('22222222-2222-4222-8222-222222222222', -150, 'heart_refill', 'a0000000-0000-4000-8000-000000000001') $$,
  'purchaseIds are per user');
SELECT throws_ok(
  $$ INSERT INTO public.coin_ledger (user_id, amount, reason, ref)
     VALUES ('11111111-1111-4111-8111-111111111111', 100, 'streak_freeze', 'a0000000-0000-4000-8000-000000000002') $$,
  '23514', NULL, 'a purchase is a debit');
SELECT throws_ok(
  $$ INSERT INTO public.coin_ledger (user_id, amount, reason, ref)
     VALUES ('11111111-1111-4111-8111-111111111111', -100, 'streak_freeze', NULL) $$,
  '23514', NULL, 'a purchase carries its purchaseId');

SELECT * FROM finish();
ROLLBACK;
