# @zaboon/db

Typed Postgres access for route handlers (ADR 0002, ADR 0009): `withUser` / `withUserLock` /
`withSystem`, the Drizzle `schema` and the `repos.*` repositories. The SQL in
`supabase/migrations` is the source of truth; `drift.db.test.ts` keeps `schema.ts` in sync and
`supabase/tests/*.sql` (pgTAP, run by `pgtap.db.test.ts`) proves the RLS and grant rules.

## Deploy checks

After `supabase db push` to a project, run in the SQL editor:

```sql
SELECT jobname, schedule, command, active FROM cron.job WHERE jobname LIKE 'zaboon-%' ORDER BY jobname;
```

Expect five active jobs: `zaboon-expire-stale-sessions`, `zaboon-prune-rate-limits`,
`zaboon-prune-session-answers`, `zaboon-prune-webhook-events`, `zaboon-rollup-item-stats`.
If none are listed, the push log contains a `WARNING: zaboon: …` line from
`20260925000600_pg_cron_schedules.sql` explaining why (pg_cron unavailable, wrong database, or
not permitted); enable pg_cron under Database → Extensions and re-run that migration's block.
