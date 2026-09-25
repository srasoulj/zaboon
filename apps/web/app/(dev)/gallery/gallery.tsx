'use client'
import {
  BottomSheet,
  Button3D,
  Character,
  CHARACTER_DISPLAY_NAMES,
  CHARACTER_MOODS,
  CHARACTER_NAMES,
  ChoiceCard,
  ConfettiBurst,
  FaText,
  FeedbackBar,
  Modal,
  PathLayout,
  PathNode,
  ProgressBar,
  SpeechBubble,
  StatPill,
  TileBank,
  Toast,
  UnitBanner,
  useDigitShortcuts,
  type FaToken,
  type PathNodeType,
  type PathUnit,
  type Tile,
} from '@zaboon/ui'
import { useEffect, useState, type ReactNode } from 'react'
import styles from './gallery.module.css'

const ZWNJ = '\u200C'

const SENTENCE: FaToken[] = [
  { surface: 'مَن', translit: 'man', gloss: 'I' },
  { surface: 'آب', translit: 'āb', gloss: 'water' },
  { surface: `می${ZWNJ}خوام`, translit: 'mikhām', gloss: '(I) want' },
]

const GREETING: FaToken[] = [
  { surface: 'سَلام', translit: 'salām', gloss: 'hello' },
  { surface: 'خوبی؟', translit: 'khubi?', gloss: 'are you well?' },
]

const FA_TILES: Tile[] = [
  { id: 't1', text: 'من', lang: 'fa' },
  { id: 't2', text: 'چای', lang: 'fa' },
  { id: 't3', text: `می${ZWNJ}خوام`, lang: 'fa' },
  { id: 't4', text: 'نون', lang: 'fa' },
  { id: 't5', text: 'آب', lang: 'fa' },
]

const EN_TILES: Tile[] = [
  { id: 'e1', text: 'I', lang: 'en' },
  { id: 'e2', text: 'want', lang: 'en' },
  { id: 'e3', text: 'water', lang: 'en' },
  { id: 'e4', text: 'bread', lang: 'en' },
  { id: 'e5', text: 'tea', lang: 'en' },
]

const UNITS: PathUnit[] = [
  {
    id: 'u1',
    section: 1,
    unit: 1,
    title: 'Say hello',
    aside: <Character name="hodhod" mood="happy" size={96} decorative />,
    nodes: [
      { id: 'a', type: 'lesson', state: 'legendary', label: 'Lesson 1' },
      { id: 'b', type: 'lesson', state: 'completed', label: 'Lesson 2' },
      { id: 'c', type: 'story', state: 'completed', label: 'Story' },
      { id: 'd', type: 'lesson', state: 'current', label: 'Lesson 3', progress: 0.4 },
      { id: 'e', type: 'practice', state: 'locked', label: 'Practice' },
      { id: 'f', type: 'chest', state: 'locked', label: 'Reward chest' },
      { id: 'g', type: 'review', state: 'locked', label: 'Unit review' },
    ],
  },
  {
    id: 'u2',
    section: 1,
    unit: 2,
    title: 'Order at a café',
    nodes: [
      { id: 'h', type: 'lesson', state: 'locked', label: 'Lesson 1' },
      { id: 'i', type: 'lesson', state: 'locked', label: 'Lesson 2' },
    ],
  },
]

const NODE_TYPES: PathNodeType[] = ['lesson', 'story', 'practice', 'chest', 'review']

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className={styles.section} data-testid={`gallery-${id}`} aria-labelledby={`h-${id}`}>
      <h2 id={`h-${id}`} className={styles.sectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Caption({ children }: { children: ReactNode }) {
  return <p className={styles.caption}>{children}</p>
}

export function Gallery({ theme }: { theme: 'light' | 'dark' }) {
  const [choice, setChoice] = useState<number | null>(2)
  const [faAnswer, setFaAnswer] = useState<string[]>(['t1', 't5'])
  const [enAnswer, setEnAnswer] = useState<string[]>(['e1'])
  const [hint, setHint] = useState<FaToken | null>(null)
  const [modal, setModal] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [confetti, setConfetti] = useState(0)
  const [mouth, setMouth] = useState(0.4)
  const [vowels, setVowels] = useState(true)
  // Marks hydration as done so screenshot tests never capture the server-only render.
  const [ready, setReady] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time post-hydration flag
  useEffect(() => setReady(true), [])

  useDigitShortcuts(3, setChoice, !modal && !sheet)

  return (
    <main className={styles.page} data-ready={ready || undefined}>
      <header className={styles.header}>
        <h1 className={styles.title}>Zaboon UI gallery</h1>
        <nav className={styles.themeLinks} aria-label="Theme">
          <a href="?theme=light" aria-current={theme === 'light' ? 'page' : undefined}>
            Light
          </a>
          <a href="?theme=dark" aria-current={theme === 'dark' ? 'page' : undefined}>
            Dark
          </a>
        </nav>
      </header>

      <Section id="buttons" title="Button3D">
        <div className={styles.row}>
          <Button3D>Continue</Button3D>
          <Button3D variant="secondary">Get Plus</Button3D>
          <Button3D variant="danger">Quit</Button3D>
          <Button3D variant="ghost">Skip</Button3D>
          <Button3D variant="locked">Check</Button3D>
          <Button3D loading>Saving</Button3D>
          <Button3D disabled>Disabled</Button3D>
        </div>
        <Button3D fullWidth>Start lesson</Button3D>
      </Section>

      <Section id="choices" title="ChoiceCard">
        <Caption>Press 1–3 to pick</Caption>
        <div className={styles.grid}>
          {['water', 'bread', 'tea'].map((w, i) => (
            <ChoiceCard key={w} index={i + 1} selected={choice === i + 1} onSelect={() => setChoice(i + 1)}>
              {w}
            </ChoiceCard>
          ))}
        </div>
        <div className={styles.grid}>
          <ChoiceCard index={1} selected state="correct">
            <FaText text="چای" />
          </ChoiceCard>
          <ChoiceCard index={2} selected state="wrong">
            <FaText text="نون" />
          </ChoiceCard>
          <ChoiceCard index={3} media={<Character name="leila" size={72} decorative />}>
            <FaText tokens={[{ surface: 'آشپز', translit: 'āshpaz' }]} translit />
          </ChoiceCard>
        </div>
      </Section>

      <Section id="fatext" title="FaText">
        <div className={styles.stack}>
          <Caption>Transliteration under each token · tap a word for a hint</Caption>
          <FaText tokens={SENTENCE} translit vowels={vowels} size="xl" onTokenTap={(t) => setHint(t)} />
          <div className={styles.row}>
            <Button3D variant="ghost" onClick={() => setVowels((v) => !v)}>
              {vowels ? 'Hide vowel marks' : 'Show vowel marks'}
            </Button3D>
          </div>
          <Caption>Per-token (auto) transliteration · whole-word highlight</Caption>
          <FaText tokens={SENTENCE} translit={(_t, i) => i === 2} highlight={[1]} size="lg" />
          <Caption>Inside an English sentence (bidi isolated)</Caption>
          <p>
            “Hello” is <FaText tokens={GREETING.slice(0, 1)} /> and “are you well?” is <FaText text="خوبی؟" />.
          </p>
          <Caption>Sizes</Caption>
          <div className={styles.row}>
            <FaText text="زبون" size="sm" />
            <FaText text="زبون" size="md" />
            <FaText text="زبون" size="lg" />
            <FaText text="زبون" size="xl" />
          </div>
        </div>
      </Section>

      <Section id="tiles" title="WordTile + TileBank">
        <div className={styles.lessonFrame}>
          <Caption>Persian answer line (dir=rtl)</Caption>
          <TileBank tiles={FA_TILES} answer={faAnswer} onChange={setFaAnswer} dir="rtl" />
          <Caption>English answer line (dir=ltr)</Caption>
          <TileBank tiles={EN_TILES} answer={enAnswer} onChange={setEnAnswer} dir="ltr" />
          <Caption>Graded</Caption>
          <TileBank tiles={FA_TILES.slice(0, 3)} answer={['t1', 't2', 't3']} onChange={() => {}} dir="rtl" state="correct" disabled />
        </div>
      </Section>

      <Section id="progress" title="ProgressBar">
        <div className={styles.lessonFrame}>
          <ProgressBar value={0.3} />
          <div style={{ paddingBlockStart: 28 }}>
            <ProgressBar value={0.7} streak={5} />
          </div>
        </div>
      </Section>

      <Section id="feedback" title="FeedbackBar">
        <FeedbackBar status="correct" autoFocus={false} onContinue={() => {}} detail="man āb mikhām" />
        <FeedbackBar
          status="wrong"
          autoFocus={false}
          solution={<FaText tokens={SENTENCE} highlight={[2]} translit />}
          detail="I want water."
          onReport={() => {}}
          onContinue={() => {}}
        />
      </Section>

      <Section id="path" title="PathNode · UnitBanner · PathLayout">
        <div className={styles.row}>
          {NODE_TYPES.map((t) => (
            <div key={t} className={styles.cell}>
              <PathNode type={t} state="completed" label={t} color="lajvard" />
              <Caption>{t}</Caption>
            </div>
          ))}
        </div>
        <UnitBanner section={2} unit={7} title="At the bazaar" color="pesteh" onGuidebook={() => {}} />
        <PathLayout units={UNITS} onNodeClick={() => {}} onGuidebook={() => {}} />
      </Section>

      <Section id="stats" title="StatPill">
        <div className={styles.row}>
          <StatPill kind="streak" value={12} popover={<p>You are on a 12 day streak!</p>} popoverLabel="Streak" />
          <StatPill kind="streak" value={0} active={false} />
          <StatPill kind="coins" value={1250} />
          <StatPill kind="hearts" value={5} popover={<p>Your hearts are full.</p>} popoverLabel="Hearts" />
          <StatPill kind="hearts" value="infinite" />
        </div>
      </Section>

      <Section id="characters" title="Character · SpeechBubble">
        <div className={styles.row}>
          {CHARACTER_NAMES.map((n) => (
            <div key={n} className={styles.cell}>
              <Character name={n} size={96} />
              <Caption>{CHARACTER_DISPLAY_NAMES[n]}</Caption>
            </div>
          ))}
        </div>
        <Caption>Hodhod moods</Caption>
        <div className={styles.row}>
          {CHARACTER_MOODS.map((m) => (
            <div key={m} className={styles.cell}>
              <Character name="hodhod" mood={m} size={96} />
              <Caption>{m}</Caption>
            </div>
          ))}
        </div>
        <Caption>Moods on the cast</Caption>
        <div className={styles.row}>
          {CHARACTER_MOODS.map((m) => (
            <div key={m} className={styles.cell}>
              <Character name="shirin" mood={m} size={80} />
              <Caption>{m}</Caption>
            </div>
          ))}
        </div>
        <Caption>mouthOpen</Caption>
        <label className={styles.row}>
          <span>mouthOpen {mouth.toFixed(1)}</span>
          <input type="range" min={0} max={1} step={0.1} value={mouth} onChange={(e) => setMouth(Number(e.target.value))} />
        </label>
        <div className={styles.row}>
          <Character name="maman-bozorg" mouthOpen={mouth} size={110} />
          <SpeechBubble tail="start">
            <FaText tokens={[{ surface: 'بخور!', translit: 'bokhor!' }, { surface: 'بخور!', translit: 'bokhor!' }]} translit size="lg" />
          </SpeechBubble>
          <Character name="hodhod" mouthOpen={mouth} size={110} />
          <SpeechBubble tail="start">Tap the words to hear them.</SpeechBubble>
        </div>
        <div className={styles.row}>
          <SpeechBubble tail="bottom">Salām! I’m Dariush.</SpeechBubble>
          <SpeechBubble tail="end">
            <FaText text="کجا می‌ری؟" size="lg" />
          </SpeechBubble>
          <Character name="dariush" size={96} />
        </div>
      </Section>

      <Section id="overlays" title="Modal · BottomSheet · Toast · ConfettiBurst">
        <div className={styles.row}>
          <Button3D variant="danger" onClick={() => setModal(true)}>
            Quit lesson
          </Button3D>
          <Button3D variant="secondary" onClick={() => setSheet(true)}>
            Open sheet
          </Button3D>
          <div className={styles.relative}>
            <Button3D onClick={() => setConfetti((c) => c + 1)}>Celebrate</Button3D>
            <ConfettiBurst fireKey={confetti} />
          </div>
        </div>
        <div className={styles.stack}>
          <Toast message="Your progress is saved." duration={null} />
          <Toast tone="success" message="Streak extended!" duration={null} onDismiss={() => {}} />
          <Toast tone="error" message="You're offline. We'll retry." duration={null} onDismiss={() => {}} />
        </div>
      </Section>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Wait, don't go!"
        description="You'll lose your progress if you quit now."
        illustration={<Character name="hodhod" mood="sad" size={110} decorative />}
        actions={
          <>
            <Button3D fullWidth onClick={() => setModal(false)}>
              Keep learning
            </Button3D>
            <Button3D fullWidth variant="ghost" onClick={() => setModal(false)}>
              End session
            </Button3D>
          </>
        }
      />
      <BottomSheet
        open={sheet || hint !== null}
        onClose={() => {
          setSheet(false)
          setHint(null)
        }}
        title={hint ? <FaText text={hint.surface} size="xl" /> : 'Lesson settings'}
        description={hint ? `${hint.translit ?? ''} · ${hint.gloss ?? ''}` : 'Adjust how Persian is shown.'}
        actions={
          <Button3D
            fullWidth
            onClick={() => {
              setSheet(false)
              setHint(null)
            }}
          >
            Got it
          </Button3D>
        }
      />
    </main>
  )
}
