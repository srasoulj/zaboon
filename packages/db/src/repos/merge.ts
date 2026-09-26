/**
 * Guest → member account merge (§10.3, POST /api/account/merge). System scope: it reads and writes
 * two users' rows. The route verifies both JWTs (the guest must be anonymous) before calling this,
 * and deletes the guest's auth user afterwards through the Auth Admin API.
 *
 * Rules:
 * - sessions move to the member, and with them (composite FK, ON UPDATE CASCADE) their events,
 *   answers, session-linked XP entries and reports;
 * - XP entries without a session are copied, so the member's ledger sums both histories;
 * - daily_activity is unioned day by day (XP and sessions add up; a freeze only stays "used" on a
 *   day with no sessions on either side);
 * - FSRS cards: the stronger card wins (higher stability, then more reps); exposures take the max;
 * - enrollments: XP adds up, newest content version, the member's current level unless unset;
 * - level_progress: most lessons done, legendary if either, earliest completion;
 * - mistakes and items add up; coin_ledger rows are copied unless the member already has the same
 *   (reason, ref) (or purchaseId), plus one balancing `merge` row for what was skipped, so the
 *   wallet gains exactly the guest's net coins and still equals the ledger sum;
 * - the member's lives, consents and league tier win;
 * - streaks: every field takes the max. The caller should then recompute the streak from the merged
 *   daily_activity with @zaboon/game-rules (the one implementation of streak math) and save it.
 * - finally the guest's profile is deleted, cascading to whatever was not moved.
 */
import { sql, type SQL } from 'drizzle-orm'
import type { Tx } from '../index'
import { assertSystemScope, assertUserId } from './shared'

export interface MergeSummary {
  merged: boolean
  sessionsMoved: number
  xpMoved: number
  daysMerged: number
}

export async function mergeGuestIntoMember(
  tx: Tx,
  input: { guestId: string; memberId: string },
): Promise<MergeSummary> {
  await assertSystemScope(tx)
  const { guestId: g, memberId: m } = input
  assertUserId(g)
  assertUserId(m)
  if (g === m) throw new Error('cannot merge a user into themselves')

  // Same lock key as withUserLock, taken in a fixed order so two merges can't deadlock.
  for (const id of [g, m].sort()) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`)
  }

  const run = (q: SQL) => tx.execute(q)
  const count = async (q: SQL): Promise<number> => {
    const rows = await tx.execute<{ n: number }>(q)
    return Number(rows[0]?.n ?? 0)
  }

  if (
    (await count(sql`SELECT count(*)::int AS n FROM public.profiles WHERE user_id = ${g}`)) === 0
  ) {
    return { merged: false, sessionsMoved: 0, xpMoved: 0, daysMerged: 0 }
  }
  await run(sql`INSERT INTO public.profiles (user_id) VALUES (${m}) ON CONFLICT DO NOTHING`)
  await run(sql`INSERT INTO public.public_profiles (user_id) VALUES (${m}) ON CONFLICT DO NOTHING`)

  const xpMoved = await count(
    sql`SELECT coalesce(sum(amount), 0)::int AS n FROM public.xp_ledger WHERE user_id = ${g}`,
  )
  const daysMerged = await count(
    sql`SELECT count(*)::int AS n FROM public.daily_activity WHERE user_id = ${g}`,
  )

  // Sessions (+ events, answers, session XP, session reports via ON UPDATE CASCADE).
  const sessionsMoved = await count(sql`
    WITH moved AS (UPDATE public.sessions SET user_id = ${m} WHERE user_id = ${g} RETURNING 1)
    SELECT count(*)::int AS n FROM moved`)

  // XP entries without a session (the ledger is append-only, so copy rather than move).
  await run(sql`
    INSERT INTO public.xp_ledger (user_id, amount, reason, session_id, occurred_at, local_date)
    SELECT ${m}, amount, reason, NULL, occurred_at, local_date
    FROM public.xp_ledger WHERE user_id = ${g} AND session_id IS NULL
    ORDER BY id`)

  await run(sql`
    INSERT INTO public.daily_activity AS d (user_id, local_date, xp, sessions, goal_met, freeze_used)
    SELECT ${m}, local_date, xp, sessions, goal_met, freeze_used FROM public.daily_activity WHERE user_id = ${g}
    ON CONFLICT (user_id, local_date) DO UPDATE SET
      xp = d.xp + excluded.xp,
      sessions = d.sessions + excluded.sessions,
      goal_met = d.goal_met OR excluded.goal_met,
      freeze_used = (d.freeze_used OR excluded.freeze_used) AND d.sessions + excluded.sessions = 0`)

  await run(sql`
    INSERT INTO public.streaks AS s (user_id, current, longest, last_active_date, freezes)
    SELECT ${m}, current, longest, last_active_date, freezes FROM public.streaks WHERE user_id = ${g}
    ON CONFLICT (user_id) DO UPDATE SET
      current = greatest(s.current, excluded.current),
      longest = greatest(s.longest, excluded.longest),
      last_active_date = greatest(s.last_active_date, excluded.last_active_date),
      freezes = greatest(s.freezes, excluded.freezes),
      updated_at = now()`)

  await run(sql`
    INSERT INTO public.lives (user_id, policy, count, updated_at)
    SELECT ${m}, policy, count, updated_at FROM public.lives WHERE user_id = ${g}
    ON CONFLICT (user_id) DO NOTHING`)

  await run(sql`
    INSERT INTO public.enrollments AS e (user_id, course_id, current_level_id, xp_total, content_version)
    SELECT ${m}, course_id, current_level_id, xp_total, content_version FROM public.enrollments WHERE user_id = ${g}
    ON CONFLICT (user_id, course_id) DO UPDATE SET
      xp_total = e.xp_total + excluded.xp_total,
      content_version = greatest(e.content_version, excluded.content_version),
      current_level_id = coalesce(e.current_level_id, excluded.current_level_id),
      updated_at = now()`)

  await run(sql`
    INSERT INTO public.level_progress AS l (user_id, course_id, level_id, lessons_done, legendary, completed_at, updated_at)
    SELECT ${m}, course_id, level_id, lessons_done, legendary, completed_at, updated_at
    FROM public.level_progress WHERE user_id = ${g}
    ON CONFLICT (user_id, course_id, level_id) DO UPDATE SET
      lessons_done = greatest(l.lessons_done, excluded.lessons_done),
      legendary = l.legendary OR excluded.legendary,
      completed_at = least(l.completed_at, excluded.completed_at),
      updated_at = greatest(l.updated_at, excluded.updated_at)`)

  for (const [table, key] of [
    ['lexeme_memory', 'lexeme_id'],
    ['letter_memory', 'letter_id'],
  ] as const) {
    const t = sql.identifier(table)
    const k = sql.identifier(key)
    await run(sql`
      INSERT INTO public.${t} AS c (user_id, ${k}, due, stability, difficulty, elapsed_days, scheduled_days,
                                    learning_steps, reps, lapses, state, last_review, exposures, updated_at)
      SELECT ${m}, ${k}, due, stability, difficulty, elapsed_days, scheduled_days,
             learning_steps, reps, lapses, state, last_review, exposures, updated_at
      FROM public.${t} WHERE user_id = ${g}
      ON CONFLICT (user_id, ${k}) DO UPDATE SET
        due = excluded.due, stability = excluded.stability, difficulty = excluded.difficulty,
        elapsed_days = excluded.elapsed_days, scheduled_days = excluded.scheduled_days,
        learning_steps = excluded.learning_steps, reps = excluded.reps, lapses = excluded.lapses,
        state = excluded.state, last_review = excluded.last_review,
        exposures = greatest(c.exposures, excluded.exposures), updated_at = now()
      WHERE excluded.stability > c.stability OR (excluded.stability = c.stability AND excluded.reps > c.reps)`)
    await run(sql`
      UPDATE public.${t} AS c SET exposures = gc.exposures
      FROM public.${t} AS gc
      WHERE c.user_id = ${m} AND gc.user_id = ${g} AND gc.${k} = c.${k} AND gc.exposures > c.exposures`)
  }

  await run(sql`
    INSERT INTO public.mistakes AS x (user_id, item_ref, times_wrong, last_wrong_at, resolved_at)
    SELECT ${m}, item_ref, times_wrong, last_wrong_at, resolved_at FROM public.mistakes WHERE user_id = ${g}
    ON CONFLICT (user_id, item_ref) DO UPDATE SET
      times_wrong = x.times_wrong + excluded.times_wrong,
      last_wrong_at = greatest(x.last_wrong_at, excluded.last_wrong_at),
      resolved_at = CASE WHEN x.resolved_at IS NULL OR excluded.resolved_at IS NULL THEN NULL
                         ELSE greatest(x.resolved_at, excluded.resolved_at) END`)

  await run(sql`
    INSERT INTO public.user_items AS i (user_id, item, qty)
    SELECT ${m}, item, qty FROM public.user_items WHERE user_id = ${g}
    ON CONFLICT (user_id, item) DO UPDATE SET qty = i.qty + excluded.qty, updated_at = now()`)

  await run(sql`
    INSERT INTO public.consents (user_id, kind, granted, updated_at)
    SELECT ${m}, kind, granted, updated_at FROM public.consents WHERE user_id = ${g}
    ON CONFLICT (user_id, kind) DO NOTHING`)

  // Reports not tied to a session (session-linked ones moved with their session).
  await run(sql`UPDATE public.reports SET user_id = ${m} WHERE user_id = ${g}`)

  // P2 state.
  // Coins: copy the guest's ledger; entries the member already has (same reason + ref, e.g. a quest
  // both claimed) are skipped. The guest's net coins (their ledger sum, never negative) are never
  // lost: whatever the skipped rows held comes back as one balancing `merge` row, so the member's
  // wallet gains exactly the guest's net and still equals the member's ledger sum.
  const guestNet = await count(
    sql`SELECT coalesce(sum(amount), 0)::int AS n FROM public.coin_ledger WHERE user_id = ${g}`,
  )
  const coinsMoved = await count(sql`
    WITH copied AS (
      INSERT INTO public.coin_ledger (user_id, amount, reason, ref, created_at)
      SELECT ${m}, amount, reason, ref, created_at FROM public.coin_ledger WHERE user_id = ${g}
      ORDER BY id
      ON CONFLICT DO NOTHING
      RETURNING amount
    )
    SELECT coalesce(sum(amount), 0)::int AS n FROM copied`)
  if (guestNet !== coinsMoved)
    await run(sql`
      INSERT INTO public.coin_ledger (user_id, amount, reason, ref)
      VALUES (${m}, ${guestNet - coinsMoved}::int, 'merge', ${g}::text)
      ON CONFLICT DO NOTHING`)
  await run(sql`
    INSERT INTO public.wallet AS w (user_id, coins)
    SELECT ${m}, ${guestNet}::int
    WHERE ${guestNet}::int <> 0 OR EXISTS (SELECT 1 FROM public.wallet WHERE user_id = ${g})
    ON CONFLICT (user_id) DO UPDATE SET coins = w.coins + ${guestNet}::int, updated_at = now()`)
  await run(sql`
    INSERT INTO public.entitlements AS en (user_id, entitlement, source, expires_at)
    SELECT ${m}, entitlement, source, expires_at FROM public.entitlements WHERE user_id = ${g}
    ON CONFLICT (user_id, entitlement) DO UPDATE SET
      expires_at = CASE WHEN en.expires_at IS NULL OR excluded.expires_at IS NULL THEN NULL
                        ELSE greatest(en.expires_at, excluded.expires_at) END,
      updated_at = now()`)
  await run(sql`
    INSERT INTO public.user_quests AS q (user_id, local_date, quest_id, progress, claimed)
    SELECT ${m}, local_date, quest_id, progress, claimed FROM public.user_quests WHERE user_id = ${g}
    ON CONFLICT (user_id, local_date, quest_id) DO UPDATE SET
      progress = greatest(q.progress, excluded.progress),
      claimed = q.claimed OR excluded.claimed,
      updated_at = now()`)
  await run(sql`
    INSERT INTO public.user_league (user_id, tier)
    SELECT ${m}, tier FROM public.user_league WHERE user_id = ${g}
    ON CONFLICT (user_id) DO NOTHING`)
  await run(sql`UPDATE public.push_subscriptions SET user_id = ${m} WHERE user_id = ${g}`)

  // Denormalized public stats.
  await run(sql`
    UPDATE public.public_profiles p SET
      xp_total = (SELECT coalesce(sum(amount), 0)::int FROM public.xp_ledger WHERE user_id = ${m}),
      streak_current = coalesce((SELECT current FROM public.streaks WHERE user_id = ${m}), 0),
      updated_at = now()
    WHERE p.user_id = ${m}`)

  // Everything else of the guest's goes with their profile.
  await run(sql`DELETE FROM public.profiles WHERE user_id = ${g}`)

  return { merged: true, sessionsMoved, xpMoved, daysMerged }
}
