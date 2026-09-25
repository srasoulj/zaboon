-- Housekeeping schedules, for real (docs/ARCHITECTURE.md §8).
--
-- 20260925000400_housekeeping.sql only scheduled jobs when pg_cron was ALREADY installed, which is
-- true locally (the shim creates it) but not on a fresh Supabase project, where the jobs were
-- silently skipped. This migration installs pg_cron when it is available and this database is the
-- cron database (`cron.database_name`, `postgres` on Supabase), then (re)schedules every job
-- idempotently: unschedule by name, then schedule. Anywhere else it raises a WARNING and moves on
-- (e.g. per-test database clones, which cannot host pg_cron).
--
-- Deploy check (runbook): after `supabase db push`, in the SQL editor run
--   SELECT jobname, schedule, command, active FROM cron.job WHERE jobname LIKE 'zaboon-%' ORDER BY jobname;
-- and expect five active jobs: zaboon-expire-stale-sessions, zaboon-prune-rate-limits,
-- zaboon-prune-session-answers, zaboon-prune-webhook-events, zaboon-rollup-item-stats.
-- If it returns nothing, the migration log has a WARNING explaining why.

DO $$
DECLARE
  cron_db text;
  job record;
BEGIN
  -- cron.database_name is superuser-only for reading unless the role has pg_read_all_settings;
  -- when it can't be read, CREATE EXTENSION below still refuses outside the cron database.
  BEGIN
    cron_db := current_setting('cron.database_name', true);
  EXCEPTION WHEN insufficient_privilege THEN
    cron_db := NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE WARNING 'zaboon: pg_cron is not available on this server; housekeeping jobs are NOT scheduled';
    RETURN;
  END IF;
  IF cron_db IS NOT NULL AND cron_db <> current_database() THEN
    RAISE WARNING 'zaboon: pg_cron runs in database "%" (cron.database_name), not "%"; housekeeping jobs are NOT scheduled here',
      cron_db, current_database();
    RETURN;
  END IF;

  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'zaboon: could not install pg_cron (%: %); housekeeping jobs are NOT scheduled', SQLSTATE, SQLERRM;
    RETURN;
  END;

  FOR job IN
    SELECT * FROM (VALUES
      ('zaboon-expire-stale-sessions', '*/15 * * * *', 'SELECT internal.expire_stale_sessions()'),
      ('zaboon-rollup-item-stats', '10 3 * * *', 'SELECT internal.rollup_item_stats()'),
      ('zaboon-prune-session-answers', '40 3 * * *', 'SELECT internal.prune_session_answers()'),
      ('zaboon-prune-rate-limits', '20 * * * *', 'SELECT internal.prune_rate_limits()'),
      ('zaboon-prune-webhook-events', '50 3 * * *', 'SELECT internal.prune_webhook_events()')
    ) AS j (name, schedule, command)
  LOOP
    PERFORM cron.unschedule(c.jobid) FROM cron.job c WHERE c.jobname = job.name AND c.username = current_user;
    PERFORM cron.schedule(job.name, job.schedule, job.command);
  END LOOP;
END
$$;
