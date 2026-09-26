'use client'
import type { ChallengeOf } from '@zaboon/contracts'
import {
  Button3D,
  Character,
  CHARACTER_NAMES,
  FaText,
  Icon,
  type CharacterName,
  type ChoiceState,
} from '@zaboon/ui'
import { useCallback, useEffect, useId, useState } from 'react'
import { ChoiceList } from '@/components/challenges/ChoiceList'
import {
  AudioButton,
  ChallengeFrame,
  FaInline,
  faTokens,
  isPassing,
  modalOpen,
  playMedia,
  useAutoplay,
  useChoice,
  useReducedMotion,
  type ChoiceControl,
} from '@/components/challenges/shared'
import type { ChallengeDisplay, ChallengeRendererProps } from '@/lib/challenge-registry'
import styles from './story.module.css'

type Props = ChallengeRendererProps<ChallengeOf<'story'>>
type StoryChallenge = ChallengeOf<'story'>
type Line = StoryChallenge['lines'][number]
type Prompt = NonNullable<StoryChallenge['question']>['prompt']

/** The kit character drawn for a speaker id (a cast member by id, else the mascot). */
export function characterFor(speakerId: string): CharacterName {
  return (CHARACTER_NAMES as readonly string[]).includes(speakerId)
    ? (speakerId as CharacterName)
    : 'hodhod'
}

const INTERACTIVE =
  'button, a[href], input, textarea, select, [role="button"], [contenteditable="true"]'

function onInteractive(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest(INTERACTIVE) !== null)
  )
}

/** A question prompt or choice: Persian (as an RTL island) or English. */
function PromptContent({ p, display }: { p: Prompt; display: ChallengeDisplay }) {
  if (p.fa) return <FaInline dto={p.fa} display={display} />
  if (p.lang === 'fa') return <FaInline dto={{ fa: p.text, translit: '' }} display={display} />
  return <span lang="en">{p.text}</span>
}

function StoryLine({
  line,
  n,
  display,
  audio,
  animate,
}: {
  line: Line
  n: number
  display: ChallengeDisplay
  audio: Props['audio']
  animate: boolean
}) {
  const [english, setEnglish] = useState(false)
  const enId = useId()
  const tokens = faTokens(line.text, display.vowelMarks)
  const perToken = tokens.some((t) => t.translit !== undefined)
  const hasAudio = (line.text.audio?.normal ?? line.text.audio?.slow) !== undefined
  const speaker = line.speaker
  return (
    <li
      className={styles.line}
      data-testid="story-line"
      data-speaker={speaker?.id ?? 'narrator'}
      data-narrator={speaker === null ? 'true' : undefined}
      data-animate={animate ? 'true' : undefined}
    >
      {speaker && (
        <div className={styles.portrait} data-testid="story-portrait">
          <Character
            name={characterFor(speaker.id)}
            {...(speaker.image ? { image: speaker.image } : {})}
            size={56}
            paused={!animate}
            decorative
          />
        </div>
      )}
      <div className={styles.bubble}>
        {speaker && <p className={styles.speaker}>{speaker.name}</p>}
        <div className={styles.textRow}>
          {hasAudio && (
            <AudioButton
              label={`Play line ${n}`}
              onPlay={() => playMedia(audio, line.text.audio)}
            />
          )}
          <div className={styles.fa}>
            <FaText
              as="p"
              tokens={tokens}
              size="md"
              translit={display.transliteration && perToken}
              vowels={display.vowelMarks}
            />
            {display.transliteration && !perToken && line.text.translit && (
              <span className={styles.translit} lang="fa-Latn">
                {line.text.translit}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          className={styles.enToggle}
          aria-expanded={english}
          aria-controls={enId}
          onClick={() => setEnglish((v) => !v)}
        >
          {english ? 'Hide English' : 'Show English'}
        </button>
        <p id={enId} className={styles.en} lang="en" hidden={!english}>
          {line.en}
        </p>
      </div>
    </li>
  )
}

/**
 * One beat of a story (P2, flags.stories), Duolingo-style: an illustrated header, then the beat's
 * lines one by one (Continue, Space or Enter reveals the next). Each line has the speaker's
 * portrait, its audio (tap to replay) and the English on tap; Persian lines are whole-word RTL
 * islands. Once every line is shown, a beat with a question shows it as choice cards (digits pick,
 * draft `{kind: 'choice'}`); the closing beat reports `{kind: 'none'}` so CHECK continues.
 *
 * A wrong answer is retried in place (the player keeps this renderer mounted): the lines stay shown,
 * and feedback marks only the learner's pick, never the right answer.
 */
export function Story(props: Props) {
  const { challenge, display, audio, phase, response, onResponse, verdict } = props
  const { lines, question } = challenge
  const locked = phase !== 'answering'
  const reduce = useReducedMotion(display)
  const [shown, setShown] = useState(() => (response !== null || locked ? lines.length : 1))
  const allShown = shown >= lines.length

  const base = useChoice(
    props,
    allShown && question ? question.choices.length : 0,
    question?.answer ?? -1,
  )
  // A wrong pick is retried in place: never give the right answer away.
  const choice: ChoiceControl = {
    ...base,
    stateOf: (i): ChoiceState | undefined => {
      if (!base.locked || i !== base.selected || verdict === null || verdict === 'skipped')
        return undefined
      return isPassing(verdict) ? 'correct' : 'wrong'
    },
  }

  useAutoplay(audio, lines[0]?.text.audio?.normal, display.sound && !locked && shown === 1)

  const reveal = useCallback(() => {
    if (locked || shown >= lines.length) return
    setShown(shown + 1)
    const url = lines[shown]?.text.audio?.normal
    if (display.sound && url !== undefined) audio.play(url)
  }, [locked, shown, lines, display.sound, audio])

  // The closing beat (no question) is answered by reading it through.
  useEffect(() => {
    if (allShown && !question && !locked && response === null) onResponse({ kind: 'none' })
  }, [allShown, question, locked, response, onResponse])

  // Space or Enter (not on a focused control) reveals the next line. Capture phase, so the player's
  // Enter (CHECK) never sees it while lines are still to come.
  useEffect(() => {
    if (allShown || locked) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.repeat) return
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.key !== ' ' && e.key !== 'Enter') return
      if (modalOpen() || onInteractive(e.target)) return
      e.preventDefault()
      reveal()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [allShown, locked, reveal])

  return (
    <ChallengeFrame type={challenge.type} display={display} heading={challenge.title}>
      <div className={styles.header}>
        {challenge.image ? (
          // The cover is decorative (the title names the story). crossOrigin: a CORS response the
          // service worker can cache offline, like select_image.
          // eslint-disable-next-line @next/next/no-img-element -- content media, sized by CSS
          <img
            className={styles.cover}
            src={challenge.image}
            alt=""
            crossOrigin="anonymous"
            draggable={false}
            data-testid="story-cover"
          />
        ) : (
          <div className={styles.coverPlaceholder} aria-hidden="true" data-testid="story-cover">
            <Icon name="book" size={44} />
          </div>
        )}
        <p className={styles.part}>
          Part {challenge.beat + 1} of {challenge.beats}
        </p>
      </div>
      <ol className={styles.lines} aria-live="polite" aria-label="Story">
        {lines.slice(0, shown).map((line, i) => (
          <StoryLine
            key={i}
            line={line}
            n={i + 1}
            display={display}
            audio={audio}
            animate={!reduce}
          />
        ))}
      </ol>
      {!allShown && (
        <Button3D
          variant="secondary"
          fullWidth
          disabled={locked}
          onClick={reveal}
          data-testid="story-continue"
        >
          Continue
        </Button3D>
      )}
      {allShown && question && (
        <div className={styles.question} data-testid="story-question">
          <p className={styles.questionPrompt}>
            <PromptContent p={question.prompt} display={display} />
          </p>
          <ChoiceList
            control={choice}
            label="Answers"
            options={question.choices.map((c, i) => (
              <PromptContent key={i} p={c} display={display} />
            ))}
          />
        </div>
      )}
    </ChallengeFrame>
  )
}
