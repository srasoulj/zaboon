/**
 * Microphone recording for the speak renderer: getUserMedia + MediaRecorder, with an optional
 * level meter (Web Audio AnalyserNode). MediaRecorder records what the browser can (webm/opus in
 * Chrome and Firefox, else mp4/AAC in Safari, else wav or mp3), and `stop()` converts it to the
 * upload format: a 16 kHz mono 16-bit PCM WAV cut at the time limit (lib/speech/convert.ts). Every
 * track is stopped when the recording ends or is cancelled; the recorded chunks are handed over
 * once and not kept.
 */
import { DEFAULT_APP_CONFIG, type SpeechAudioFormat } from '@zaboon/contracts'
import { offlineContextCtor, toUploadWav } from './convert'

/** Why recording could not start. */
export type MicrophoneProblem = 'unsupported' | 'denied' | 'unavailable'

export class MicrophoneError extends Error {
  constructor(
    readonly problem: MicrophoneProblem,
    message: string,
  ) {
    super(message)
    this.name = 'MicrophoneError'
  }
}

/** MediaRecorder MIME types in order of preference, with the upload format each one is. */
export const RECORDING_TYPES: readonly (readonly [string, SpeechAudioFormat])[] = [
  ['audio/webm;codecs=opus', 'webm'],
  ['audio/webm', 'webm'],
  ['audio/mp4', 'm4a'],
  ['audio/mp4;codecs=mp4a.40.2', 'm4a'],
  ['audio/aac', 'm4a'],
  ['audio/wav', 'wav'],
  ['audio/mpeg', 'mp3'],
]

/** The container a recorder's actual MIME type records (empty/unknown → webm, the common case). */
export function formatOfMime(mime: string): SpeechAudioFormat {
  const m = mime.toLowerCase()
  if (m.includes('mp4') || m.includes('aac') || m.includes('m4a')) return 'm4a'
  if (m.includes('wav')) return 'wav'
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
  return 'webm'
}

/**
 * The MIME type to ask MediaRecorder for, or null to let it choose (no `isTypeSupported`, or none
 * of ours is supported).
 */
export function pickRecordingType(
  isTypeSupported: ((type: string) => boolean) | undefined,
): { mimeType: string; format: SpeechAudioFormat } | null {
  if (typeof isTypeSupported !== 'function') return null
  for (const [mimeType, format] of RECORDING_TYPES) {
    try {
      if (isTypeSupported(mimeType)) return { mimeType, format }
    } catch {
      // A throwing check counts as unsupported.
    }
  }
  return null
}

/**
 * True when this browser can record at all (it may still refuse the permission): the microphone,
 * MediaRecorder, and Web Audio to convert the recording.
 */
export function canRecord(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof globalThis.MediaRecorder === 'function' &&
    offlineContextCtor() !== null
  )
}

export interface Recording {
  /** The upload: a 16 kHz mono WAV (empty when the browser could not decode the recording). */
  blob: Blob
  format: SpeechAudioFormat
  /** The upload's own length (at most `maxDurationMs`). */
  durationMs: number
}

export interface ActiveRecording {
  /** Ends the recording and resolves with the audio (tracks are stopped either way). */
  stop(): Promise<Recording>
  /** Ends the recording and throws the audio away. */
  cancel(): void
  /** 0..1 input level right now (0 without Web Audio). */
  level(): number
}

type AudioContextCtor = new () => AudioContext

function audioContextCtor(): AudioContextCtor | null {
  const g = globalThis as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
  return g.AudioContext ?? g.webkitAudioContext ?? null
}

function meterFor(stream: MediaStream): { level(): number; close(): void } {
  const none = { level: () => 0, close: () => {} }
  const Ctor = audioContextCtor()
  if (!Ctor) return none
  try {
    const ctx = new Ctor()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    const data = new Uint8Array(analyser.fftSize)
    return {
      level() {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (const v of data) {
          const x = (v - 128) / 128
          sum += x * x
        }
        // RMS of speech sits well below 1; scale so normal speech fills most of the meter.
        return Math.min(1, Math.sqrt(sum / data.length) * 4)
      },
      close() {
        try {
          source.disconnect()
        } catch {
          // already disconnected
        }
        void ctx.close().catch(() => {})
      },
    }
  } catch {
    return none
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop()
    } catch {
      // a track that can't stop is already gone
    }
  }
}

/** Asks for the microphone and starts recording. Throws a `MicrophoneError`. */
export async function startRecording(
  opts: { now?: () => number; meter?: boolean; maxDurationMs?: number } = {},
): Promise<ActiveRecording> {
  const now = opts.now ?? (() => performance.now())
  const maxDurationMs = opts.maxDurationMs ?? DEFAULT_APP_CONFIG.speech.maxDurationMs
  if (!canRecord()) throw new MicrophoneError('unsupported', 'This browser cannot record audio')
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (e) {
    const name = e instanceof Error || e instanceof DOMException ? e.name : ''
    throw new MicrophoneError(
      name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable',
      e instanceof Error ? e.message : 'microphone unavailable',
    )
  }

  let recorder: MediaRecorder
  const picked = pickRecordingType(MediaRecorder.isTypeSupported?.bind(MediaRecorder))
  try {
    recorder = picked
      ? new MediaRecorder(stream, { mimeType: picked.mimeType })
      : new MediaRecorder(stream)
  } catch (e) {
    stopTracks(stream)
    throw new MicrophoneError('unsupported', e instanceof Error ? e.message : 'cannot record')
  }
  const meter = opts.meter === false ? { level: () => 0, close: () => {} } : meterFor(stream)
  let chunks: Blob[] = []
  recorder.addEventListener('dataavailable', (e) => {
    const data = (e as BlobEvent).data
    if (data && data.size > 0) chunks.push(data)
  })
  const stopped = new Promise<void>((resolve) =>
    recorder.addEventListener('stop', () => resolve(), { once: true }),
  )
  const release = () => {
    meter.close()
    stopTracks(stream)
  }
  try {
    recorder.start()
  } catch (e) {
    release()
    throw new MicrophoneError('unavailable', e instanceof Error ? e.message : 'cannot record')
  }
  const startedAt = now()
  let ended = false

  return {
    async stop() {
      if (ended) throw new MicrophoneError('unavailable', 'recording already ended')
      ended = true
      const timerMs = Math.max(0, now() - startedAt)
      try {
        if (recorder.state !== 'inactive') recorder.stop()
        await stopped
      } finally {
        release()
      }
      const mime = recorder.mimeType || picked?.mimeType || chunks[0]?.type || ''
      const recorded = new Blob(chunks, mime ? { type: mime } : undefined)
      chunks = []
      const upload = await toUploadWav(recorded, { maxDurationMs, timerMs })
      return { blob: upload.blob, format: 'wav', durationMs: upload.durationMs }
    },
    cancel() {
      if (ended) return
      ended = true
      try {
        if (recorder.state !== 'inactive') recorder.stop()
      } catch {
        // stopping a dead recorder
      }
      chunks = []
      release()
    },
    level: () => (ended ? 0 : meter.level()),
  }
}
