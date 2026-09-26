-- P2 speak (20260927000000_speech_quota.sql): speech_usage is a user-owned counter per UTC day:
-- RLS for app_server only, one row per (user, day), never negative, gone with the account, and
-- no column that could hold audio or a transcript.
BEGIN;
SET LOCAL search_path = extensions, public;
SELECT plan(14);

INSERT INTO auth.users (id, is_anonymous) VALUES
  ('11111111-1111-4111-8111-111111111111', false),
  ('22222222-2222-4222-8222-222222222222', false);

-- ---------------------------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------------------------
SELECT has_table('public', 'speech_usage', 'speech_usage exists');
SELECT columns_are('public', 'speech_usage', ARRAY['user_id', 'day', 'count', 'updated_at'],
  'speech_usage holds a counter only (the audio is never stored)');
SELECT col_is_pk('public', 'speech_usage', ARRAY['user_id', 'day'], 'one row per learner per day');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.speech_usage'::regclass),
  'row level security is on');
SELECT policies_are('public', 'speech_usage', ARRAY['app_server_own_rows'],
  'the only policy is app_server_own_rows');
SELECT policy_roles_are('public', 'speech_usage', 'app_server_own_rows', ARRAY['app_server'],
  'the policy applies to app_server only');
SELECT ok(
  NOT has_table_privilege('anon', 'public.speech_usage', 'SELECT, INSERT, UPDATE, DELETE')
  AND NOT has_table_privilege('authenticated', 'public.speech_usage', 'SELECT, INSERT, UPDATE, DELETE'),
  'the browser roles have no privileges');

SELECT lives_ok(
  $$ INSERT INTO public.speech_usage (user_id, day, count)
     VALUES ('11111111-1111-4111-8111-111111111111', '2026-09-27', 3) $$,
  'a learner row is accepted');
SELECT throws_ok(
  $$ INSERT INTO public.speech_usage (user_id, day, count)
     VALUES ('22222222-2222-4222-8222-222222222222', '2026-09-27', -1) $$,
  '23514', NULL, 'the count is never negative');
SELECT throws_ok(
  $$ INSERT INTO public.speech_usage (user_id, day, count)
     VALUES ('33333333-3333-4333-8333-333333333333', '2026-09-27', 1) $$,
  '23503', NULL, 'the row belongs to an existing profile');

-- ---------------------------------------------------------------------------------------------
-- Isolation as app_server
-- ---------------------------------------------------------------------------------------------
INSERT INTO public.speech_usage (user_id, day, count)
  VALUES ('22222222-2222-4222-8222-222222222222', '2026-09-27', 5);

CREATE FUNCTION pg_temp.as_user(u uuid, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  n int;
BEGIN
  PERFORM set_config('app.user_id', coalesce(u::text, ''), true);
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
  pg_temp.as_user('11111111-1111-4111-8111-111111111111', $$ SELECT * FROM public.speech_usage $$),
  '1', 'a learner sees only their own row');
SELECT is(
  pg_temp.as_user('11111111-1111-4111-8111-111111111111',
    $$ UPDATE public.speech_usage SET count = 0 WHERE user_id = '22222222-2222-4222-8222-222222222222' $$),
  '0', 'a learner cannot change another learner''s count');
SELECT is(
  pg_temp.as_user('11111111-1111-4111-8111-111111111111',
    $$ INSERT INTO public.speech_usage (user_id, day, count)
       VALUES ('22222222-2222-4222-8222-222222222222', '2026-09-28', 0) $$),
  'denied', 'a learner cannot write a row for another learner');

-- ---------------------------------------------------------------------------------------------
-- Account deletion
-- ---------------------------------------------------------------------------------------------
DELETE FROM public.profiles WHERE user_id = '11111111-1111-4111-8111-111111111111';
SELECT is_empty(
  $$ SELECT 1 FROM public.speech_usage WHERE user_id = '11111111-1111-4111-8111-111111111111' $$,
  'deleting the profile deletes the usage rows');

SELECT * FROM finish();
ROLLBACK;
