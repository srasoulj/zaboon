/** Daily quests (P2, flags.quests): the day's quests as the API shows them. */
import type { AppConfig, QuestDto } from '@zaboon/contracts'
import { repos, type Tx } from '@zaboon/db'
import { dailyQuests, type DailyQuest, type QuestDef, type QuestRow } from '@zaboon/game-rules'

/** The learner's quests for a local date (game-rules `dailyQuests`), with quest_defs ids. */
export function questsOfDay(userId: string, date: string, cfg: AppConfig): DailyQuest[] {
  return dailyQuests(userId, date, cfg)
}

export const questDefs = (daily: readonly DailyQuest[]): QuestDef[] =>
  daily.map((q) => ({ id: q.templateId, metric: q.metric, target: q.target }))

/** The day's quests with their stored progress (a quest without a row has made no progress yet). */
export function questDtos(
  daily: readonly DailyQuest[],
  rows: readonly QuestRow[],
  cfg: AppConfig,
): QuestDto[] {
  return daily.map((q) => {
    const progress = Math.min(q.target, rows.find((r) => r.questId === q.templateId)?.progress ?? 0)
    return {
      id: q.templateId,
      metric: q.metric,
      title: q.title,
      target: q.target,
      progress,
      completed: progress >= q.target,
      reward: cfg.quests.rewardCoins,
    }
  })
}

/** Today's quests of the learner (reads only). */
export async function readQuests(
  tx: Tx,
  userId: string,
  date: string,
  cfg: AppConfig,
): Promise<QuestDto[]> {
  const daily = questsOfDay(userId, date, cfg)
  return questDtos(daily, await repos.quests.listUserQuests(tx, userId, date), cfg)
}
