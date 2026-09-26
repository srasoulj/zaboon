/**
 * A recording → the upload (P2 speak): a 16 kHz mono 16-bit PCM WAV (lib/speech/wav.ts), the only
 * format both the transcription model accepts and the server can measure.
 *
 * MediaRecorder records what the browser can (webm/opus in Chrome and Firefox, mp4/AAC in
 * Safari). Web Audio decodes it: an OfflineAudioContext at 16 kHz resamples while it decodes. The
 * channels are mixed down to mono, and the result is cut at the time limit, so an upload is never
 * longer than AppConfig.speech.maxDurationMs, even when a background tab's timers stopped the
 * recording late.
 *
 * e2e only: a recording from the fake microphone (e2e/fixtures/browser-fakes.ts) is
 * TEST_TRANSCRIPT_PREFIX + a scripted transcript, not audio. It goes up as it is. The server reads
 * such bytes as that transcript in AUTH_MODE=local only; anywhere else it refuses them, because they
 * are not a WAV.
 */
import { TEST_TRANSCRIPT_PREFIX } from '@zaboon/contracts'
import { encodeWav, WAV_SAMPLE_RATE } from './wav'

/** The part of an AudioBuffer the conversion reads. */
export interface DecodedAudio {
  readonly numberOfChannels: number
  readonly length: number
  getChannelData(channel: number): Float32Array
}

/** The part of an OfflineAudioContext the conversion needs. */
export interface DecodingContext {
  decodeAudioData(
    data: ArrayBuffer,
    success?: (buffer: AudioBuffer) => void,
    failure?: (error: DOMException) => void,
  ): Promise<AudioBuffer> | undefined
}

export type DecodingContextCtor = new (
  channels: number,
  length: number,
  sampleRate: number,
) => DecodingContext

/** The browser's OfflineAudioContext, or null (no Web Audio: speak can't record). */
export function offlineContextCtor(): DecodingContextCtor | null {
  const g = globalThis as {
    OfflineAudioContext?: DecodingContextCtor
    webkitOfflineAudioContext?: DecodingContextCtor
  }
  return g.OfflineAudioContext ?? g.webkitOfflineAudioContext ?? null
}

const TEST_PREFIX = new TextEncoder().encode(TEST_TRANSCRIPT_PREFIX)

async function isTestUtterance(blob: Blob): Promise<boolean> {
  if (blob.size < TEST_PREFIX.length) return false
  const head = new Uint8Array(await blob.slice(0, TEST_PREFIX.length).arrayBuffer())
  return head.every((b, i) => b === TEST_PREFIX[i])
}

/** Both decodeAudioData styles: the promise (current) and the callbacks (older Safari). */
function decode(ctx: DecodingContext, data: ArrayBuffer): Promise<DecodedAudio> {
  return new Promise<DecodedAudio>((resolve, reject) => {
    const result = ctx.decodeAudioData(data, resolve, reject)
    if (result && typeof result.then === 'function') result.then(resolve, reject)
  })
}

/** The channels' average, cut at `maxSamples`. */
export function mixDown(audio: DecodedAudio, maxSamples: number): Float32Array {
  const length = Math.max(0, Math.min(audio.length, maxSamples))
  const out = new Float32Array(length)
  const channels = Math.max(1, audio.numberOfChannels)
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const data = audio.getChannelData(c)
    for (let i = 0; i < length; i++) out[i] = out[i]! + (data[i] ?? 0) / channels
  }
  return out
}

export interface UploadAudio {
  blob: Blob
  /** The audio's own length (samples ÷ rate), not the recording timer. */
  durationMs: number
}

/**
 * The upload for one recording: a 16 kHz mono WAV of at most `maxDurationMs`. A recording the
 * browser can't decode (an empty or broken file) comes back empty, and the service refuses it as
 * `invalid`, so the learner can try again.
 */
export async function toUploadWav(
  recorded: Blob,
  opts: { maxDurationMs: number; timerMs: number; ctor?: DecodingContextCtor | null },
): Promise<UploadAudio> {
  if (await isTestUtterance(recorded))
    return {
      blob: recorded,
      durationMs: Math.min(Math.max(0, Math.round(opts.timerMs)), opts.maxDurationMs),
    }
  const Ctor = opts.ctor === undefined ? offlineContextCtor() : opts.ctor
  const empty: UploadAudio = { blob: new Blob([], { type: 'audio/wav' }), durationMs: 0 }
  if (!Ctor || recorded.size === 0) return empty
  let audio: DecodedAudio
  try {
    // decodeAudioData resamples to the context's rate; the context itself never renders.
    audio = await decode(new Ctor(1, 1, WAV_SAMPLE_RATE), await recorded.arrayBuffer())
  } catch {
    return empty
  }
  const samples = mixDown(audio, Math.floor((WAV_SAMPLE_RATE * opts.maxDurationMs) / 1000))
  if (samples.length === 0) return empty
  const wav = encodeWav(samples, WAV_SAMPLE_RATE)
  return {
    blob: new Blob([wav], { type: 'audio/wav' }),
    durationMs: Math.round((samples.length * 1000) / WAV_SAMPLE_RATE),
  }
}
