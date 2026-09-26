/** The speech service: the transcribe request it sends, error mapping, and the pause. */
import { describe, expect, it } from 'vitest'
import { TranscribeRequest, type TranscribeResponse } from '@zaboon/contracts'
import { ApiClientError, type ApiClient } from '../api-client'
import { speakPauseKey, type PauseStorage } from './pause'
import { formatOfMime, pickRecordingType } from './recorder'
import { blobToBase64, createSpeechService, SpeechError, speechErrorCode } from './service'

const SESSION = '00000000-0000-4000-8000-000000000001'
const T0 = Date.parse('2026-09-26T10:00:00Z')

function fakeApi(impl: (body: unknown) => Promise<TranscribeResponse>) {
  const calls: { name: string; body: unknown }[] = []
  const api = (async (name: string, opts: { body: unknown }) => {
    calls.push({ name, body: opts.body })
    return impl(opts.body)
  }) as unknown as ApiClient
  return { api, calls }
}

function memory(): PauseStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

describe('createSpeechService', () => {
  it('sends the recording as base64 with the session, index, format and whole-ms duration', async () => {
    const reply = { transcript: 'سلام', token: 'tok', remaining: 59 }
    const { api, calls } = fakeApi(async () => reply)
    const speech = createSpeechService({ api, sessionId: SESSION, userId: 'u1', now: () => T0 })
    const blob = new Blob(['zaboon-test-transcript:سلام'], { type: 'audio/webm' })
    await expect(
      speech.transcribe({ index: 2, blob, format: 'webm', durationMs: 1234.6 }),
    ).resolves.toEqual(reply)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.name).toBe('transcribe')
    const body = TranscribeRequest.parse(calls[0]!.body)
    expect(body).toMatchObject({ sessionId: SESSION, index: 2, format: 'webm', durationMs: 1235 })
    expect(Buffer.from(body.audio, 'base64').toString('utf8')).toBe('zaboon-test-transcript:سلام')
  })

  it('maps API errors to SpeechError codes', async () => {
    const cases: [ApiClientError, string][] = [
      [new ApiClientError('quota_exceeded', 429, 'quota'), 'quota_exceeded'],
      [new ApiClientError('unavailable', 503, 'down'), 'unavailable'],
      [new ApiClientError('network', 0, 'offline'), 'network'],
      [new ApiClientError('validation', 400, 'too long'), 'invalid'],
      [new ApiClientError('not_found', 404, 'flag off'), 'not_found'],
      [new ApiClientError('internal', 500, 'boom'), 'unavailable'],
    ]
    for (const [error, code] of cases) {
      const { api } = fakeApi(() => Promise.reject(error))
      const speech = createSpeechService({ api, sessionId: SESSION, userId: 'u1', now: () => T0 })
      const blob = new Blob(['x'])
      const thrown = await speech
        .transcribe({ index: 0, blob, format: 'webm', durationMs: 10 })
        .catch((e: unknown) => e)
      expect(thrown).toBeInstanceOf(SpeechError)
      expect((thrown as SpeechError).code).toBe(code)
    }
    expect(speechErrorCode('rate_limited')).toBe('unavailable')
  })

  it('an empty recording is invalid without calling the API', async () => {
    const { api, calls } = fakeApi(async () => ({ transcript: '', token: 't', remaining: 1 }))
    const speech = createSpeechService({ api, sessionId: SESSION, userId: 'u1', now: () => T0 })
    await expect(
      speech.transcribe({ index: 0, blob: new Blob([]), format: 'webm', durationMs: 0 }),
    ).rejects.toMatchObject({ code: 'invalid' })
    expect(calls).toHaveLength(0)
  })

  it('pauseSpeaking starts the pause for this user (DEFAULT_APP_CONFIG: 60 minutes)', () => {
    const storage = memory()
    const { api } = fakeApi(async () => ({ transcript: '', token: 't', remaining: 1 }))
    createSpeechService({
      api,
      sessionId: SESSION,
      userId: 'u1',
      now: () => T0,
      storage,
    }).pauseSpeaking()
    expect(storage.data.get(speakPauseKey('u1'))).toBe('2026-09-26T11:00:00.000Z')
    createSpeechService({
      api,
      sessionId: SESSION,
      userId: 'u2',
      now: () => T0,
      storage,
      pauseMinutes: 5,
    }).pauseSpeaking()
    expect(storage.data.get(speakPauseKey('u2'))).toBe('2026-09-26T10:05:00.000Z')
  })

  it('blobToBase64 is standard padded base64', async () => {
    expect(await blobToBase64(new Blob(['ab']))).toBe('YWI=')
    const big = new Uint8Array(100_000).map((_, i) => i % 256)
    expect(await blobToBase64(new Blob([big]))).toBe(Buffer.from(big).toString('base64'))
  })
})

describe('recording formats', () => {
  it('prefers webm/opus, falls back to mp4 (m4a) like Safari, then wav', () => {
    expect(pickRecordingType(() => true)).toEqual({
      mimeType: 'audio/webm;codecs=opus',
      format: 'webm',
    })
    expect(pickRecordingType((t) => t.startsWith('audio/mp4'))).toEqual({
      mimeType: 'audio/mp4',
      format: 'm4a',
    })
    expect(pickRecordingType((t) => t === 'audio/wav')).toEqual({
      mimeType: 'audio/wav',
      format: 'wav',
    })
    expect(pickRecordingType(() => false)).toBeNull()
    expect(pickRecordingType(undefined)).toBeNull()
  })

  it('reads the format off the recorder MIME type', () => {
    expect(formatOfMime('audio/webm;codecs=opus')).toBe('webm')
    expect(formatOfMime('audio/mp4;codecs=mp4a.40.2')).toBe('m4a')
    expect(formatOfMime('audio/wav')).toBe('wav')
    expect(formatOfMime('audio/mpeg')).toBe('mp3')
    expect(formatOfMime('')).toBe('webm')
  })
})
