-- Pure-SQL housekeeping (docs/ARCHITECTURE.md §8) and its pg_cron schedules.
--
-- The functions live in `internal`: nobody but their owner (the migration role, which also owns
-- the tables) may execute them. pg_cron runs jobs as the role that scheduled them. Every function
-- takes `p_now` so tests can pin the clock; cron calls them with the default now().

-- Text form of a wrong answer for item_stats.top_wrong_answers.
CREATE OR REPLACE FUNCTION internal.answer_text(response jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT left(
    CASE response ->> 'kind'
      WHEN 'text' THEN response ->> 'value'
      WHEN 'audio' THEN response ->> 'transcript'
      WHEN 'choice' THEN 'choice:' || (response ->> 'value')
      WHEN 'tiles' THEN (
        SELECT string_agg(t.value, ' ' ORDER BY t.ord)
        FROM jsonb_array_elements_text(response -> 'value') WITH ORDINALITY AS t (value, ord)
      )
      WHEN 'pairs' THEN 'pairs:' || (response -> 'value')::text
      ELSE response ->> 'kind'
    END,
    200)
$$;

-- Merges two [{answer, count}] lists, summing counts, keeping the top n (count desc, answer asc).
CREATE OR REPLACE FUNCTION internal.merge_top_answers(a jsonb, b jsonb, n integer) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('answer', y.answer, 'count', y.total) ORDER BY y.total DESC, y.answer), '[]'::jsonb)
  FROM (
    SELECT x.answer, sum(x.cnt)::integer AS total
    FROM (
      SELECT e ->> 'answer' AS answer, (e ->> 'count')::integer AS cnt FROM jsonb_array_elements(coalesce(a, '[]'::jsonb)) AS e
      UNION ALL
      SELECT e ->> 'answer', (e ->> 'count')::integer FROM jsonb_array_elements(coalesce(b, '[]'::jsonb)) AS e
    ) AS x
    WHERE x.answer IS NOT NULL
    GROUP BY x.answer
    ORDER BY total DESC, x.answer
    LIMIT n
  ) AS y
$$;

-- Folds not-yet-rolled-up answers into item_stats (one row per item × content version) and marks
-- them rolled up. Incremental, so pruning old answers never loses statistics. Skipped answers are
-- not attempts. Returns the number of answers rolled up.
CREATE OR REPLACE FUNCTION internal.rollup_item_stats(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  n integer;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.rollup_batch (
    item_refs text[], content_version integer, verdict text, response jsonb
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.rollup_batch;

  WITH marked AS (
    UPDATE public.session_answers
    SET rolled_up = true
    WHERE NOT rolled_up AND created_at <= p_now
    RETURNING item_refs, content_version, verdict, response
  )
  INSERT INTO pg_temp.rollup_batch SELECT * FROM marked;
  GET DIAGNOSTICS n = ROW_COUNT;

  WITH per_item AS (
    SELECT r.item_ref, b.content_version, b.verdict, b.response
    FROM pg_temp.rollup_batch b
    CROSS JOIN LATERAL unnest(b.item_refs) AS r (item_ref)
    WHERE b.verdict <> 'skipped'
  ),
  agg AS (
    SELECT item_ref, content_version,
           count(*)::integer AS attempts,
           (count(*) FILTER (WHERE verdict = 'wrong'))::integer AS wrong
    FROM per_item
    GROUP BY item_ref, content_version
  ),
  wrong_counts AS (
    SELECT item_ref, content_version, internal.answer_text(response) AS answer, count(*)::integer AS cnt
    FROM per_item
    WHERE verdict = 'wrong'
    GROUP BY 1, 2, 3
  ),
  wrong_lists AS (
    SELECT item_ref, content_version,
           internal.merge_top_answers(
             jsonb_agg(jsonb_build_object('answer', answer, 'count', cnt)), '[]'::jsonb, 10) AS answers
    FROM wrong_counts
    GROUP BY item_ref, content_version
  )
  INSERT INTO public.item_stats AS s (item_ref, content_version, attempts, wrong, error_rate, top_wrong_answers, updated_at)
  SELECT a.item_ref, a.content_version, a.attempts, a.wrong,
         a.wrong::double precision / a.attempts,
         coalesce(w.answers, '[]'::jsonb), p_now
  FROM agg a
  LEFT JOIN wrong_lists w USING (item_ref, content_version)
  ON CONFLICT (item_ref, content_version) DO UPDATE SET
    attempts = s.attempts + EXCLUDED.attempts,
    wrong = s.wrong + EXCLUDED.wrong,
    error_rate = (s.wrong + EXCLUDED.wrong)::double precision / (s.attempts + EXCLUDED.attempts),
    top_wrong_answers = internal.merge_top_answers(s.top_wrong_answers, EXCLUDED.top_wrong_answers, 10),
    updated_at = EXCLUDED.updated_at;

  RETURN n;
END
$$;

-- Deletes answers older than 90 days (rolling them up first, so nothing is lost). Returns the
-- number of deleted rows.
CREATE OR REPLACE FUNCTION internal.prune_session_answers(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  n integer;
BEGIN
  PERFORM internal.rollup_item_stats(p_now);
  DELETE FROM public.session_answers WHERE created_at < p_now - interval '90 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- Marks started sessions past their TTL as expired. Returns the number of sessions expired.
CREATE OR REPLACE FUNCTION internal.expire_stale_sessions(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.sessions SET status = 'expired' WHERE status = 'started' AND expires_at < p_now;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- Token buckets refill completely within a minute, so buckets idle for an hour are just full ones.
CREATE OR REPLACE FUNCTION internal.prune_rate_limits(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.rate_limits WHERE updated_at < p_now - interval '1 hour';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- Stripe retries webhooks for up to 3 days; 30 days of de-duplication keys is plenty.
CREATE OR REPLACE FUNCTION internal.prune_webhook_events(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.webhook_events WHERE received_at < p_now - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

REVOKE ALL ON FUNCTION internal.answer_text(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION internal.merge_top_answers(jsonb, jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION internal.rollup_item_stats(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION internal.prune_session_answers(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION internal.expire_stale_sessions(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION internal.prune_rate_limits(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION internal.prune_webhook_events(timestamptz) FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------
-- Schedules (UTC). pg_cron exists only in the database named by cron.database_name (Supabase:
-- `postgres`; local: `zaboon`), so test clones and other databases skip this block.
-- cron.schedule(name, …) upserts by name, so re-running is harmless.
-- ---------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('zaboon-expire-stale-sessions', '*/15 * * * *', 'SELECT internal.expire_stale_sessions()');
    PERFORM cron.schedule('zaboon-rollup-item-stats', '10 3 * * *', 'SELECT internal.rollup_item_stats()');
    PERFORM cron.schedule('zaboon-prune-session-answers', '40 3 * * *', 'SELECT internal.prune_session_answers()');
    PERFORM cron.schedule('zaboon-prune-rate-limits', '20 * * * *', 'SELECT internal.prune_rate_limits()');
    PERFORM cron.schedule('zaboon-prune-webhook-events', '50 3 * * *', 'SELECT internal.prune_webhook_events()');
  END IF;
END
$$;
