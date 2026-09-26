/**
 * Pure mappers from the GET /api/path read model to what the path screen draws: node icon types,
 * node states, labels, popover copy and lesson links. No React here, so they are unit tested.
 */
import type { PathResponse } from '@zaboon/contracts'
import { BRAND_NAMES, type BrandName, type PathNodeType } from '@zaboon/ui'
import { lessonHref, type PlayerKind } from '@/lib/lesson/request'

export type PathSection = PathResponse['sections'][number]
export type PathUnitData = PathSection['units'][number]
export type PathLevelData = PathUnitData['levels'][number]
/** The API's level states; `available` has no kit look of its own (drawn by the path screen). */
export type LevelState = PathLevelData['state']

const NODE_TYPES: Record<string, PathNodeType> = {
  lesson: 'lesson',
  unit_review: 'review',
  practice: 'practice',
  chest: 'chest',
  story: 'story',
}

/** The kit's node icon for a level `kind`; unknown kinds fall back to the lesson star. */
export function nodeType(kind: string): PathNodeType {
  return Object.hasOwn(NODE_TYPES, kind) ? NODE_TYPES[kind]! : 'lesson'
}

const KIND_LABELS: Record<string, string> = {
  lesson: 'Lesson',
  unit_review: 'Unit review',
  practice: 'Practice',
  chest: 'Reward chest',
  story: 'Story',
}

export function kindLabel(kind: string): string {
  return Object.hasOwn(KIND_LABELS, kind) ? KIND_LABELS[kind]! : 'Lesson'
}

/** The learner's feature flags (HomeResponse.flags); absent = every P2 feature off. */
export type PathFlags = Readonly<Record<string, boolean>> | undefined

/**
 * The player kind a path level starts, or null when it has nothing to play (chest; a story while
 * flags.stories is off).
 */
export function playerKind(
  kind: string,
  flags?: PathFlags,
): Extract<PlayerKind, 'lesson' | 'unit_review' | 'practice' | 'story'> | null {
  if (kind === 'lesson' || kind === 'unit_review' || kind === 'practice') return kind
  if (kind === 'story' && flags?.stories === true) return kind
  return null
}

/** The popover title: the level's own title, else its kind ("Unit review"). */
export function levelTitle(level: Pick<PathLevelData, 'kind' | 'title'>): string {
  return level.title?.trim() || kindLabel(level.kind)
}

/** Accessible node name, e.g. "Lesson: First steps" (the kit appends state and progress). */
export function nodeLabel(level: Pick<PathLevelData, 'kind' | 'title'>): string {
  const kind = kindLabel(level.kind)
  const title = level.title?.trim()
  return title && title !== kind ? `${kind}: ${title}` : kind
}

/** 0..1 for the current node's progress ring. */
export function levelProgress(level: Pick<PathLevelData, 'lessonsDone' | 'lessonsTotal'>): number {
  if (level.lessonsTotal <= 0) return 0
  return Math.min(1, Math.max(0, level.lessonsDone / level.lessonsTotal))
}

/** "Lesson x of y": the lesson a START plays (completed levels show y of y). */
export function lessonCounter(
  level: Pick<PathLevelData, 'lessonsDone' | 'lessonsTotal' | 'state'>,
): string | null {
  const total = level.lessonsTotal
  if (total <= 0) return null
  const done = level.state === 'completed' || level.state === 'legendary'
  const x = done ? total : Math.min(total, Math.max(0, level.lessonsDone) + 1)
  return `Lesson ${x} of ${total}`
}

export type PopoverAction =
  | { type: 'start'; label: string; href: string }
  | { type: 'locked'; message: string }
  | { type: 'unavailable'; message: string }

export const LOCKED_MESSAGE = 'Complete the levels above to unlock this'

/** What the level popover offers: START / replay, the locked note, or nothing to play yet. */
export function popoverAction(
  courseId: string,
  level: PathLevelData,
  flags?: PathFlags,
): PopoverAction {
  if (level.state === 'locked') return { type: 'locked', message: LOCKED_MESSAGE }
  const kind = playerKind(level.kind, flags)
  if (!kind) return { type: 'unavailable', message: 'Coming soon: nothing to play here yet.' }
  const href = lessonHref({ courseId, kind, levelId: level.id })
  const replay = level.state === 'completed' || level.state === 'legendary'
  return { type: 'start', label: replay ? 'Replay' : 'Start', href }
}

/** Palette colors the banner accepts (the API's `color` is a PaletteColor). */
export function unitBrand(color: string): BrandName {
  return (BRAND_NAMES as readonly string[]).includes(color) ? (color as BrandName) : 'firouzeh'
}

export interface UnitPosition {
  sectionNumber: number
  unitNumber: number
  /** Index of the unit across the whole path (for character rotation). */
  pathIndex: number
}

/** "Section N, Unit M" numbering: both 1-based, units counted within their section. */
export function unitPositions(path: PathResponse): Map<string, UnitPosition> {
  const out = new Map<string, UnitPosition>()
  let n = 0
  path.sections.forEach((s, si) => {
    s.units.forEach((u, ui) => {
      out.set(u.id, { sectionNumber: si + 1, unitNumber: ui + 1, pathIndex: n++ })
    })
  })
  return out
}

/** The current level's id, if any. */
export function currentLevelId(path: PathResponse): string | null {
  for (const s of path.sections)
    for (const u of s.units) for (const l of u.levels) if (l.state === 'current') return l.id
  return null
}
