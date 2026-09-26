/**
 * Browser fakes for the speak tests (orchestrator-owned, Wave 4). Call them before navigating:
 *
 *   await fakeMicrophone(page, 'من آب می‌خوام')         // every recording "says" this
 *   await fakeMicrophone(page, ['نون', 'من آب می‌خوام'])  // one per recording; the last repeats
 *   await denyMicrophone(page)                           // the learner refuses the microphone
 *   await fakeMicrophoneTone(page)                       // every recording is real audio (a tone)
 *
 * `fakeMicrophone` replaces `navigator.mediaDevices.getUserMedia` (a silent stream) and
 * `MediaRecorder`: a recording captures nothing, and `stop()` emits one `dataavailable` Blob whose
 * bytes are TEST_TRANSCRIPT_PREFIX + the transcript (UTF-8), then `stop`. The app uploads such a
 * recording as it is, and in AUTH_MODE=local the transcribe route reads it as that transcript
 * without calling a provider. `fakeMicrophoneTone` emits real audio instead (a 16-bit PCM WAV of a
 * tone), so the app's own conversion (decode, resample to 16 kHz, mix down to mono) runs.
 * `denyMicrophone` makes `getUserMedia` reject with a `NotAllowedError`. Both also answer
 * `navigator.permissions.query({ name: 'microphone' })` (granted / denied).
 */
import type { Page } from '@playwright/test'

/** Must match TEST_TRANSCRIPT_PREFIX in @zaboon/contracts. */
export const TEST_TRANSCRIPT_PREFIX = 'zaboon-test-transcript:'

export interface ToneOptions {
  seconds: number
  sampleRate: number
  channels: number
  hz: number
}

interface MicrophoneConfig {
  mode: 'fake' | 'deny'
  prefix: string
  transcripts: string[]
  /** Record real audio (a sine tone as a 16-bit PCM WAV) instead of a scripted transcript. */
  tone?: ToneOptions
}

/** Runs in the page before any script (serialized by Playwright: no outer references). */
function installMicrophone({ mode, prefix, transcripts, tone }: MicrophoneConfig): void {
  const permissions = navigator.permissions as Permissions | undefined
  if (permissions?.query) {
    const query = permissions.query.bind(permissions)
    const state: PermissionState = mode === 'fake' ? 'granted' : 'denied'
    permissions.query = (descriptor: PermissionDescriptor) =>
      (descriptor as { name?: string }).name === 'microphone'
        ? Promise.resolve(
            Object.assign(new EventTarget(), {
              name: 'microphone',
              state,
              onchange: null,
            }) as unknown as PermissionStatus,
          )
        : query(descriptor)
  }

  let mediaDevices = navigator.mediaDevices as MediaDevices | undefined
  if (!mediaDevices) {
    mediaDevices = {} as MediaDevices
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices })
  }
  Object.defineProperty(mediaDevices, 'getUserMedia', {
    configurable: true,
    writable: true,
    value: async (): Promise<MediaStream> => {
      if (mode === 'deny') throw new DOMException('Permission denied', 'NotAllowedError')
      try {
        return new AudioContext().createMediaStreamDestination().stream
      } catch {
        return new MediaStream()
      }
    },
  })
  if (mode === 'deny') return

  let recordings = 0
  const nextUtterance = (): string => {
    const transcript = transcripts[Math.min(recordings, transcripts.length - 1)] ?? ''
    recordings += 1
    return `${prefix}${transcript}`
  }

  /** `tone` as a 16-bit PCM WAV: a sine at half amplitude, the same on every channel. */
  const toneWav = ({ seconds, sampleRate, channels, hz }: ToneOptions): ArrayBuffer => {
    const frames = Math.round(seconds * sampleRate)
    const dataBytes = frames * channels * 2
    const buffer = new ArrayBuffer(44 + dataBytes)
    const view = new DataView(buffer)
    const tag = (offset: number, text: string) => {
      for (let i = 0; i < 4; i++) view.setUint8(offset + i, text.charCodeAt(i))
    }
    tag(0, 'RIFF')
    view.setUint32(4, 36 + dataBytes, true)
    tag(8, 'WAVE')
    tag(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, channels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * channels * 2, true)
    view.setUint16(32, channels * 2, true)
    view.setUint16(34, 16, true)
    tag(36, 'data')
    view.setUint32(40, dataBytes, true)
    for (let f = 0; f < frames; f++) {
      const x = Math.round(Math.sin((2 * Math.PI * hz * f) / sampleRate) * 0.5 * 0x7fff)
      for (let c = 0; c < channels; c++) view.setInt16(44 + (f * channels + c) * 2, x, true)
    }
    return buffer
  }

  type Handler = ((event: Event) => void) | null
  class FakeMediaRecorder extends EventTarget {
    static isTypeSupported(type: string): boolean {
      return /^audio\/(webm|mp4|wav|mpeg)(;|$)/i.test(type)
    }

    readonly stream: MediaStream
    readonly mimeType: string
    readonly audioBitsPerSecond = 128_000
    readonly videoBitsPerSecond = 0
    state: RecordingState = 'inactive'
    ondataavailable: Handler = null
    onstart: Handler = null
    onstop: Handler = null
    onpause: Handler = null
    onresume: Handler = null
    onerror: Handler = null

    constructor(stream: MediaStream, options?: MediaRecorderOptions) {
      super()
      this.stream = stream
      this.mimeType = options?.mimeType || 'audio/webm'
    }

    fire(type: 'dataavailable' | 'start' | 'stop' | 'pause' | 'resume', event: Event): void {
      this.dispatchEvent(event)
      this[`on${type}`]?.call(this, event)
    }

    later(type: 'start' | 'stop' | 'pause' | 'resume'): void {
      setTimeout(() => this.fire(type, new Event(type)), 0)
    }

    start(): void {
      if (this.state !== 'inactive')
        throw new DOMException('The recorder is already recording.', 'InvalidStateError')
      this.state = 'recording'
      this.later('start')
    }

    stop(): void {
      if (this.state === 'inactive') return
      this.state = 'inactive'
      const data = new Blob([tone ? toneWav(tone) : nextUtterance()], { type: this.mimeType })
      setTimeout(() => {
        const event =
          typeof BlobEvent === 'function'
            ? new BlobEvent('dataavailable', { data })
            : Object.assign(new Event('dataavailable'), { data })
        this.fire('dataavailable', event)
        this.fire('stop', new Event('stop'))
      }, 0)
    }

    pause(): void {
      if (this.state !== 'recording') return
      this.state = 'paused'
      this.later('pause')
    }

    resume(): void {
      if (this.state !== 'paused') return
      this.state = 'recording'
      this.later('resume')
    }

    /** Nothing is buffered: the whole recording arrives with `stop()`. */
    requestData(): void {}
  }
  Object.defineProperty(window, 'MediaRecorder', {
    configurable: true,
    writable: true,
    value: FakeMediaRecorder,
  })
}

/**
 * Every recording in this page "says" `transcript` (a list: one per recording, in order, the last
 * repeating). Call before navigating.
 */
export async function fakeMicrophone(
  page: Page,
  transcript: string | readonly string[],
): Promise<void> {
  const transcripts = typeof transcript === 'string' ? [transcript] : [...transcript]
  if (transcripts.length === 0) throw new Error('fakeMicrophone needs at least one transcript')
  const config: MicrophoneConfig = { mode: 'fake', prefix: TEST_TRANSCRIPT_PREFIX, transcripts }
  await page.addInitScript(installMicrophone, config)
}

/**
 * Every recording in this page is real audio: a tone as a 16-bit PCM WAV (by default 1.5 s of
 * 440 Hz at 44.1 kHz, stereo), which the app decodes, resamples and mixes down itself before the
 * upload. The transcribe route can't read it without a provider, so tests intercept the request.
 * Call before navigating.
 */
export async function fakeMicrophoneTone(
  page: Page,
  tone: Partial<ToneOptions> = {},
): Promise<void> {
  const config: MicrophoneConfig = {
    mode: 'fake',
    prefix: TEST_TRANSCRIPT_PREFIX,
    transcripts: [],
    tone: { seconds: 1.5, sampleRate: 44_100, channels: 2, hz: 440, ...tone },
  }
  await page.addInitScript(installMicrophone, config)
}

/** The learner refuses the microphone: `getUserMedia` rejects with a `NotAllowedError`. */
export async function denyMicrophone(page: Page): Promise<void> {
  const config: MicrophoneConfig = { mode: 'deny', prefix: TEST_TRANSCRIPT_PREFIX, transcripts: [] }
  await page.addInitScript(installMicrophone, config)
}
