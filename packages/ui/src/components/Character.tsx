'use client'
/**
 * Placeholder characters (DESIGN-SYSTEM §7): flat SVGs built only from circles, rounded rectangles
 * and round-capped strokes, filled from the palette. Original designs. The public interface mirrors
 * the Rive state machine (§7.3) so a Rive renderer can replace the SVG without touching callers:
 * pass `renderer={RiveCharacter}` implementing `CharacterRendererProps`.
 */
import clsx from 'clsx'
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { usePrefersReducedMotion } from '../motion-preference'
import { tokens } from '../tokens'

export const CHARACTER_NAMES = ['hodhod', 'maman-bozorg', 'shirin', 'dariush', 'kian', 'leila', 'babak'] as const
export type CharacterName = (typeof CHARACTER_NAMES)[number]

export const CHARACTER_DISPLAY_NAMES: Record<CharacterName, string> = {
  hodhod: 'Hodhod',
  'maman-bozorg': 'Maman Bozorg',
  shirin: 'Shirin',
  dariush: 'Dariush',
  kian: 'Kian',
  leila: 'Leila',
  babak: 'Babak',
}

export const CHARACTER_MOODS = ['idle', 'happy', 'sad', 'thinking', 'celebrate'] as const
export type CharacterMood = (typeof CHARACTER_MOODS)[number]

/** Rive state machine contract (§7.3): machine `Main`, numeric `mood` and `mouthOpen` inputs. */
export const RIVE_CONTRACT = {
  stateMachine: 'Main',
  inputs: { mood: 'mood', mouthOpen: 'mouthOpen' },
  mood: { idle: 0, happy: 1, sad: 2, thinking: 3, celebrate: 4 } satisfies Record<CharacterMood, number>,
} as const

export interface CharacterRendererProps {
  name: CharacterName
  mood: CharacterMood
  /** 0..1, driven by the audio amplitude envelope while a clip plays. */
  mouthOpen: number
  size: number
  /** False under reduced motion or when paused (off-screen): render a static pose. */
  animate: boolean
}

export type CharacterRenderer = ComponentType<CharacterRendererProps>

export interface CharacterProps {
  name: CharacterName
  mood?: CharacterMood
  mouthOpen?: number
  /** Rendered width/height in px. */
  size?: number
  /** Pause idle loops (e.g. scrolled off-screen). */
  paused?: boolean
  /** Swap in a Rive renderer later; defaults to the SVG placeholder. */
  renderer?: CharacterRenderer
  /**
   * Portrait URL (content assets, §7.4). Drawn in the same `size`×`size` box as the placeholder;
   * the SVG placeholder is shown while there is none or when it fails to load.
   */
  image?: string
  /**
   * Accessible name; defaults to "<Name>, <mood>" for the placeholder and "<Name>" for a portrait
   * (its `alt`). Pass `decorative` to hide from AT instead (`alt=""`).
   */
  label?: string
  decorative?: boolean
  className?: string
}

const B = tokens.brand
const INK = tokens.theme.light.ink
const WHITE = '#FFFFFF'
/** Placeholder skin tones and Hodhod's cinnamon: not brand tokens; the style bible replaces them (§7.4). */
const SKIN = { light: '#F6D7B8', mid: '#D9A574', deep: '#A8704A' } as const
const CINNAMON = '#B8683A'

function clampMouth(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
}

interface FaceProps {
  cx: number
  cy: number
  mood: CharacterMood
  mouthOpen: number
}

/** Eyes, brows, cheeks and mouth shared by the human cast. */
function Face({ cx, cy, mood, mouthOpen }: FaceProps) {
  const look = mood === 'thinking' ? { x: 2.5, y: -2.5 } : { x: 0, y: 0 }
  const joyful = mood === 'happy' || mood === 'celebrate'
  const my = cy + 10
  let mouth: ReactNode
  if (mouthOpen > 0.02) {
    mouth = <ellipse data-part="mouth-open" cx={cx} cy={my} rx={5.5} ry={1.5 + mouthOpen * 5.5} fill={INK} />
  } else if (joyful) {
    mouth = <path data-part="mouth" d={`M${cx - 7} ${my - 1} Q${cx} ${my + 7} ${cx + 7} ${my - 1}`} stroke={INK} strokeWidth={3} strokeLinecap="round" fill="none" />
  } else if (mood === 'sad') {
    mouth = <path data-part="mouth" d={`M${cx - 5} ${my + 3} Q${cx} ${my - 2} ${cx + 5} ${my + 3}`} stroke={INK} strokeWidth={3} strokeLinecap="round" fill="none" />
  } else if (mood === 'thinking') {
    mouth = <path data-part="mouth" d={`M${cx - 2} ${my + 1} L${cx + 5} ${my}`} stroke={INK} strokeWidth={3} strokeLinecap="round" />
  } else {
    mouth = <path data-part="mouth" d={`M${cx - 5} ${my} Q${cx} ${my + 4} ${cx + 5} ${my}`} stroke={INK} strokeWidth={3} strokeLinecap="round" fill="none" />
  }
  return (
    <g data-part="face">
      <g className="zb-char__eyes">
        {[-9, 9].map((dx) =>
          joyful ? (
            <path
              key={dx}
              d={`M${cx + dx - 4} ${cy + 1} Q${cx + dx} ${cy - 5} ${cx + dx + 4} ${cy + 1}`}
              stroke={INK}
              strokeWidth={3}
              strokeLinecap="round"
              fill="none"
            />
          ) : (
            <circle key={dx} cx={cx + dx + look.x} cy={cy + look.y} r={3.4} fill={INK} />
          ),
        )}
      </g>
      {mood === 'sad' &&
        [-9, 9].map((dx) => (
          <path
            key={`b${dx}`}
            d={`M${cx + dx - 4} ${cy - 6 + (dx < 0 ? -2 : 0)} L${cx + dx + 4} ${cy - 6 + (dx < 0 ? 0 : -2)}`}
            stroke={INK}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        ))}
      {joyful && (
        <g fill={B.anar['500']} opacity={0.35}>
          <circle cx={cx - 14} cy={cy + 7} r={4} />
          <circle cx={cx + 14} cy={cy + 7} r={4} />
        </g>
      )}
      {mouth}
    </g>
  )
}

interface HumanSpec {
  skin: string
  outfit: string
  back?: () => ReactNode
  top?: ReactNode
  props?: ReactNode
}

const HEAD = { cx: 60, cy: 50, r: 24 }

const HUMANS: Record<Exclude<CharacterName, 'hodhod'>, HumanSpec> = {
  'maman-bozorg': {
    skin: SKIN.light,
    outfit: B.firouzeh['600'],
    back: () => <rect x={30} y={22} width={60} height={62} rx={28} fill={B.bademjan['500']} />,
    top: (
      <g>
        <rect x={34} y={24} width={52} height={18} rx={9} fill={B.bademjan['500']} />
        <g fill={B.zaferan['500']}>
          <circle cx={46} cy={33} r={2.5} />
          <circle cx={60} cy={30} r={2.5} />
          <circle cx={74} cy={33} r={2.5} />
        </g>
        <g fill="none" stroke={INK} strokeWidth={2}>
          <circle cx={51} cy={50} r={6.5} />
          <circle cx={69} cy={50} r={6.5} />
          <path d="M57.5 50 L62.5 50" strokeLinecap="round" />
        </g>
      </g>
    ),
    props: <rect x={44} y={92} width={32} height={10} rx={5} fill={B.zaferan['100']} />,
  },
  shirin: {
    skin: SKIN.mid,
    outfit: B.lajvard['500'],
    back: () => <rect x={32} y={26} width={56} height={52} rx={24} fill={INK} />,
    top: (
      <g>
        <rect x={34} y={24} width={52} height={16} rx={8} fill={INK} />
        <rect x={30} y={30} width={60} height={9} rx={4.5} fill={B.anar['500']} />
        <circle cx={35} cy={60} r={3} fill={B.zaferan['500']} />
        <circle cx={85} cy={60} r={3} fill={B.zaferan['500']} />
      </g>
    ),
    props: <rect x={70} y={88} width={18} height={24} rx={4} fill={B.pesteh['500']} />,
  },
  dariush: {
    skin: SKIN.mid,
    outfit: B.zaferan['500'],
    top: (
      <g>
        <rect x={34} y={22} width={52} height={18} rx={9} fill={B.lajvard['600']} />
        <rect x={56} y={34} width={36} height={7} rx={3.5} fill={B.lajvard['600']} />
        <rect x={49} y={56} width={22} height={6} rx={3} fill={INK} />
      </g>
    ),
    props: (
      <g>
        <rect x={44} y={86} width={32} height={8} rx={4} fill={INK} />
        <circle cx={60} cy={90} r={2.5} fill={B.zaferan['500']} />
      </g>
    ),
  },
  kian: {
    skin: SKIN.light,
    outfit: B.pesteh['500'],
    top: (
      <g>
        <rect x={36} y={24} width={48} height={14} rx={7} fill={INK} />
        <circle cx={44} cy={30} r={6} fill={INK} />
        <circle cx={56} cy={27} r={6} fill={INK} />
        <circle cx={70} cy={28} r={6} fill={INK} />
      </g>
    ),
    props: (
      <g fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round">
        <path d="M38 80 Q60 96 82 80" />
        <circle cx={38} cy={80} r={2} fill={INK} />
        <circle cx={82} cy={80} r={2} fill={INK} />
      </g>
    ),
  },
  leila: {
    skin: SKIN.deep,
    outfit: B.anar['500'],
    back: () => <circle cx={60} cy={30} r={12} fill={INK} />,
    top: (
      <g>
        <rect x={40} y={4} width={40} height={20} rx={10} fill={WHITE} stroke={tokens.theme.light.line} strokeWidth={2} />
        <rect x={42} y={20} width={36} height={10} rx={4} fill={WHITE} stroke={tokens.theme.light.line} strokeWidth={2} />
      </g>
    ),
    props: <rect x={44} y={84} width={32} height={34} rx={8} fill={WHITE} />,
  },
  babak: {
    skin: SKIN.deep,
    outfit: B.bademjan['500'],
    top: (
      <g fill={INK}>
        {[40, 50, 60, 70, 80].map((x, i) => (
          <circle key={x} cx={x} cy={i % 2 ? 26 : 29} r={7} />
        ))}
        <rect x={42} y={60} width={36} height={16} rx={8} />
      </g>
    ),
    props: (
      <g>
        <rect x={26} y={94} width={68} height={18} rx={6} fill={B.zaferan['600']} />
        <g stroke={B.zaferan['100']} strokeWidth={1.5} strokeLinecap="round">
          <path d="M32 99 L88 99" />
          <path d="M32 103 L88 103" />
          <path d="M32 107 L88 107" />
        </g>
      </g>
    ),
  },
}

function Human({ name, mood, mouthOpen }: { name: Exclude<CharacterName, 'hodhod'>; mood: CharacterMood; mouthOpen: number }) {
  const spec = HUMANS[name]
  const arms = mood === 'celebrate'
  return (
    <g>
      {spec.back?.()}
      <g className="zb-char__body">
        {arms && (
          <g fill={spec.outfit}>
            <rect x={14} y={58} width={14} height={36} rx={7} transform="rotate(-25 21 76)" />
            <rect x={92} y={58} width={14} height={36} rx={7} transform="rotate(25 99 76)" />
          </g>
        )}
        <rect x={28} y={78} width={64} height={46} rx={22} fill={spec.outfit} />
        {spec.props}
      </g>
      <circle cx={HEAD.cx} cy={HEAD.cy} r={HEAD.r} fill={spec.skin} />
      <Face cx={HEAD.cx} cy={HEAD.cy + 2} mood={mood} mouthOpen={mouthOpen} />
      {spec.top}
    </g>
  )
}

/** Fan-crest angles per mood: flared when proud, drooped when sad (§7.1). */
const CREST: Record<CharacterMood, readonly number[]> = {
  idle: [-48, -24, 0, 24, 48],
  happy: [-66, -33, 0, 33, 66],
  celebrate: [-72, -36, 0, 36, 72],
  thinking: [-40, -20, 0, 20, 40],
  sad: [-110, -95, -80, -65, -50],
}

function Hodhod({ mood, mouthOpen }: { mood: CharacterMood; mouthOpen: number }) {
  const joyful = mood === 'happy' || mood === 'celebrate'
  const crestLen = joyful ? 30 : mood === 'sad' ? 22 : 26
  const beakDrop = mouthOpen * 20
  return (
    <g>
      <g className={clsx('zb-char__crest', mood === 'thinking' && 'zb-char__crest--twitch')} data-part="crest">
        {CREST[mood].map((a) => (
          <g key={a} transform={`rotate(${a} 66 36)`}>
            <rect x={61.5} y={36 - crestLen} width={9} height={crestLen} rx={4.5} fill={B.zaferan['500']} />
            <circle cx={66} cy={36 - crestLen + 4.5} r={4.5} fill={INK} />
          </g>
        ))}
      </g>
      <g className="zb-char__body">
        <rect x={16} y={70} width={30} height={14} rx={7} fill={INK} transform="rotate(20 31 77)" />
        <ellipse cx={56} cy={78} rx={30} ry={26} fill={CINNAMON} />
        <g transform="rotate(-12 54 80)">
          <rect x={34} y={70} width={40} height={24} rx={12} fill={INK} />
          <rect x={42} y={70} width={6} height={24} rx={3} fill={WHITE} />
          <rect x={54} y={70} width={6} height={24} rx={3} fill={WHITE} />
          <rect x={66} y={72} width={5} height={20} rx={2.5} fill={WHITE} />
        </g>
        <rect x={48} y={100} width={6} height={14} rx={3} fill={INK} />
        <rect x={62} y={100} width={6} height={14} rx={3} fill={INK} />
      </g>
      <circle cx={70} cy={48} r={20} fill={CINNAMON} />
      <g data-part="beak">
        <path d="M86 48 Q100 50 112 60" stroke={INK} strokeWidth={5} strokeLinecap="round" fill="none" />
        <path
          data-part={mouthOpen > 0.02 ? 'mouth-open' : 'mouth'}
          d="M86 52 Q98 55 108 63"
          stroke={INK}
          strokeWidth={4}
          strokeLinecap="round"
          fill="none"
          transform={`rotate(${beakDrop} 86 52)`}
        />
      </g>
      <g className="zb-char__eyes">
        {joyful ? (
          <path d="M72 46 Q76 40 80 46" stroke={INK} strokeWidth={3} strokeLinecap="round" fill="none" />
        ) : (
          <circle cx={mood === 'thinking' ? 78 : 76} cy={mood === 'thinking' ? 42 : 44} r={3.6} fill={INK} />
        )}
        {mood === 'sad' && <path d="M71 38 L80 40" stroke={INK} strokeWidth={2.5} strokeLinecap="round" />}
      </g>
    </g>
  )
}

/** The default renderer: static SVG shapes plus CSS idle loops (breathing, blinking). */
export function SvgCharacter({ name, mood, mouthOpen, size, animate }: CharacterRendererProps) {
  const m = clampMouth(mouthOpen)
  return (
    <svg
      viewBox="0 0 120 124"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={clsx('zb-char', animate ? 'zb-char--animate' : 'zb-char--static', `zb-char--${mood}`)}
      data-character={name}
      data-mood={mood}
    >
      {name === 'hodhod' ? <Hodhod mood={mood} mouthOpen={m} /> : <Human name={name} mood={mood} mouthOpen={m} />}
    </svg>
  )
}

export function Character({
  name,
  mood = 'idle',
  mouthOpen = 0,
  size = 120,
  paused = false,
  renderer: Renderer = SvgCharacter,
  image,
  label,
  decorative = false,
  className,
}: CharacterProps) {
  const reduce = usePrefersReducedMotion()
  // The URL that failed to load (a new `image` gets a fresh try).
  const [failed, setFailed] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const portrait = image !== undefined && image !== '' && failed !== image ? image : null
  // An error that fired before hydration never reaches onError: detect a broken image on mount.
  useEffect(() => {
    const img = imgRef.current
    if (portrait !== null && img?.complete && img.naturalWidth === 0) setFailed(portrait)
  }, [portrait])
  const displayName = CHARACTER_DISPLAY_NAMES[name]

  if (portrait !== null) {
    // The <img> carries the name itself (alt), so the wrapper is not a second image.
    return (
      <div className={clsx('zb-character zb-character--portrait', className)} style={{ inlineSize: size }} data-mood={mood}>
        <img
          ref={imgRef}
          className="zb-character__img"
          src={portrait}
          alt={decorative ? '' : (label ?? displayName)}
          width={size}
          height={size}
          decoding="async"
          crossOrigin="anonymous"
          data-character={name}
          onError={() => setFailed(portrait)}
        />
      </div>
    )
  }
  const a11y = decorative
    ? { 'aria-hidden': true as const }
    : { role: 'img', 'aria-label': label ?? `${displayName}, ${mood}` }
  return (
    <div className={clsx('zb-character', className)} style={{ inlineSize: size }} data-mood={mood} {...a11y}>
      <Renderer name={name} mood={mood} mouthOpen={clampMouth(mouthOpen)} size={size} animate={!reduce && !paused} />
    </div>
  )
}

export type SpeechBubbleTail = 'start' | 'end' | 'bottom'

export interface SpeechBubbleProps {
  children: ReactNode
  /** Which side points at the speaker. `start`/`end` follow the writing direction. */
  tail?: SpeechBubbleTail
  className?: string
}

/** A rounded bubble with a tail; content can be English or Persian (wrap Persian in FaText). */
export function SpeechBubble({ children, tail = 'start', className }: SpeechBubbleProps) {
  return (
    <div className={clsx('zb-bubble', `zb-bubble--${tail}`, className)}>
      <div className="zb-bubble__content">{children}</div>
    </div>
  )
}
