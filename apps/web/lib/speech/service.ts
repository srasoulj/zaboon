/**
 * The speech service (P2 speak, flags.speak): what a speak renderer uses to turn a recording into
 * a signed transcript, and to start the "Can't speak now" pause. Renderers never call the API
 * themselves (lib/challenge-registry.ts); the lesson player builds one service per session and
 * hands it down through <SpeechServiceProvider> (lib/speech/context.tsx).
 *
 * The recording is sent once, as base64, to POST /api/speech/transcribe and dropped: nothing here
 * keeps audio after the request.
 */
import {
  DEFAULT_APP_CONFIG,
  type SpeechAudioFormat,
  type TranscribeResponse,
} from '@zaboon/contracts'
import type { ApiClient } from '../api-client'
import { pauseSpeaking as startPause, type PauseStorage } from './pause'

export type SpeechErrorCode = 'quota_exceeded' | 'unavailable' | 'network' | 'invalid' | 'not_found'

/** A transcription that failed, by what the learner can do about it. */
export class SpeechError extends Error {
  constructor(
    readonly code: SpeechErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SpeechError'
  }
}

export interface TranscribeInput {
  /** The speak challenge's index in the current session. */
  index: number
  blob: Blob
  format: SpeechAudioFormat
  durationMs: number
}

export interface SpeechService {
  /** Transcribes one recording; throws a `SpeechError`. */
  transcribe(input: TranscribeInput): Promise<TranscribeResponse>
  /** "Can't speak now": new sessions leave speak challenges out for AppConfig.speech.pauseMinutes. */
  pauseSpeaking(): void
}

/** Maps an API client error code (ApiClientError.code) to what the renderer shows. */
export function speechErrorCode(code: string): SpeechErrorCode {
  switch (code) {
    case 'quota_exceeded':
      return 'quota_exceeded'
    case 'network':
      return 'network'
    case 'validation':
      return 'invalid'
    case 'not_found':
      return 'not_found'
    default:
      // unavailable, rate_limited, gone, internal…: nothing the learner can fix right now.
      return 'unavailable'
  }
}

function toSpeechError(error: unknown): SpeechError {
  if (error instanceof SpeechError) return error
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'network'
  return new SpeechError(
    speechErrorCode(code),
    error instanceof Error ? error.message : 'transcription failed',
  )
}

/** Standard (padded) base64 of the blob's bytes. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}

export interface SpeechServiceDeps {
  api: ApiClient
  sessionId: string
  userId: string
  /** AppConfig.speech.pauseMinutes (the client has no AppConfig: defaults to DEFAULT_APP_CONFIG). */
  pauseMinutes?: number
  /** Epoch ms of the pause clock (lib/speech/pause.ts `speechNow`). */
  now: () => number
  storage?: PauseStorage | null
}

export function createSpeechService(deps: SpeechServiceDeps): SpeechService {
  const minutes = deps.pauseMinutes ?? DEFAULT_APP_CONFIG.speech.pauseMinutes
  return {
    async transcribe({ index, blob, format, durationMs }) {
      try {
        if (blob.size === 0) throw new SpeechError('invalid', 'empty recording')
        const audio = await blobToBase64(blob)
        return await deps.api('transcribe', {
          body: {
            sessionId: deps.sessionId,
            index,
            format,
            audio,
            durationMs: Math.max(0, Math.round(durationMs)),
          },
        })
      } catch (e) {
        throw toSpeechError(e)
      }
    },
    pauseSpeaking() {
      startPause(deps.userId, deps.now(), minutes, deps.storage)
    },
  }
}
