/**
 * Browser fakes for the speak tests (orchestrator-owned, Wave 4). Call them before navigating:
 *
 *   await fakeMicrophone(page, 'من آب می‌خوام')         // every recording "says" this
 *   await fakeMicrophone(page, ['نون', 'من آب می‌خوام'])  // one per recording; the last repeats
 *   await denyMicrophone(page)                           // the learner refuses the microphone
 *
 * `fakeMicrophone` replaces `navigator.mediaDevices.getUserMedia` (a silent stream) and
 * `MediaRecorder`: a recording captures nothing, and `stop()` emits one `dataavailable` Blob whose
 * bytes are TEST_TRANSCRIPT_PREFIX + the transcript (UTF-8), then `stop`. In AUTH_MODE=local the
 * transcribe route reads such an upload as that transcript without calling a provider.
 * `denyMicrophone` makes `getUserMedia` reject with a `NotAllowedError`. Both also answer
 * `navigator.permissions.query({ name: 'microphone' })` (granted / denied).
 */
import type { Page } from '@playwright/test'

/** Must match TEST_TRANSCRIPT_PREFIX in @zaboon/contracts. */
export const TEST_TRANSCRIPT_PREFIX = 'zaboon-test-transcript:'

interface MicrophoneConfig {
  mode: 'fake' | 'deny'
  prefix: string
  transcripts: string[]
}

/** Runs in the page before any script (serialized by Playwright: no outer references). */
function installMicrophone({ mode, prefix, transcripts }: MicrophoneConfig): void {
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
      const data = new Blob([nextUtterance()], { type: this.mimeType })
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

/** The learner refuses the microphone: `getUserMedia` rejects with a `NotAllowedError`. */
export async function denyMicrophone(page: Page): Promise<void> {
  const config: MicrophoneConfig = { mode: 'deny', prefix: TEST_TRANSCRIPT_PREFIX, transcripts: [] }
  await page.addInitScript(installMicrophone, config)
}
