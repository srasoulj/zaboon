'use client'
/**
 * The Learn path (DESIGN-SYSTEM §3): unit banners and level nodes from GET /api/path, laid out with
 * the kit (`UnitBanner`, `PathNode` on the `pathOffset` curve, never hand-positioned). Tapping a
 * node opens a popover with the level title, "Lesson x of y" and START / replay.
 */
import clsx from 'clsx'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import type { PathResponse } from '@zaboon/contracts'
import {
  asideIndex,
  Character,
  CHARACTER_NAMES,
  Icon,
  PathNode,
  pathOffset,
  UnitBanner,
  usePrefersReducedMotion,
  type BrandName,
  type CharacterName,
  type IconName,
  type PathNodeType,
} from '@zaboon/ui'
import { queryKeys } from '@/lib/api-client'
import { useApi, useSession } from '@/lib/app-services'
import {
  currentLevelId,
  levelProgress,
  levelTitle,
  lessonCounter,
  nodeLabel,
  nodeType,
  popoverAction,
  unitBrand,
  unitPositions,
  type PathLevelData,
  type PathUnitData,
} from './path-model'
import styles from './path.module.css'

const NODE_ICONS: Record<PathNodeType, IconName> = {
  lesson: 'star',
  story: 'book',
  practice: 'dumbbell',
  chest: 'chest',
  review: 'trophy',
}

/** Characters who stand beside the path, one per unit in turn (the mascot stays on the banner side). */
const PATH_CHARACTERS: readonly CharacterName[] = CHARACTER_NAMES.filter((n) => n !== 'hodhod')

function brandVars(color: BrandName): CSSProperties {
  return {
    '--unit-fill': `var(--color-${color}-500)`,
    '--unit-lip': `var(--color-${color}-600)`,
    '--unit-label': `var(--color-${color}-label)`,
  } as CSSProperties
}

/** GET /api/path for the signed-in learner (the shell creates the guest session). */
export function usePath() {
  const api = useApi()
  const session = useSession()
  return useQuery<PathResponse>({
    queryKey: queryKeys.path,
    queryFn: () => api('path'),
    enabled: session.status === 'signed_in',
  })
}

export function LearnPath() {
  const path = usePath()
  return (
    <section aria-labelledby="learn-title">
      <h1 id="learn-title" className="sr-only">
        Learning path
      </h1>
      {path.data ? (
        <PathView path={path.data} />
      ) : path.isError ? (
        <div className={styles.status} role="alert">
          <p>We couldn&apos;t load your path.</p>
          <button
            type="button"
            className="font-extrabold text-ink underline"
            onClick={() => void path.refetch()}
          >
            Try again
          </button>
        </div>
      ) : (
        <p className={styles.status} role="status">
          Loading your path…
        </p>
      )}
    </section>
  )
}

export function PathView({ path }: { path: PathResponse }) {
  const router = useRouter()
  const reduceMotion = usePrefersReducedMotion()
  const [openId, setOpenId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const scrolled = useRef(false)
  const positions = unitPositions(path)
  const current = currentLevelId(path)

  useEffect(() => {
    if (scrolled.current || !current) return
    scrolled.current = true
    const row = rootRef.current?.querySelector(`[data-level="${current}"]`)
    row?.scrollIntoView?.({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [current, reduceMotion])

  const close = useCallback(() => setOpenId(null), [])

  return (
    <div className="zb-path" ref={rootRef} data-testid="learn-path">
      {path.sections.flatMap((section) =>
        section.units.map((unit) => {
          const pos = positions.get(unit.id)!
          return (
            <UnitView
              key={unit.id}
              unit={unit}
              courseId={path.courseId}
              section={pos.sectionNumber}
              number={pos.unitNumber}
              character={PATH_CHARACTERS[pos.pathIndex % PATH_CHARACTERS.length]!}
              openId={openId}
              onToggle={(id) => setOpenId((o) => (o === id ? null : id))}
              onClose={close}
              onGuidebook={
                unit.hasGuidebook
                  ? () =>
                      router.push(
                        `/learn/guidebook/${encodeURIComponent(unit.id)}?course=${encodeURIComponent(path.courseId)}`,
                      )
                  : undefined
              }
            />
          )
        }),
      )}
    </div>
  )
}

interface UnitViewProps {
  unit: PathUnitData
  courseId: string
  section: number
  number: number
  character: CharacterName
  openId: string | null
  onToggle(levelId: string): void
  onClose(): void
  onGuidebook: (() => void) | undefined
}

function UnitView({
  unit,
  courseId,
  section,
  number,
  character,
  openId,
  onToggle,
  onClose,
  onGuidebook,
}: UnitViewProps) {
  const titleId = useId()
  const color = unitBrand(unit.color)
  const asideAt = asideIndex(unit.levels.length)
  return (
    <section className="zb-path__unit" aria-labelledby={titleId} data-unit={unit.id}>
      <UnitBanner
        section={section}
        unit={number}
        color={color}
        titleId={titleId}
        title={
          <>
            {unit.title}
            {unit.subtitle && <span className={styles.subtitle}>{unit.subtitle}</span>}
          </>
        }
        onGuidebook={onGuidebook}
      />
      <ol className="zb-path__nodes">
        {unit.levels.map((level, i) => (
          <LevelRow
            key={level.id}
            level={level}
            index={i}
            color={color}
            courseId={courseId}
            open={openId === level.id}
            onToggle={() => onToggle(level.id)}
            onClose={onClose}
            aside={asideAt === i ? <PathCharacter name={character} /> : null}
          />
        ))}
      </ol>
    </section>
  )
}

interface LevelRowProps {
  level: PathLevelData
  index: number
  color: BrandName
  courseId: string
  open: boolean
  onToggle(): void
  onClose(): void
  aside: ReactNode
}

function LevelRow({
  level,
  index,
  color,
  courseId,
  open,
  onToggle,
  onClose,
  aside,
}: LevelRowProps) {
  const offset = pathOffset(index)
  const slotRef = useRef<HTMLDivElement>(null)
  const popoverId = useId()
  const type = nodeType(level.kind)
  const label = nodeLabel(level)

  // The kit's node button takes no ARIA props; describe the popover it controls.
  useEffect(() => {
    const button = slotRef.current?.querySelector('button')
    if (!button) return
    button.setAttribute('aria-haspopup', 'dialog')
    button.setAttribute('aria-expanded', String(open))
    if (open) button.setAttribute('aria-controls', popoverId)
    else button.removeAttribute('aria-controls')
  }, [open, popoverId, level.state])

  const closeAndFocus = useCallback(() => {
    onClose()
    slotRef.current?.querySelector('button')?.focus()
  }, [onClose])

  return (
    <li
      className={clsx('zb-path__row', styles.row)}
      data-offset={offset}
      data-level={level.id}
      data-state={level.state}
    >
      <div
        ref={slotRef}
        className={clsx(
          'zb-path__slot',
          styles.slot,
          level.state === 'legendary' && styles.legendary,
        )}
        style={{ transform: `translateX(${offset}px)` }}
      >
        {level.state === 'available' ? (
          <AvailableNode type={type} label={label} color={color} onClick={onToggle} />
        ) : (
          <PathNode
            type={type}
            state={level.state}
            label={label}
            color={color}
            progress={levelProgress(level)}
            onClick={onToggle}
          />
        )}
        {level.state === 'legendary' && <Crown />}
      </div>
      {aside && (
        <div
          className={clsx('zb-path__aside', styles.aside)}
          data-side={offset < 0 ? 'right' : 'left'}
        >
          {aside}
        </div>
      )}
      {open && (
        <LevelPopover
          id={popoverId}
          level={level}
          courseId={courseId}
          offset={offset}
          anchor={slotRef}
          onClose={closeAndFocus}
          onDismiss={onClose}
        />
      )}
    </li>
  )
}

/** An unlocked level with no session (chest, story): the kit node look, white face, no START. */
function AvailableNode({
  type,
  label,
  color,
  onClick,
}: {
  type: PathNodeType
  label: string
  color: BrandName
  onClick(): void
}) {
  return (
    <div
      className={clsx('zb-node', styles.available)}
      style={brandVars(color)}
      data-state="available"
    >
      <button
        type="button"
        className="zb-node__button"
        aria-label={`${label}, available`}
        data-type={type}
        onClick={onClick}
      >
        <Icon name={NODE_ICONS[type]} size={34} />
      </button>
    </div>
  )
}

function Crown() {
  return (
    <svg
      className={styles.crown}
      width="30"
      height="24"
      viewBox="0 0 30 24"
      aria-hidden="true"
      focusable="false"
      data-testid="legendary-crown"
    >
      <path
        d="M2 8l6.5 5L15 2l6.5 11L28 8l-3 14H5z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface LevelPopoverProps {
  id: string
  level: PathLevelData
  courseId: string
  offset: number
  anchor: RefObject<HTMLDivElement | null>
  /** Escape from inside the popover: close and give focus back to the node. */
  onClose(): void
  /** A click or focus elsewhere: close and leave focus where the learner put it. */
  onDismiss(): void
}

function LevelPopover({
  id,
  level,
  courseId,
  offset,
  anchor,
  onClose,
  onDismiss,
}: LevelPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const action = popoverAction(courseId, level)
  const counter = lessonCounter(level)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const first = el.querySelector<HTMLElement>('a[href], button')
    ;(first ?? el).focus()
  }, [])

  useEffect(() => {
    const inside = (t: EventTarget | null) =>
      t instanceof Node && (ref.current?.contains(t) || anchor.current?.contains(t))
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      // Only pull focus back when the learner was in the popover.
      if (ref.current?.contains(document.activeElement)) onClose()
      else onDismiss()
    }
    const onPointer = (e: PointerEvent) => {
      if (!inside(e.target)) onDismiss()
    }
    // Focus leaving for anything but the popover or its node closes it, so it never covers
    // the next focused control (WCAG 2.4.11).
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget !== null && !inside(e.relatedTarget)) onDismiss()
    }
    const popover = ref.current
    const node = anchor.current
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    popover?.addEventListener('focusout', onFocusOut)
    node?.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
      popover?.removeEventListener('focusout', onFocusOut)
      node?.removeEventListener('focusout', onFocusOut)
    }
  }, [anchor, onClose, onDismiss])

  return (
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={styles.popover}
      data-state={level.state}
      data-testid="level-popover"
      style={{ '--arrow-x': `${offset}px` } as CSSProperties}
    >
      <h3 id={titleId} className={styles.popoverTitle}>
        {levelTitle(level)}
      </h3>
      {counter && <p className={styles.popoverMeta}>{counter}</p>}
      {action.type === 'start' ? (
        <Link
          href={action.href}
          className={clsx('btn-3d zb-btn zb-btn--primary zb-btn--full', styles.linkButton)}
          data-variant="primary"
        >
          <span className="zb-btn__label">{action.label}</span>
        </Link>
      ) : (
        <p className={styles.popoverNote}>{action.message}</p>
      )}
    </div>
  )
}

/** A character idling beside the widest node; its loop pauses while it is off-screen. */
function PathCharacter({ name }: { name: CharacterName }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? true))
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref}>
      <Character name={name} size={88} paused={!visible} decorative />
    </div>
  )
}
