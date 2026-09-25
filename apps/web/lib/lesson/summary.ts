/**
 * What the lesson-complete screens show. Online it comes from the server's SessionResult; offline
 * it's an optimistic local estimate from the same game rules (ARCHITECTURE §3.1: the client runs
 * the rules for display only), replaced by the server's numbers once the outbox delivers.
 */
import {
  DEFAULT_APP_CONFIG,
  type AppConfig,
  type SessionKind,
  type SessionResult,
  type StreakView,
} from '@zaboon/contracts'
import { dailyGoalStep, sessionXp } from '@zaboon/game-rules'
import { firstTryAccuracy, wrongAttempts, type Progress } from './progress'

export interface CompleteSummary {
  source: 'server' | 'local'
  xp: number
  perfect: boolean
  /** 0..1 */
  accuracy: number
  durationMs: number
  streak: { days: number; extendedToday: boolean }
  dailyGoal: { xp: number; goal: number; justMet: boolean }
}

export function summaryFromResult(result: SessionResult): CompleteSummary {
  return {
    source: 'server',
    xp: result.xp.total,
    perfect: result.perfect,
    accuracy: result.accuracy,
    durationMs: result.durationMs,
    streak: { days: result.streak.current, extendedToday: result.streak.extendedToday },
    dailyGoal: {
      xp: result.dailyGoal.xp,
      goal: result.dailyGoal.goal,
      justMet: result.dailyGoal.justMet,
    },
  }
}

/** The learner's state before the lesson (from GET /api/home), when known. */
export interface HomeBefore {
  streak: StreakView
  dailyGoal: { xp: number; goal: number; met: boolean }
}

export function localSummary(input: {
  kind: SessionKind
  progress: Progress
  durationMs: number
  home: HomeBefore | null
  config?: AppConfig
}): CompleteSummary {
  const cfg = input.config ?? DEFAULT_APP_CONFIG
  const xp = sessionXp(input.kind, wrongAttempts(input.progress), cfg)
  const before = input.home
  const alreadyToday = before?.streak.status === 'extended'
  const goal = dailyGoalStep(
    before?.dailyGoal.xp ?? 0,
    xp.total,
    before?.dailyGoal.goal ?? cfg.dailyGoal.default,
  )
  return {
    source: 'local',
    xp: xp.total,
    perfect: xp.perfect,
    accuracy: firstTryAccuracy(input.progress),
    durationMs: Math.max(0, Math.round(input.durationMs)),
    streak: { days: streakDaysAfter(before?.streak ?? null), extendedToday: !alreadyToday },
    dailyGoal: { xp: goal.dayXp, goal: goal.goal, justMet: goal.justMet && !(before?.dailyGoal.met ?? false) },
  }
}

/** The streak after a completed lesson: unchanged if already extended today, restarted if broken. */
export function streakDaysAfter(before: StreakView | null): number {
  if (!before) return 1
  switch (before.status) {
    case 'extended':
      return Math.max(1, before.current)
    case 'broken':
    case 'none':
      return 1
    case 'at_risk':
    case 'frozen':
      return before.current + 1
  }
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
