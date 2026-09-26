-- Behavioral isolation: with real rows for several users in every user-owned table, app_server
-- sees and changes only the scoped user's rows, sees nothing without a scope, and everything in
-- system scope; anon/authenticated are refused outright.
BEGIN;
SET LOCAL search_path = extensions, public;
SELECT plan(12);

-- ---------------------------------------------------------------------------------------------
-- Fixtures (as the superuser; the auth.users trigger creates profiles + public_profiles)
-- ---------------------------------------------------------------------------------------------
INSERT INTO auth.users (id, is_anonymous) VALUES
  ('11111111-1111-4111-8111-111111111111', true),
  ('22222222-2222-4222-8222-222222222222', false),
  ('33333333-3333-4333-8333-333333333333', false);

INSERT INTO public.league_weeks (starts_at, ends_at) VALUES ('2026-09-21', '2026-09-28');
INSERT INTO public.league_cohorts (week_id, tier) SELECT id, 'mes' FROM public.league_weeks;
INSERT INTO public.league_cohorts (week_id, tier) SELECT id, 'mes' FROM public.league_weeks;
INSERT INTO public.quest_defs (id, template, target, reward) VALUES ('earn_xp', 'earn {n} xp', 30, 5);

CREATE FUNCTION pg_temp.seed(u uuid, cohort_rank int) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  s uuid := gen_random_uuid();
  wk bigint := (SELECT id FROM public.league_weeks LIMIT 1);
  co bigint := (SELECT id FROM public.league_cohorts ORDER BY id OFFSET cohort_rank - 1 LIMIT 1);
BEGIN
  INSERT INTO public.consents (user_id, kind, granted) VALUES (u, 'analytics', true);
  INSERT INTO public.enrollments (user_id, course_id, content_version) VALUES (u, 'fixture', 1);
  INSERT INTO public.level_progress (user_id, course_id, level_id, lessons_done) VALUES (u, 'fixture', 'u01-l1', 1);
  INSERT INTO public.sessions (id, user_id, course_id, kind, content_version, seed, challenge_refs, tz, expires_at, grader_version)
    VALUES (s, u, 'fixture', 'lesson', 1, 'x', '[]', 'UTC', now() + interval '1 day', 1);
  INSERT INTO public.session_events (session_id, user_id, attempt_seq, challenge_index, kind) VALUES (s, u, 0, 0, 'wrong');
  INSERT INTO public.session_answers (session_id, user_id, idx, attempt_seq, challenge_type, content_version, response, verdict, ms)
    VALUES (s, u, 0, 0, 'select_image', 1, '{"kind":"choice","value":0}', 'correct', 900);
  INSERT INTO public.daily_activity (user_id, local_date, xp, sessions) VALUES (u, '2026-09-25', 10, 1);
  INSERT INTO public.streaks (user_id, current) VALUES (u, 1);
  INSERT INTO public.xp_ledger (user_id, amount, reason, session_id, occurred_at, local_date)
    VALUES (u, 10, 'session', s, now(), '2026-09-25');
  INSERT INTO public.lives (user_id, count, updated_at) VALUES (u, 5, now());
  INSERT INTO public.user_items (user_id, item, qty) VALUES (u, 'streak_freeze', 1);
  INSERT INTO public.lexeme_memory (user_id, lexeme_id, due, stability, difficulty) VALUES (u, 'lx_a', now(), 1, 5);
  INSERT INTO public.letter_memory (user_id, letter_id, due, stability, difficulty) VALUES (u, 'l_be', now(), 1, 5);
  INSERT INTO public.mistakes (user_id, item_ref, last_wrong_at) VALUES (u, 'lexeme:lx_a', now());
  INSERT INTO public.reports (user_id, session_id, item_ref, kind) VALUES (u, s, 'lexeme:lx_a', 'other');
  INSERT INTO public.wallet (user_id, coins) VALUES (u, 10);
  INSERT INTO public.coin_ledger (user_id, amount, reason) VALUES (u, 10, 'signup');
  INSERT INTO public.league_members (cohort_id, week_id, user_id) VALUES (co, wk, u);
  INSERT INTO public.user_league (user_id) VALUES (u);
  INSERT INTO public.user_quests (user_id, local_date, quest_id) VALUES (u, '2026-09-25', 'earn_xp');
  INSERT INTO public.entitlements (user_id, entitlement, source) VALUES (u, 'plus', 'grant');
  INSERT INTO public.push_subscriptions (user_id, endpoint, keys)
    VALUES (u, 'https://push.example.test/' || u, '{"p256dh":"k","auth":"a"}');
  INSERT INTO public.speech_usage (user_id, day, count) VALUES (u, '2026-09-25', 1);
END
$$;
-- alice and carol share cohort 1; bob is alone in cohort 2.
SELECT pg_temp.seed('11111111-1111-4111-8111-111111111111', 1);
SELECT pg_temp.seed('22222222-2222-4222-8222-222222222222', 2);
SELECT pg_temp.seed('33333333-3333-4333-8333-333333333333', 1);

CREATE TEMP TABLE user_tables AS
  SELECT c.table_name::text AS t FROM information_schema.columns c
  JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    AND tb.table_type = 'BASE TABLE'
  WHERE c.table_schema = 'public' AND c.column_name = 'user_id';

SELECT is_empty(
  $$ SELECT t FROM user_tables
     WHERE (xpath('/row/n/text()', query_to_xml(format(
       'SELECT count(DISTINCT user_id) AS n FROM public.%I', t), false, true, '')))[1]::text::int < 3 $$,
  'fixtures: every user-owned table holds rows for all three users');

-- Runs `SELECT count(*) … WHERE <cond>` on every user table as app_server in the given scope and
-- returns the tables where the count is non-zero. Invoker function: SET ROLE is allowed here.
CREATE FUNCTION pg_temp.visible(scope_user uuid, system boolean, cond text)
RETURNS TABLE (t text, n int) LANGUAGE plpgsql AS $$
DECLARE
  tbls text[] := ARRAY(SELECT ut.t FROM user_tables ut ORDER BY 1);
  tbl text;
BEGIN
  PERFORM set_config('app.user_id', coalesce(scope_user::text, ''), true);
  PERFORM set_config('app.scope', CASE WHEN system THEN 'system' ELSE '' END, true);
  SET LOCAL ROLE app_server;
  FOREACH tbl IN ARRAY tbls LOOP
    t := tbl;
    EXECUTE format('SELECT count(*)::int FROM public.%I WHERE %s', tbl, cond) INTO n;
    IF n > 0 THEN RETURN NEXT; END IF;
  END LOOP;
  RESET ROLE;
  PERFORM set_config('app.user_id', '', true);
  PERFORM set_config('app.scope', '', true);
END
$$;

-- Tries to UPDATE and DELETE other users' rows everywhere; returns tables where any row changed.
-- Tables without UPDATE/DELETE grants (append-only) raise insufficient_privilege, which is a pass.
CREATE FUNCTION pg_temp.tamper(scope_user uuid) RETURNS TABLE (t text, changed int) LANGUAGE plpgsql AS $$
DECLARE
  tbls text[] := ARRAY(SELECT ut.t FROM user_tables ut ORDER BY 1);
  tbl text;
  k int;
BEGIN
  PERFORM set_config('app.user_id', scope_user::text, true);
  SET LOCAL ROLE app_server;
  FOREACH tbl IN ARRAY tbls LOOP
    t := tbl;
    changed := 0;
    BEGIN
      EXECUTE format('UPDATE public.%I SET user_id = user_id WHERE user_id <> %L', tbl, scope_user);
      GET DIAGNOSTICS k = ROW_COUNT;
      changed := changed + k;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE user_id <> %L', tbl, scope_user);
      GET DIAGNOSTICS k = ROW_COUNT;
      changed := changed + k;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    IF changed > 0 THEN RETURN NEXT; END IF;
  END LOOP;
  RESET ROLE;
  PERFORM set_config('app.user_id', '', true);
END
$$;

-- Tries to INSERT, into each table, a copy of one of the scoped user's own rows with user_id set
-- to the victim. Returns each table's outcome: 'denied' (RLS WITH CHECK, SQLSTATE 42501, which
-- Postgres checks before unique, check and FK constraints), 'inserted', or the unexpected SQLSTATE.
CREATE FUNCTION pg_temp.forge(scope_user uuid, victim uuid) RETURNS TABLE (t text, outcome text) LANGUAGE plpgsql AS $$
DECLARE
  stmts text[] := ARRAY(
    SELECT format('INSERT INTO public.%1$I (%2$s) SELECT %3$s FROM public.%1$I WHERE user_id = %4$L LIMIT 1',
                  c.table_name,
                  string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position),
                  string_agg(CASE WHEN c.column_name = 'user_id' THEN quote_literal(victim) || '::uuid'
                                  ELSE quote_ident(c.column_name) END, ', ' ORDER BY c.ordinal_position),
                  scope_user)
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name IN (SELECT ut.t FROM user_tables ut)
      AND c.is_identity = 'NO' AND c.is_generated = 'NEVER'
    GROUP BY c.table_name ORDER BY c.table_name);
  stmt text;
BEGIN
  PERFORM set_config('app.user_id', scope_user::text, true);
  SET LOCAL ROLE app_server;
  FOREACH stmt IN ARRAY stmts LOOP
    t := split_part(split_part(stmt, 'public.', 2), ' ', 1);
    BEGIN
      EXECUTE stmt;
      outcome := 'inserted';
    EXCEPTION
      WHEN insufficient_privilege THEN outcome := 'denied';
      WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    RETURN NEXT;
  END LOOP;
  RESET ROLE;
  PERFORM set_config('app.user_id', '', true);
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------------------------
SELECT is_empty(
  $$ SELECT * FROM pg_temp.visible('11111111-1111-4111-8111-111111111111', false,
       'user_id <> ''11111111-1111-4111-8111-111111111111''')
     WHERE t NOT IN ('public_profiles', 'league_members') $$,
  'alice sees no other user''s rows in any user-owned table (except the deliberately shared ones)');

SELECT set_eq(
  $$ SELECT t FROM pg_temp.visible('11111111-1111-4111-8111-111111111111', false, 'true') $$,
  $$ SELECT t FROM user_tables $$,
  'alice sees her own rows in every user-owned table');

SELECT is_empty(
  $$ SELECT * FROM pg_temp.visible('11111111-1111-4111-8111-111111111111', false,
       'user_id = ''22222222-2222-4222-8222-222222222222'' AND true') WHERE t = 'league_members' $$,
  'alice cannot see league members of a cohort she is not in');

SELECT results_eq(
  $$ SELECT n FROM pg_temp.visible('11111111-1111-4111-8111-111111111111', false,
       'user_id = ''33333333-3333-4333-8333-333333333333''') WHERE t = 'league_members' $$,
  $$ VALUES (1) $$,
  'alice can see her own cohort''s members (the leaderboard)');

SELECT results_eq(
  $$ SELECT n FROM pg_temp.visible('11111111-1111-4111-8111-111111111111', false, 'true') WHERE t = 'public_profiles' $$,
  $$ VALUES (3) $$,
  'public_profiles are readable by any scope (by design)');

SELECT is_empty(
  $$ SELECT * FROM pg_temp.visible(NULL, false, 'true') WHERE t <> 'public_profiles' $$,
  'with no scope set, app_server sees no user-owned rows');

SELECT is_empty(
  $$ SELECT ut.t FROM user_tables ut
     WHERE ut.t NOT IN (SELECT v.t FROM pg_temp.visible(NULL, true, 'user_id = ''22222222-2222-4222-8222-222222222222''') v) $$,
  'system scope sees every user''s rows');

-- ---------------------------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------------------------
SELECT is_empty(
  $$ SELECT * FROM pg_temp.tamper('11111111-1111-4111-8111-111111111111') $$,
  'alice cannot update or delete any other user''s rows');

SELECT set_eq(
  $$ SELECT t, outcome FROM pg_temp.forge('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222') $$,
  $$ SELECT t, 'denied' FROM user_tables $$,
  'alice cannot insert rows owned by bob into any user-owned table (RLS denies every attempt)');

-- ---------------------------------------------------------------------------------------------
-- Browser roles
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.api_role_readable(r text) RETURNS TABLE (t text) LANGUAGE plpgsql AS $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1 LOOP
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', r);
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', tbl);
      t := tbl;
      RETURN NEXT;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  RESET ROLE;
END
$$;

SELECT is_empty($$ SELECT * FROM pg_temp.api_role_readable('anon') $$, 'anon gets permission denied on every table');
SELECT is_empty($$ SELECT * FROM pg_temp.api_role_readable('authenticated') $$,
  'authenticated gets permission denied on every table');

SELECT * FROM finish();
ROLLBACK;
