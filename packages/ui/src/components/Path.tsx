'use client'
import clsx from 'clsx'
import { useId, type CSSProperties, type ReactNode } from 'react'
import { Icon, type IconName } from '../icons'
import { BRAND_NAMES, px, tokens, type BrandName } from '../tokens'
import { clamp01 } from './ProgressBar'

export type PathNodeType = 'lesson' | 'story' | 'practice' | 'chest' | 'review'
export type PathNodeState = 'locked' | 'current' | 'completed' | 'legendary'

const NODE_ICON: Record<PathNodeType, IconName> = {
  lesson: 'star',
  story: 'book',
  practice: 'dumbbell',
  chest: 'chest',
  review: 'trophy',
}

const STATE_TEXT: Record<PathNodeState, string> = {
  locked: 'locked',
  current: 'current',
  completed: 'completed',
  legendary: 'legendary',
}

/** Unit banner colors cycle through the palette (§3). Bādemjān is reserved for legendary. */
export const UNIT_COLORS: readonly BrandName[] = BRAND_NAMES.filter((b) => b !== 'bademjan')

export function unitColor(unitIndex: number): BrandName {
  const n = UNIT_COLORS.length
  return UNIT_COLORS[((unitIndex % n) + n) % n]!
}

/** Horizontal offset (px) of the i-th node in a unit, from `tokens.path.offsets` (§3). */
export function pathOffset(index: number): number {
  const o = tokens.path.offsets
  return o[((index % o.length) + o.length) % o.length]!
}

function brandVars(color: BrandName): CSSProperties {
  return {
    '--unit-fill': `var(--color-${color}-500)`,
    '--unit-lip': `var(--color-${color}-600)`,
    '--unit-label': `var(--color-${color}-label)`,
  } as CSSProperties
}

export interface PathNodeProps {
  type: PathNodeType
  state: PathNodeState
  /** Accessible name, e.g. "Lesson 3: Greetings". State and progress are appended. */
  label: string
  /** The unit color for completed/current nodes. */
  color?: BrandName
  /** 0..1 progress ring on the current node. */
  progress?: number
  startLabel?: string
  onClick?: () => void
  className?: string
}

const NODE = px(tokens.path.nodeSize)
const RING_GAP = 7
const RING_STROKE = 8
const RING_SIZE = NODE + 2 * (RING_GAP + RING_STROKE)
const RING_R = (RING_SIZE - RING_STROKE) / 2
const RING_C = 2 * Math.PI * RING_R

/** A 70px 3D path node. The current node gets a progress ring and a bouncing START bubble. */
export function PathNode({
  type,
  state,
  label,
  color = 'firouzeh',
  progress = 0,
  startLabel = 'Start',
  onClick,
  className,
}: PathNodeProps) {
  const p = clamp01(progress)
  const name = [
    label,
    STATE_TEXT[state],
    state === 'current' ? `${Math.round(p * 100)}% complete` : null,
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <div
      className={clsx('zb-node', `zb-node--${state}`, className)}
      style={brandVars(color)}
      data-state={state}
    >
      {state === 'current' && (
        <>
          <span className="zb-node__start" aria-hidden="true">
            {startLabel}
          </span>
          <svg
            className="zb-node__ring"
            width={RING_SIZE}
            height={RING_SIZE}
            aria-hidden="true"
            focusable="false"
          >
            <circle
              className="zb-node__ring-track"
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_R}
              strokeWidth={RING_STROKE}
              fill="none"
            />
            <circle
              className="zb-node__ring-fill"
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_R}
              strokeWidth={RING_STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - p)}
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
              data-progress={p}
            />
          </svg>
        </>
      )}
      <button
        type="button"
        className="zb-node__button"
        aria-label={name}
        aria-current={state === 'current' ? 'step' : undefined}
        data-type={type}
        onClick={onClick}
      >
        <Icon name={state === 'locked' && type === 'lesson' ? 'lock' : NODE_ICON[type]} size={34} />
      </button>
    </div>
  )
}

export interface UnitBannerProps {
  section: number | string
  unit: number
  title: ReactNode
  color: BrandName
  onGuidebook?: () => void
  guidebookLabel?: string
  titleId?: string
  className?: string
}

/** The colored unit header. All text on the fill is ≥19px/800 (WCAG large; §4.1). */
export function UnitBanner({
  section,
  unit,
  title,
  color,
  onGuidebook,
  guidebookLabel = 'Guidebook',
  titleId,
  className,
}: UnitBannerProps) {
  return (
    <header className={clsx('zb-unit', className)} style={brandVars(color)} data-color={color}>
      <div className="zb-unit__text">
        <p className="zb-unit__eyebrow">
          Section {section}, Unit {unit}
        </p>
        <h2 className="zb-unit__title" id={titleId}>
          {title}
        </h2>
      </div>
      {onGuidebook && (
        <button type="button" className="zb-unit__guide" onClick={onGuidebook}>
          <Icon name="book" size={22} />
          <span>{guidebookLabel}</span>
        </button>
      )}
    </header>
  )
}

export interface PathNodeData {
  id: string
  type: PathNodeType
  state: PathNodeState
  label: string
  progress?: number
}

export interface PathUnit {
  id: string
  section: number | string
  unit: number
  title: ReactNode
  /** Defaults to `unitColor(index)`. */
  color?: BrandName
  nodes: readonly PathNodeData[]
  /** A character standing beside the first widest-offset node (±70px), on the open side. */
  aside?: ReactNode
}

export interface PathLayoutProps {
  units: readonly PathUnit[]
  onNodeClick?: (unitId: string, nodeId: string) => void
  onGuidebook?: (unitId: string) => void
  className?: string
}

/** Index of the first node at the widest offset, where a character can stand (§3). */
export function asideIndex(nodeCount: number): number | null {
  const max = Math.max(...tokens.path.offsets.map(Math.abs))
  for (let i = 0; i < nodeCount; i++) if (Math.abs(pathOffset(i)) === max) return i
  return null
}

/** The learning path, generated from data: never hand-positioned (§3). */
export function PathLayout({ units, onNodeClick, onGuidebook, className }: PathLayoutProps) {
  const uid = useId()
  return (
    <div className={clsx('zb-path', className)}>
      {units.map((u, ui) => {
        const color = u.color ?? unitColor(ui)
        const titleId = `${uid}-unit-${ui}`
        const asideAt = u.aside ? asideIndex(u.nodes.length) : null
        return (
          <section key={u.id} className="zb-path__unit" aria-labelledby={titleId}>
            <UnitBanner
              section={u.section}
              unit={u.unit}
              title={u.title}
              color={color}
              titleId={titleId}
              onGuidebook={onGuidebook ? () => onGuidebook(u.id) : undefined}
            />
            <ol className="zb-path__nodes">
              {u.nodes.map((n, i) => {
                const offset = pathOffset(i)
                return (
                  <li key={n.id} className="zb-path__row" data-offset={offset}>
                    <div className="zb-path__slot" style={{ transform: `translateX(${offset}px)` }}>
                      <PathNode
                        type={n.type}
                        state={n.state}
                        label={n.label}
                        color={color}
                        progress={n.progress ?? 0}
                        onClick={onNodeClick ? () => onNodeClick(u.id, n.id) : undefined}
                      />
                    </div>
                    {asideAt === i && (
                      <div className="zb-path__aside" data-side={offset < 0 ? 'right' : 'left'}>
                        {u.aside}
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          </section>
        )
      })}
    </div>
  )
}
