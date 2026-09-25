/**
 * The learning path: level states (locked | available | current | completed | legendary) and lazy
 * path migrations between content versions (ARCHITECTURE §3.1 rule 3, §10.4).
 *
 * State rules:
 * - a level with `completed_at` is `completed` (or `legendary`), and stays replayable;
 * - the first unfinished *playable* level is `current`; every unfinished level after it is `locked`;
 * - levels with no MVP session (story, chest) never block the path: before `current` they are
 *   `available`, after it `locked`.
 * The letters track follows the same rules on its own (every letter lesson is playable).
 */
import type { LevelState, PathResponse } from '@zaboon/contracts'
import type { Manifest, PathMigration } from '@zaboon/content-schema'
import { repos, type Tx } from '@zaboon/db'
import type { z } from 'zod'
import type { LoadedBundle } from './content'

type LevelProgress = repos.learning.LevelProgress
type State = z.infer<typeof LevelState>

/** Level kinds that have an MVP session (`POST /api/sessions`). */
const PLAYABLE_KINDS: ReadonlySet<string> = new Set(['lesson', 'practice', 'unit_review'])

export interface PathLevel {
  id: string
  kind: string
  title?: string | undefined
  lessonsTotal: number
  /** Index into LoadedBundle.units. */
  unitIndex: number
}

export interface LevelStatus {
  state: State
  lessonsDone: number
}

/** Every path level in order (sections → units → levels). */
export function pathLevels(bundle: LoadedBundle): PathLevel[] {
  return bundle.units.flatMap((u, unitIndex) =>
    u.unit.levels.map((l) => ({
      id: l.id,
      kind: l.kind,
      title: l.title,
      lessonsTotal: l.lessons,
      unitIndex,
    })),
  )
}

/** States for an ordered list of levels given the learner's progress rows. */
export function levelStates(
  levels: readonly { id: string; kind: string; lessonsTotal: number }[],
  progress: ReadonlyMap<string, LevelProgress>,
  playable: (kind: string) => boolean = (k) => PLAYABLE_KINDS.has(k),
): Map<string, LevelStatus> {
  const out = new Map<string, LevelStatus>()
  let seenCurrent = false
  for (const l of levels) {
    const p = progress.get(l.id)
    const lessonsDone = Math.min(p?.lessonsDone ?? 0, l.lessonsTotal)
    let state: State
    if (p?.completedAt) state = p.legendary ? 'legendary' : 'completed'
    else if (seenCurrent) state = 'locked'
    else if (playable(l.kind)) {
      state = 'current'
      seenCurrent = true
    } else state = 'available'
    out.set(l.id, { state, lessonsDone })
  }
  return out
}

export function currentOf(states: ReadonlyMap<string, LevelStatus>): string | null {
  for (const [id, s] of states) if (s.state === 'current') return id
  return null
}

export function progressMap(rows: readonly LevelProgress[]): Map<string, LevelProgress> {
  return new Map(rows.map((r) => [r.levelId, r]))
}

/** Path states for the learner (course path only). */
export async function pathStates(
  tx: Tx,
  userId: string,
  bundle: LoadedBundle,
): Promise<{ levels: PathLevel[]; states: Map<string, LevelStatus> }> {
  const progress = progressMap(await repos.learning.listLevelProgress(tx, userId, bundle.courseId))
  const levels = pathLevels(bundle)
  return { levels, states: levelStates(levels, progress) }
}

/** Letters-track lesson states (every letter lesson is playable). */
export function letterLessonStates(
  bundle: LoadedBundle,
  progress: ReadonlyMap<string, LevelProgress>,
): Map<string, LevelStatus> {
  const lessons = bundle.letters.track.lessons.map((l) => ({
    id: l.id,
    kind: 'letters',
    lessonsTotal: 1,
  }))
  return levelStates(lessons, progress, () => true)
}

/** GET /api/path read model. */
export function pathResponse(
  bundle: LoadedBundle,
  states: ReadonlyMap<string, LevelStatus>,
): PathResponse {
  return {
    courseId: bundle.courseId,
    contentVersion: bundle.version,
    sections: bundle.manifest.sections.map((s) => ({
      id: s.id,
      title: s.title,
      cefr: s.cefr,
      units: s.units.map((u) => ({
        id: u.id,
        title: u.title,
        ...(u.subtitle ? { subtitle: u.subtitle } : {}),
        color: u.color,
        hasGuidebook: u.hasGuidebook,
        levels: u.levels.map((l) => {
          const st = states.get(l.id) ?? { state: 'locked' as const, lessonsDone: 0 }
          return {
            id: l.id,
            kind: l.kind,
            ...(l.title ? { title: l.title } : {}),
            lessonsTotal: l.lessons,
            lessonsDone: st.lessonsDone,
            state: st.state,
          }
        }),
      })),
    })),
  }
}

// ---------------------------------------------------------------------------------------------
// Lazy path migrations
// ---------------------------------------------------------------------------------------------
/**
 * The migration steps from content version `from` to `to`, in order. Each step starts where the
 * previous one ended; versions without a migration are skipped (their level ids did not change).
 */
export function migrationSteps(manifest: Manifest, from: number, to: number): PathMigration[] {
  const steps: PathMigration[] = []
  let v = from
  while (v < to) {
    const next = manifest.pathMigrations
      .filter((m) => m.from === v && m.to > v && m.to <= to)
      .sort((a, b) => b.to - a.to)[0]
    if (next) {
      steps.push(next)
      v = next.to
    } else v++
  }
  return steps
}

/** Maps a level id through migration steps; null when a step removed the level. */
export function migrateLevelId(steps: readonly PathMigration[], levelId: string): string | null {
  let id: string | null = levelId
  for (const s of steps) {
    if (id === null) return null
    if (Object.hasOwn(s.levels, id)) id = s.levels[id] ?? null
  }
  return id
}

/**
 * Brings the learner's enrollment in `bundle`'s course up to `bundle.version`: level_progress rows
 * are copied to their new level ids (merging with any progress already there), removed levels'
 * progress is dropped from the path, and the enrollment's version and current level are updated.
 * Level ids are never reused across versions, so rows left under old ids are inert.
 * No-op for a learner without an enrollment or already at the version. Run under withUserLock.
 */
export async function migrateEnrollment(
  tx: Tx,
  userId: string,
  bundle: LoadedBundle,
): Promise<repos.enrollments.Enrollment | null> {
  const enrollment = await repos.enrollments.getEnrollment(tx, userId, bundle.courseId)
  if (!enrollment || enrollment.contentVersion >= bundle.version) return enrollment
  const steps = migrationSteps(bundle.manifest, enrollment.contentVersion, bundle.version)
  if (steps.length > 0) {
    for (const row of await repos.learning.listLevelProgress(tx, userId, bundle.courseId)) {
      const to = migrateLevelId(steps, row.levelId)
      if (to === null || to === row.levelId) continue
      const at = row.completedAt ?? row.updatedAt
      await repos.learning.setLevelProgress(tx, userId, {
        courseId: bundle.courseId,
        levelId: to,
        lessonsDone: row.lessonsDone,
        completed: row.completedAt !== null,
        at,
      })
      if (row.legendary)
        await repos.learning.setLegendary(tx, userId, {
          courseId: bundle.courseId,
          levelId: to,
          at,
        })
    }
  }
  const { states } = await pathStates(tx, userId, bundle)
  return repos.enrollments.updateEnrollment(tx, userId, bundle.courseId, {
    contentVersion: bundle.version,
    currentLevelId: currentOf(states),
  })
}
