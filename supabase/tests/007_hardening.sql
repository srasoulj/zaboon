-- Size caps (20260926100000_hardening.sql): item refs of at most 120 characters on every table
-- with an item_ref column, and stored answer responses of at most 8 KiB.
BEGIN;
SET LOCAL search_path = extensions, public;
SELECT plan(12);

INSERT INTO auth.users (id, is_anonymous) VALUES ('66666666-6666-4666-8666-666666666666', true);
INSERT INTO public.sessions (id, user_id, course_id, kind, content_version, seed, challenge_refs, tz, expires_at, grader_version)
  VALUES ('77777777-7777-4777-8777-777777777777', '66666666-6666-4666-8666-666666666666', 'fixture', 'lesson', 1,
          'x', '[]', 'UTC', now() + interval '1 day', 1);

-- ---------------------------------------------------------------------------------------------
-- item_ref: 120 characters fit, 121 do not
-- ---------------------------------------------------------------------------------------------
-- A table that adds an item_ref column must add the cap too.
SELECT is_empty(
  $$ SELECT c.table_name FROM information_schema.columns c
     JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'item_ref'
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint k
         WHERE k.conrelid = format('public.%I', c.table_name)::regclass AND k.contype = 'c'
           AND pg_get_constraintdef(k.oid) LIKE '%char_length(item_ref) <= 120%') $$,
  'every item_ref column is capped at 120 characters');

SELECT lives_ok(
  $$ INSERT INTO public.mistakes (user_id, item_ref, last_wrong_at)
     VALUES ('66666666-6666-4666-8666-666666666666', 'lexeme:' || repeat('a', 113), now()) $$,
  'mistakes: a 120-character item ref fits');
SELECT throws_ok(
  $$ INSERT INTO public.mistakes (user_id, item_ref, last_wrong_at)
     VALUES ('66666666-6666-4666-8666-666666666666', 'lexeme:' || repeat('b', 114), now()) $$,
  '23514', NULL, 'mistakes: a 121-character item ref is refused');

SELECT lives_ok(
  $$ INSERT INTO public.reports (user_id, item_ref, kind)
     VALUES ('66666666-6666-4666-8666-666666666666', 'lexeme:' || repeat('a', 113), 'other') $$,
  'reports: a 120-character item ref fits');
SELECT throws_ok(
  $$ INSERT INTO public.reports (user_id, item_ref, kind)
     VALUES ('66666666-6666-4666-8666-666666666666', 'lexeme:' || repeat('b', 114), 'other') $$,
  '23514', NULL, 'reports: a 121-character item ref is refused');

SELECT lives_ok(
  $$ INSERT INTO public.item_stats (item_ref, content_version) VALUES ('lexeme:' || repeat('a', 113), 1) $$,
  'item_stats: a 120-character item ref fits');
SELECT throws_ok(
  $$ INSERT INTO public.item_stats (item_ref, content_version) VALUES ('lexeme:' || repeat('b', 114), 1) $$,
  '23514', NULL, 'item_stats: a 121-character item ref is refused');

-- ---------------------------------------------------------------------------------------------
-- session_answers.response: at most 8 KiB, measured before compression
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.answer(seq int, response jsonb) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.session_answers (session_id, user_id, idx, attempt_seq, challenge_type, content_version, response, verdict, ms)
  VALUES ('77777777-7777-4777-8777-777777777777', '66666666-6666-4666-8666-666666666666', 0, seq, 'translate_type', 1,
          response, 'wrong', 900)
$$;

SELECT is(
  pg_column_size(jsonb_build_object('kind', 'text', 'value', repeat('x', 8155))), 8192,
  'the boundary response takes exactly 8192 bytes');
SELECT lives_ok(
  $$ SELECT pg_temp.answer(0, jsonb_build_object('kind', 'text', 'value', repeat('x', 8155))) $$,
  'a response of exactly 8 KiB fits');
SELECT throws_ok(
  $$ SELECT pg_temp.answer(1, jsonb_build_object('kind', 'text', 'value', repeat('x', 8156))) $$,
  '23514', NULL, 'a response of 8 KiB + 1 byte is refused, however well it would compress');
-- The largest response the contract accepts: MAX_TILES (40) tiles of MAX_TILE_LENGTH (64)
-- characters that take 3 bytes each in UTF-8.
SELECT lives_ok(
  $$ SELECT pg_temp.answer(2, jsonb_build_object('kind', 'tiles', 'value',
       (SELECT jsonb_agg(repeat('界', 64)) FROM generate_series(1, 40)))) $$,
  'the largest valid tiles response fits');
SELECT is(
  (SELECT count(*)::int FROM public.session_answers WHERE session_id = '77777777-7777-4777-8777-777777777777'),
  2, 'only the answers within the cap were stored');

SELECT * FROM finish();
ROLLBACK;
