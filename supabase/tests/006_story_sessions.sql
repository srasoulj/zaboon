-- P2 stories (20260927000100_story_sessions.sql): sessions.kind accepts 'story' next to every
-- earlier kind, still refuses an unknown kind, and a story session stays the learner's own row.
BEGIN;
SET LOCAL search_path = extensions, public;
SELECT plan(8);

INSERT INTO auth.users (id, is_anonymous) VALUES
  ('a1111111-1111-4111-8111-111111111111', true),
  ('a2222222-2222-4222-8222-222222222222', true);

CREATE FUNCTION pg_temp.new_session(u uuid, k text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.sessions (user_id, course_id, level_id, kind, content_version, seed,
                               challenge_refs, tz, expires_at, grader_version)
  VALUES (u, 'fixture', 'u01-st1', k, 1, 'x', '[]', 'UTC', now() + interval '1 day', 1)
$$;

-- ---------------------------------------------------------------------------------------------
-- The CHECK
-- ---------------------------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.sessions'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%kind%'),
  1, 'sessions.kind has exactly one CHECK (the old one was replaced, not stacked)');
SELECT ok(
  (SELECT convalidated FROM pg_constraint
   WHERE conrelid = 'public.sessions'::regclass AND conname = 'sessions_kind_check'),
  'sessions_kind_check is validated');

SELECT lives_ok(
  $$ SELECT pg_temp.new_session('a1111111-1111-4111-8111-111111111111', 'story') $$,
  'a story session is accepted');
SELECT lives_ok(
  $$ SELECT pg_temp.new_session('a1111111-1111-4111-8111-111111111111', k)
     FROM unnest(ARRAY['lesson', 'practice', 'letters', 'unit_review', 'legendary', 'jump_test']) k $$,
  'every earlier kind is still accepted');
SELECT throws_ok(
  $$ SELECT pg_temp.new_session('a1111111-1111-4111-8111-111111111111', 'stories') $$,
  '23514', NULL, 'an unknown kind is refused');
SELECT throws_ok(
  $$ SELECT pg_temp.new_session('a1111111-1111-4111-8111-111111111111', 'Story') $$,
  '23514', NULL, 'kinds are case-sensitive');

-- ---------------------------------------------------------------------------------------------
-- Isolation as app_server: a story session is an ordinary user-owned session row
-- ---------------------------------------------------------------------------------------------
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
  pg_temp.as_user('a2222222-2222-4222-8222-222222222222',
    $$ SELECT * FROM public.sessions WHERE kind = 'story' $$),
  '0', 'another learner does not see the story session');
SELECT is(
  pg_temp.as_user('a2222222-2222-4222-8222-222222222222',
    $$ INSERT INTO public.sessions (user_id, course_id, kind, content_version, seed, challenge_refs,
                                    tz, expires_at, grader_version)
       VALUES ('a2222222-2222-4222-8222-222222222222', 'fixture', 'story', 1, 'x', '[]', 'UTC',
               now() + interval '1 day', 1) $$),
  '1', 'app_server starts a story session for the scoped learner');

SELECT * FROM finish();
ROLLBACK;
