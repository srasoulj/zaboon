'use client'
import { DEFAULT_APP_CONFIG, type ChallengeOf } from '@zaboon/contracts'
import { Button3D, FaText } from '@zaboon/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChallengeFrame,
  FaPrompt,
  gradedState,
  useReducedMotion,
} from '@/components/challenges/shared'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import { useSpeechService } from '@/lib/speech/context'
import {
  MicrophoneError,
  startRecording,
  type ActiveRecording,
  type MicrophoneProblem,
} from '@/lib/speech/recorder'
import { SpeechError, type SpeechErrorCode } from '@/lib/speech/service'
import styles from './speak.module.css'

type Props = ChallengeRendererProps<ChallengeOf<'speak'>>

/**
 * The longest recording (AppConfig.speech.maxDurationMs; the client has no AppConfig, so the
 * default). Recording stops a little before it, so the upload is never over the server's cap.
 */
const MAX_DURATION_MS = DEFAULT_APP_CONFIG.speech.maxDurationMs
const AUTO_STOP_MS = MAX_DURATION_MS - 500
const TICK_MS = 100

type Problem = MicrophoneProblem | SpeechErrorCode | 'no_service'

type State =
  | { s: 'idle' }
  | { s: 'starting' }
  | { s: 'recording'; startedAt: number }
  | { s: 'transcribing' }
  | { s: 'done'; transcript: string }
  | { s: 'empty' }
  | { s: 'error'; problem: Problem }

/** Problems only "Can't speak now" gets past (retrying won't help right now). */
const BLOCKING: ReadonlySet<Problem> = new Set<Problem>([
  'unsupported',
  'denied',
  'unavailable',
  'quota_exceeded',
  'not_found',
  'no_service',
])

const DECLINE = "Can't speak now"

function message(problem: Problem): string {
  switch (problem) {
    case 'denied':
      return `Microphone unavailable: allow microphone access for this site, or tap “${DECLINE}”.`
    case 'unsupported':
      return `Microphone unavailable: this browser can't record audio. Tap “${DECLINE}” to go on.`
    case 'quota_exceeded':
      return `You've used today's speaking practice. Tap “${DECLINE}” to go on.`
    case 'network':
      return 'The connection dropped. Try again.'
    case 'invalid':
      return "That recording didn't work. Try again."
    case 'unavailable':
    case 'not_found':
    case 'no_service':
      return `Speech is unavailable right now. Tap “${DECLINE}” to go on.`
  }
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function initialState(response: Props['response']): State {
  if (response?.kind === 'audio' && response.declined !== true && response.transcript.trim())
    return { s: 'done', transcript: response.transcript }
  return { s: 'idle' }
}

function MicIcon() {
  return (
    <svg width={48} height={48} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x={9} y={3} width={6} height={11} rx={3} fill="currentColor" />
      <path
        d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg width={40} height={40} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x={6} y={6} width={12} height={12} rx={2.5} fill="currentColor" />
    </svg>
  )
}

/**
 * Say the sentence (P2, flags.speak). The big microphone button records (MediaRecorder, format by
 * browser), a second press (or the time limit) stops it, and the recording goes to the player's
 * SpeechService (POST /api/speech/transcribe); the audio is not kept. The transcript is shown in
 * Persian and becomes the draft `{kind: 'audio', transcript, token}`; the server re-grades it only
 * with its signed token.
 *
 * "Can't speak now" (also the way on when the microphone is denied or missing, the day's quota is
 * used up or speech is down) starts the speak pause and reports a declined answer, which submits
 * itself and grades correct: no heart lost.
 */
export function Speak(props: Props) {
  const { challenge, display, audio, phase, response, onResponse, onSubmit } = props
  const speech = useSpeechService()
  const locked = phase !== 'answering'
  const reduce = useReducedMotion(display)
  const [state, setState] = useState<State>(() => initialState(response))
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const recording = useRef<ActiveRecording | null>(null)
  const alive = useRef(true)
  const lockedRef = useRef(locked)
  const micRef = useRef<HTMLButtonElement>(null)
  const declineRef = useRef<HTMLButtonElement>(null)
  const focusNext = useRef<'mic' | 'decline' | null>(null)
  const graded = gradedState(phase, props.verdict)

  // Stop the microphone when the challenge goes away (tracks stop, the audio is dropped).
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      recording.current?.cancel()
      recording.current = null
    }
  }, [])

  // Locked (CHECK via SKIP, feedback): drop a recording in progress.
  useEffect(() => {
    lockedRef.current = locked
    if (!locked || !recording.current) return
    recording.current.cancel()
    recording.current = null
    setState({ s: 'idle' })
  }, [locked])

  useEffect(() => {
    const target = focusNext.current
    if (!target) return
    focusNext.current = null
    ;(target === 'mic' ? micRef : declineRef).current?.focus()
  }, [state])

  const fail = useCallback((problem: Problem) => {
    if (BLOCKING.has(problem)) focusNext.current = 'decline'
    setState({ s: 'error', problem })
  }, [])

  const stop = useCallback(async () => {
    const active = recording.current
    if (!active) return
    recording.current = null
    setState({ s: 'transcribing' })
    setLevel(0)
    let result
    try {
      result = await active.stop()
    } catch {
      if (alive.current && !lockedRef.current) fail('unavailable')
      return
    }
    if (!speech) return
    try {
      const res = await speech.transcribe({
        index: challenge.index,
        blob: result.blob,
        format: result.format,
        durationMs: Math.min(result.durationMs, MAX_DURATION_MS),
      })
      if (!alive.current || lockedRef.current) return
      if (res.transcript.trim() === '') {
        focusNext.current = 'mic'
        setState({ s: 'empty' })
        return
      }
      setState({ s: 'done', transcript: res.transcript })
      onResponse({ kind: 'audio', transcript: res.transcript, token: res.token })
    } catch (e) {
      if (!alive.current || lockedRef.current) return
      fail(e instanceof SpeechError ? e.code : 'unavailable')
    }
  }, [speech, challenge.index, onResponse, fail])

  const start = async () => {
    if (locked || state.s === 'starting' || state.s === 'transcribing') return
    if (state.s === 'error' && BLOCKING.has(state.problem)) return
    if (!speech) {
      fail('no_service')
      return
    }
    if (response !== null) onResponse(null)
    setState({ s: 'starting' })
    try {
      const active = await startRecording()
      if (!alive.current || lockedRef.current) {
        active.cancel()
        return
      }
      recording.current = active
      setElapsed(0)
      setState({ s: 'recording', startedAt: performance.now() })
    } catch (e) {
      if (!alive.current) return
      fail(e instanceof MicrophoneError ? e.problem : 'unavailable')
    }
  }

  // While recording: the elapsed time, the level meter and the time limit.
  const stopRef = useRef(stop)
  useEffect(() => {
    stopRef.current = stop
  }, [stop])
  const recordingSince = state.s === 'recording' ? state.startedAt : null
  useEffect(() => {
    if (recordingSince === null) return
    const id = setInterval(() => {
      const ms = performance.now() - recordingSince
      setElapsed(ms)
      if (!reduce) setLevel(recording.current?.level() ?? 0)
      if (ms >= AUTO_STOP_MS) void stopRef.current()
    }, TICK_MS)
    return () => clearInterval(id)
  }, [recordingSince, reduce])

  const onMic = () => {
    if (state.s === 'recording') void stop()
    else void start()
  }

  const tryAgain = () => {
    if (locked) return
    onResponse(null)
    focusNext.current = 'mic'
    setState({ s: 'idle' })
  }

  // A declined answer submits itself once the player holds it (like LetterTrace).
  const submitted = useRef(false)
  const declined = response?.kind === 'audio' && response.declined === true
  useEffect(() => {
    if (!declined || locked || submitted.current) return
    submitted.current = true
    onSubmit()
  }, [declined, locked, onSubmit])

  const decline = () => {
    if (locked) return
    recording.current?.cancel()
    recording.current = null
    speech?.pauseSpeaking()
    setState({ s: 'idle' })
    onResponse({ kind: 'audio', transcript: '', declined: true })
  }

  const busy = state.s === 'starting' || state.s === 'transcribing'
  const blocked = state.s === 'error' && BLOCKING.has(state.problem)
  const micInert = locked || busy || blocked || state.s === 'done'
  const isRecording = state.s === 'recording'

  let status: string
  let tone: 'info' | 'error' = 'info'
  switch (state.s) {
    case 'idle':
      status = locked ? '' : 'Tap the microphone and say the sentence.'
      break
    case 'starting':
      status = 'Starting the microphone…'
      break
    case 'recording':
      status = 'Listening… tap the button again when you are done.'
      break
    case 'transcribing':
      status = 'Checking what you said…'
      break
    case 'done':
      status = ''
      break
    case 'empty':
      status = "We didn't catch that. Try again."
      tone = 'error'
      break
    case 'error':
      status = message(state.problem)
      tone = 'error'
      break
  }

  return (
    <ChallengeFrame type={challenge.type} display={display} heading="Speak this sentence">
      <div>
        <FaPrompt dto={challenge.prompt} display={display} audio={audio} label="Sentence" />
        {challenge.translation !== undefined && (
          <p className={styles.translation} lang="en">
            {challenge.translation}
          </p>
        )}
      </div>

      <div className={styles.recorder}>
        {state.s !== 'done' && (
          <button
            ref={micRef}
            type="button"
            className={styles.mic}
            data-state={isRecording ? 'recording' : state.s}
            data-testid="speak-mic"
            aria-label={isRecording ? 'Stop recording' : 'Start recording'}
            aria-disabled={micInert || undefined}
            aria-busy={busy || undefined}
            onClick={micInert ? undefined : onMic}
          >
            {isRecording ? <StopIcon /> : <MicIcon />}
          </button>
        )}
        {isRecording && (
          <div className={styles.meterRow} data-testid="speak-recording">
            <span className={styles.dot} data-reduce={reduce ? 'true' : undefined} aria-hidden />
            {!reduce && (
              <span className={styles.meter} aria-hidden="true">
                <span
                  className={styles.meterFill}
                  data-testid="speak-meter"
                  style={{ transform: `scaleX(${level.toFixed(2)})` }}
                />
              </span>
            )}
            <span className={styles.elapsed}>
              {clock(elapsed)} / {clock(MAX_DURATION_MS)}
            </span>
          </div>
        )}
        <p
          className={styles.status}
          role="status"
          data-tone={tone}
          data-testid="speak-status"
          data-state={state.s === 'error' ? state.problem : state.s}
        >
          {status}
        </p>
      </div>

      {state.s === 'done' && (
        <div className={styles.said} data-state={graded} data-testid="speak-transcript">
          <p className={styles.saidLabel} lang="en">
            You said
          </p>
          <FaText as="p" text={state.transcript} size="lg" />
        </div>
      )}

      <div className={styles.actions}>
        {state.s === 'done' && (
          <Button3D variant={locked ? 'locked' : 'ghost'} onClick={tryAgain}>
            Try again
          </Button3D>
        )}
        <Button3D
          ref={declineRef}
          variant={locked ? 'locked' : 'ghost'}
          onClick={decline}
          data-testid="speak-decline"
        >
          {DECLINE}
        </Button3D>
      </div>
    </ChallengeFrame>
  )
}
