/**
 * The speak renderer with a fake SpeechService and a fake microphone (getUserMedia +
 * MediaRecorder, and an OfflineAudioContext that decodes every recording to 1 s of audio):
 * recording, conversion to the WAV upload, transcription, grading of the draft, "Can't speak now",
 * and the microphone/quota/outage fallbacks.
 */
import { act, screen, waitFor } from '@testing-library/react'
import { Challenge, type ChallengeOf, type TranscribeResponse } from '@zaboon/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderChallenge, tabTo } from '@/components/challenges/testing'
import { SpeechError, type SpeechService, type TranscribeInput } from '@/lib/speech/service'
// Built by the engine from content/fixtures (speak-fixture.test.ts keeps it in sync).
import recorded from './speak-fixture.json'

// The renderer registry's props have no speech field (yet): the player provides it by context.
let service: SpeechService | null = null
vi.mock('@/lib/speech/context', () => ({
  useSpeechService: () => service,
  SpeechServiceProvider: ({ children }: { children: unknown }) => children,
}))

const c = Challenge.parse(recorded[0]) as ChallengeOf<'speak'>
const SAID = c.prompt.fa

// ------------------------------------------------------------------------------ fake microphone
const trackStop = vi.fn()
let recorders: FakeRecorder[] = []

class FakeRecorder extends EventTarget {
  static isTypeSupported = (type: string) => /^audio\/webm/.test(type)
  state: RecordingState = 'inactive'
  readonly mimeType: string
  constructor(
    readonly stream: MediaStream,
    options?: MediaRecorderOptions,
  ) {
    super()
    this.mimeType = options?.mimeType ?? 'audio/webm'
    recorders.push(this)
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    setTimeout(() => {
      const e = Object.assign(new Event('dataavailable'), {
        data: new Blob(['voice'], { type: this.mimeType }),
      })
      this.dispatchEvent(e)
      this.dispatchEvent(new Event('stop'))
    }, 0)
  }
}

/** Web Audio's decoder: every recording is 1 s of a quiet tone at the context's rate. */
class FakeOfflineContext {
  constructor(
    readonly channels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {}
  decodeAudioData(): Promise<AudioBuffer> {
    const samples = new Float32Array(this.sampleRate).fill(0.25)
    return Promise.resolve({
      numberOfChannels: 1,
      length: samples.length,
      getChannelData: () => samples,
    } as unknown as AudioBuffer)
  }
}

function installMicrophone(getUserMedia: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(getUserMedia) },
  })
  Object.defineProperty(globalThis, 'MediaRecorder', {
    configurable: true,
    writable: true,
    value: FakeRecorder,
  })
  Object.defineProperty(globalThis, 'OfflineAudioContext', {
    configurable: true,
    writable: true,
    value: FakeOfflineContext,
  })
}

const stream = () => ({ getTracks: () => [{ stop: trackStop }] }) as unknown as MediaStream

function fakeService(transcribe: (input: TranscribeInput) => Promise<TranscribeResponse>) {
  const s = {
    transcribe: vi.fn(transcribe),
    pauseSpeaking: vi.fn<() => void>(),
  }
  service = s
  return s
}

const says = (transcript: string) =>
  fakeService(async () => ({ transcript, token: `token:${transcript}`, remaining: 10 }))

const mic = () => screen.getByTestId('speak-mic')
const status = () => screen.getByTestId('speak-status')
const decline = () => screen.getByRole('button', { name: "Can't speak now" })

beforeEach(() => {
  recorders = []
  trackStop.mockClear()
  installMicrophone(async () => stream())
})
afterEach(() => {
  service = null
})

/** Starts a recording, stops it and waits for the transcription to settle. */
async function record(h: ReturnType<typeof renderChallenge>) {
  await h.user.click(screen.getByRole('button', { name: 'Start recording' }))
  await h.user.click(await screen.findByRole('button', { name: 'Stop recording' }))
}

describe('speak', () => {
  it('shows the Persian prompt (lang fa, rtl), its English meaning and real buttons', () => {
    says(SAID)
    const h = renderChallenge(c, { display: { transliteration: true } })
    expect(screen.getByRole('heading', { name: 'Speak this sentence' })).toBeInTheDocument()
    const sentence = screen.getByRole('group', { name: 'Sentence' })
    expect(sentence.querySelector('[lang="fa"]')).toHaveAttribute('dir', 'rtl')
    expect(sentence).toHaveTextContent(c.prompt.fa.split(' ')[0]!)
    expect(c.translation).toBeTruthy()
    expect(screen.getByText(c.translation!)).toHaveAttribute('lang', 'en')
    expect(mic().tagName).toBe('BUTTON')
    expect(mic()).toHaveAccessibleName('Start recording')
    expect(decline().tagName).toBe('BUTTON')
    for (const el of h.container.querySelectorAll('[lang="fa"]'))
      expect(el).toHaveAttribute('dir', 'rtl')
  })

  it('records, transcribes and reports {audio, transcript, token}: the right sentence grades correct', async () => {
    const s = says(SAID)
    const h = renderChallenge(c)
    await record(h)
    const said = await screen.findByTestId('speak-transcript')
    expect(said.querySelector('[lang="fa"]')).toHaveAttribute('dir', 'rtl')
    expect(said).toHaveTextContent(SAID.split(' ')[0]!)
    expect(h.last()).toEqual({ kind: 'audio', transcript: SAID, token: `token:${SAID}` })
    expect(h.verdict()).toBe('correct')
    expect(s.transcribe).toHaveBeenCalledTimes(1)
    const input = s.transcribe.mock.calls[0]![0]
    // MediaRecorder records webm/opus; the upload is always the converted 16 kHz mono WAV, and its
    // duration is the audio's own length.
    expect(recorders[0]!.mimeType).toBe('audio/webm;codecs=opus')
    expect(input).toMatchObject({ index: c.index, format: 'wav', durationMs: 1000 })
    expect(input.blob.type).toBe('audio/wav')
    expect(input.blob.size).toBe(44 + 16_000 * 2)
    // The microphone is released once the recording ends.
    expect(trackStop).toHaveBeenCalled()
    expect(h.onSubmit).not.toHaveBeenCalled()
  })

  it('a different sentence grades wrong', async () => {
    says('خداحافظ')
    const h = renderChallenge(c)
    await record(h)
    await screen.findByTestId('speak-transcript')
    expect(h.last()).toMatchObject({ kind: 'audio', transcript: 'خداحافظ' })
    expect(h.verdict()).toBe('wrong')
  })

  it('shows the recording state (stop button, elapsed time) while recording', async () => {
    says(SAID)
    const h = renderChallenge(c)
    await h.user.click(mic())
    expect(await screen.findByRole('button', { name: 'Stop recording' })).toBe(mic())
    const rec = screen.getByTestId('speak-recording')
    expect(rec).toHaveTextContent(/0:0\d \/ 0:15/)
    expect(screen.getByTestId('speak-meter')).toBeInTheDocument()
    expect(status()).toHaveTextContent('Listening')
  })

  it('reduced motion: no live level meter', async () => {
    says(SAID)
    const h = renderChallenge(c, { display: { reducedMotion: true } })
    await h.user.click(mic())
    await screen.findByTestId('speak-recording')
    expect(screen.queryByTestId('speak-meter')).toBeNull()
  })

  it('an empty transcript is no draft: "didn\'t catch that", try again', async () => {
    says('  ')
    const h = renderChallenge(c)
    await record(h)
    await waitFor(() => expect(status()).toHaveTextContent("We didn't catch that"))
    expect(h.last()).toBeNull()
    expect(screen.queryByTestId('speak-transcript')).toBeNull()
    expect(mic()).toHaveFocus()
    expect(mic()).not.toHaveAttribute('aria-disabled')
  })

  it('"Try again" clears the draft and records anew', async () => {
    const s = fakeService(
      vi
        .fn<(i: TranscribeInput) => Promise<TranscribeResponse>>()
        .mockResolvedValueOnce({ transcript: 'خداحافظ', token: 't1', remaining: 2 })
        .mockResolvedValueOnce({ transcript: SAID, token: 't2', remaining: 1 }),
    )
    const h = renderChallenge(c)
    await record(h)
    await screen.findByTestId('speak-transcript')
    await h.user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(h.last()).toBeNull()
    expect(mic()).toHaveFocus()
    await record(h)
    await screen.findByTestId('speak-transcript')
    expect(h.last()).toEqual({ kind: 'audio', transcript: SAID, token: 't2' })
    expect(s.transcribe).toHaveBeenCalledTimes(2)
  })

  it('"Can\'t speak now" pauses speaking, reports a declined answer and submits it (correct)', async () => {
    const s = says(SAID)
    const h = renderChallenge(c)
    await h.user.click(decline())
    expect(s.pauseSpeaking).toHaveBeenCalledTimes(1)
    expect(h.last()).toEqual({ kind: 'audio', transcript: '', declined: true })
    expect(h.verdict()).toBe('correct')
    expect(h.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('keyboard only: Tab to the microphone and "Can\'t speak now"', async () => {
    says(SAID)
    const h = renderChallenge(c)
    await tabTo(h.user, mic())
    await h.user.keyboard('{Enter}')
    expect(await screen.findByRole('button', { name: 'Stop recording' })).toHaveFocus()
    await h.user.keyboard('{Enter}')
    await screen.findByTestId('speak-transcript')
    expect(h.verdict()).toBe('correct')
    await tabTo(h.user, decline())
    await h.user.keyboard('{Enter}')
    expect(h.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('a denied microphone: a clear message, and "Can\'t speak now" (focused) goes on', async () => {
    installMicrophone(() => Promise.reject(new DOMException('denied', 'NotAllowedError')))
    const s = says(SAID)
    const h = renderChallenge(c)
    await h.user.click(mic())
    await waitFor(() => expect(status()).toHaveTextContent('Microphone unavailable'))
    expect(status()).toHaveAttribute('data-state', 'denied')
    expect(decline()).toHaveFocus()
    expect(mic()).toHaveAttribute('aria-disabled', 'true')
    await h.user.keyboard('{Enter}')
    expect(s.pauseSpeaking).toHaveBeenCalledTimes(1)
    expect(h.onSubmit).toHaveBeenCalledTimes(1)
    expect(s.transcribe).not.toHaveBeenCalled()
  })

  it('no microphone support at all (no mediaDevices / MediaRecorder): the same fallback', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    says(SAID)
    const h = renderChallenge(c)
    await h.user.click(mic())
    await waitFor(() => expect(status()).toHaveTextContent('Microphone unavailable'))
    expect(status()).toHaveAttribute('data-state', 'unsupported')
    expect(decline()).toHaveFocus()
  })

  it('the daily quota (429): a message and the fallback', async () => {
    fakeService(() => Promise.reject(new SpeechError('quota_exceeded', 'quota')))
    const h = renderChallenge(c)
    await record(h)
    await waitFor(() => expect(status()).toHaveTextContent("You've used today's speaking practice"))
    expect(decline()).toHaveFocus()
    expect(h.last()).toBeNull()
  })

  it('speech down (503): "Speech is unavailable right now" and the fallback', async () => {
    fakeService(() => Promise.reject(new SpeechError('unavailable', 'down')))
    const h = renderChallenge(c)
    await record(h)
    await waitFor(() => expect(status()).toHaveTextContent('Speech is unavailable right now'))
    expect(decline()).toHaveFocus()
  })

  it('a dropped connection can be retried', async () => {
    const s = fakeService(
      vi
        .fn<(i: TranscribeInput) => Promise<TranscribeResponse>>()
        .mockRejectedValueOnce(new SpeechError('network', 'offline'))
        .mockResolvedValueOnce({ transcript: SAID, token: 't', remaining: 1 }),
    )
    const h = renderChallenge(c)
    await record(h)
    await waitFor(() => expect(status()).toHaveTextContent('The connection dropped'))
    await record(h)
    await screen.findByTestId('speak-transcript')
    expect(h.verdict()).toBe('correct')
    expect(s.transcribe).toHaveBeenCalledTimes(2)
  })

  it('without a speech service (outside the player): only "Can\'t speak now"', async () => {
    const h = renderChallenge(c)
    await h.user.click(mic())
    expect(status()).toHaveTextContent('Speech is unavailable right now')
    await h.user.click(decline())
    expect(h.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('locks in feedback: the transcript stays, buttons do nothing', async () => {
    const s = says(SAID)
    const h = renderChallenge(c)
    await record(h)
    await screen.findByTestId('speak-transcript')
    h.check()
    const before = h.onResponse.mock.calls.length
    await h.user.click(screen.getByRole('button', { name: 'Try again' }))
    await h.user.click(decline())
    expect(h.onResponse.mock.calls.length).toBe(before)
    expect(h.onSubmit).not.toHaveBeenCalled()
    expect(s.pauseSpeaking).not.toHaveBeenCalled()
    expect(screen.getByTestId('speak-transcript')).toHaveAttribute('data-state', 'correct')
  })

  it('feedback rendered directly with a transcript shows it', () => {
    says(SAID)
    renderChallenge(c, {
      phase: 'feedback',
      response: { kind: 'audio', transcript: 'خداحافظ', token: 't' },
    })
    expect(screen.getByTestId('speak-transcript')).toHaveAttribute('data-state', 'wrong')
    expect(screen.queryByTestId('speak-mic')).toBeNull()
  })

  it('SKIP while a recording is being transcribed: no stuck "Checking…", and the late result is ignored', async () => {
    let answer: (r: TranscribeResponse) => void = () => {}
    fakeService(() => new Promise((resolve) => (answer = resolve)))
    const h = renderChallenge(c)
    await record(h)
    await waitFor(() => expect(status()).toHaveAttribute('data-state', 'transcribing'))
    h.check()
    await waitFor(() =>
      expect(screen.queryByTestId('speak-status')).not.toHaveAttribute(
        'data-state',
        'transcribing',
      ),
    )
    expect(screen.getByTestId('speak-mic')).not.toHaveAttribute('aria-busy')
    const before = h.onResponse.mock.calls.length
    await act(async () => answer({ transcript: SAID, token: `token:${SAID}`, remaining: 9 }))
    expect(h.onResponse.mock.calls.length).toBe(before)
    expect(screen.queryByTestId('speak-transcript')).toBeNull()
  })

  it('a browser without Web Audio (no OfflineAudioContext) gets the "cannot record" fallback', async () => {
    Object.defineProperty(globalThis, 'OfflineAudioContext', {
      configurable: true,
      writable: true,
      value: undefined,
    })
    says(SAID)
    const h = renderChallenge(c)
    await h.user.click(mic())
    await waitFor(() => expect(status()).toHaveAttribute('data-state', 'unsupported'))
    expect(decline()).toHaveFocus()
  })

  it('unmounting while recording releases the microphone and sends nothing', async () => {
    const s = says(SAID)
    const h = renderChallenge(c)
    await h.user.click(mic())
    await screen.findByRole('button', { name: 'Stop recording' })
    h.unmount()
    expect(trackStop).toHaveBeenCalled()
    await act(() => new Promise((r) => setTimeout(r, 5)))
    expect(s.transcribe).not.toHaveBeenCalled()
  })
})
