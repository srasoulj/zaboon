/**
 * Daily quests (P2): `quest_defs` (seeded from @zaboon/game-rules QUEST_TEMPLATES) and each
 * learner's progress per local date in `user_quests`. Which quests a learner gets on a date and
 * how a session advances them are game rules (`dailyQuests`, `applyQuestProgress`).
 */
import { and, asc, eq } from 'drizzle-orm'
import type { Tx } from '../index'
import * as schema from '../schema'

export interface QuestDefRow {
  id: string
  template: string
  target: number
  reward: number
  active: boolean
}

export async function listQuestDefs(tx: Tx): Promise<QuestDefRow[]> {
  return tx.select().from(schema.questDefs).orderBy(asc(schema.questDefs.id))
}

export interface UserQuestRow {
  questId: string
  progress: number
  claimed: boolean
}

/** The learner's stored quest rows for one local date. */
export async function listUserQuests(
  tx: Tx,
  userId: string,
  localDate: string,
): Promise<UserQuestRow[]> {
  return tx
    .select({
      questId: schema.userQuests.questId,
      progress: schema.userQuests.progress,
      claimed: schema.userQuests.claimed,
    })
    .from(schema.userQuests)
    .where(and(eq(schema.userQuests.userId, userId), eq(schema.userQuests.localDate, localDate)))
    .orderBy(asc(schema.userQuests.questId))
}

/** Upserts the learner's quest rows for one local date (the commit's `applyQuestProgress` output). */
export async function saveUserQuests(
  tx: Tx,
  userId: string,
  localDate: string,
  rows: readonly UserQuestRow[],
  at: string,
): Promise<void> {
  for (const r of rows) {
    await tx
      .insert(schema.userQuests)
      .values({
        userId,
        localDate,
        questId: r.questId,
        progress: r.progress,
        claimed: r.claimed,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: [schema.userQuests.userId, schema.userQuests.localDate, schema.userQuests.questId],
        set: { progress: r.progress, claimed: r.claimed, updatedAt: at },
      })
  }
}
