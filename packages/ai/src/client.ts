/**
 * AiClient: every Zaboon AI call goes through here (ADR 0008).
 *
 *   chat()        raw /chat/completions (usage accounting + data-collection policy always applied)
 *   json()        structured output: zod → JSON schema → response_format, validated, one repair retry
 *   image()       image generation (modalities image+text), PNG/WebP bytes from data URLs
 *   speech()      TTS through an audio-output chat model (mp3)
 *   transcribe()  speech → text through an audio-input chat model
 *
 * Paid calls reserve an estimate on the BudgetLedger first and record OpenRouter's reported cost
 * afterwards. Calls with a `promptVersion` are cached (when a cache is configured) by
 * hash(model, promptVersion, input); only responses that passed validation are cached.
 */
import { z } from 'zod'
import { cacheKey } from './cache'
import { AiResponseError } from './errors'
import { decodeDataUrl, looksLikeMp3, sniffImage, toDataUrl } from './media'
import { approxTokens, estimateUsd } from './pricing'
import { FetchTransport } from './transport'
import type {
  AiTransport,
  BudgetLedger,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ContentPart,
  FetchLike,
  ResponseCache,
} from './types'
import { MODELS } from './models'

export interface AiClientOptions {
  apiKey: string
  transport?: AiTransport
  budget?: BudgetLedger
  cache?: ResponseCache
  /** Sent as X-Title for OpenRouter attribution. */
  appName?: string
  /** Sent as HTTP-Referer. */
  referer?: string
  /** App runtime calls set 'deny' (no provider data collection). */
  dataCollection?: 'allow' | 'deny'
  /** Options for the default FetchTransport (ignored when `transport` is given). */
  fetch?: FetchLike
  timeoutMs?: number
  maxRetries?: number
}

export interface CallOptions {
  /** Versioned prompt id, e.g. "draft-unit@1". Enables the cache. */
  promptVersion?: string
  /** Budget ledger label. */
  label?: string
  /** Reservation size in USD; estimated from the request when omitted. */
  estimateUsd?: number
  signal?: AbortSignal
}

export interface CallResult {
  response: ChatResponse
  cached: boolean
  /** OpenRouter's reported cost (0 for cache hits; the estimate when not reported). */
  costUsd: number
}

export interface JsonOptions extends CallOptions {
  model: string
  /** Schema name sent to the provider (letters, digits, _ and -). */
  name: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  /** Provider-side strict mode. Default: on when the schema allows it (no optional properties). */
  strict?: boolean
}

export interface JsonResult<T> {
  value: T
  model: string
  costUsd: number
  cached: boolean
  /** True when the first answer was invalid and the repair retry fixed it. */
  repaired: boolean
}

export type ImageInput = string | { mime: string; bytes: Buffer }

export interface ImageOptions extends CallOptions {
  model?: string
  /** Extra system instructions (style bible wording lives in the prompt templates). */
  system?: string
}

export interface ImageResult {
  bytes: Buffer
  mime: 'image/png' | 'image/webp'
  model: string
  costUsd: number
  cached: boolean
  /** Any text the model returned alongside the image. */
  text: string | null
}

export interface SpeechOptions extends CallOptions {
  model?: string
  /** System instructions for the voice (e.g. accent, pace). */
  instructions?: string
}

export interface SpeechResult {
  bytes: Buffer
  transcript?: string
  model: string
  costUsd: number
  cached: boolean
}

export interface TranscribeOptions extends CallOptions {
  model?: string
  /** Transcription language hint, e.g. "Persian (Farsi)". */
  language?: string
}

export const DEFAULT_TTS_INSTRUCTIONS =
  'You are a text-to-speech voice. Read the user message aloud exactly as written, once, in natural ' +
  'colloquial Tehrani Persian at a calm, clear learner-friendly pace. Vowel marks show the intended ' +
  'pronunciation. Do not translate, explain, add or drop words.'

/** OpenAI strict structured outputs need every property required and no extra properties. */
export function isStrictCompatible(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.every(isStrictCompatible)
  if (!schema || typeof schema !== 'object') return true
  const s = schema as Record<string, unknown>
  if (s.type === 'object' || s.properties) {
    const props = Object.keys((s.properties as Record<string, unknown> | undefined) ?? {})
    const required = new Set((s.required as string[] | undefined) ?? [])
    if (s.additionalProperties !== false) return false
    if (props.some((p) => !required.has(p))) return false
  }
  return Object.values(s).every(isStrictCompatible)
}

export function toResponseFormat(
  schema: z.ZodType,
  name: string,
  strict?: boolean,
): NonNullable<ChatRequest['response_format']> {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema) as Record<string, unknown>
  return {
    type: 'json_schema',
    json_schema: { name, strict: strict ?? isStrictCompatible(json), schema: json },
  }
}

/** Parses a model's JSON answer, tolerating a ```json fence around it. */
export function parseJsonContent(content: string | null): unknown {
  if (content === null) throw new AiResponseError('empty response (no content)')
  const text = content.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, '$1')
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new AiResponseError(`response is not JSON: ${(e as Error).message}`, content)
  }
}

function describeZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 20)
    .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('; ')
}

function defaultEstimate(req: ChatRequest): number {
  const inputTokens = approxTokens(req.messages)
  const outputTokens = req.max_tokens ?? 4_000
  return estimateUsd(req.model, {
    inputTokens,
    outputTokens,
    imageOutputTokens: req.modalities?.includes('image') ? 6_000 : 0,
    // gpt-audio emits roughly 10 audio tokens per second; allow 60 s per call.
    audioOutputTokens: req.modalities?.includes('audio') ? 600 : 0,
  })
}

export class AiClient {
  private readonly transport: AiTransport

  constructor(private readonly opts: AiClientOptions) {
    if (!opts.apiKey && !opts.transport) throw new Error('AiClient needs an apiKey or a transport')
    this.transport =
      opts.transport ??
      new FetchTransport({
        apiKey: opts.apiKey,
        title: opts.appName,
        referer: opts.referer,
        fetch: opts.fetch,
        timeoutMs: opts.timeoutMs,
        maxRetries: opts.maxRetries,
      })
  }

  async chat(req: ChatRequest, opts: CallOptions = {}): Promise<ChatResponse> {
    return (await this.call(req, opts)).response
  }

  /**
   * One call with cache, budget and accounting. `validate` runs before the response is cached;
   * if it throws, the response is not cached and the error propagates (the spend is recorded).
   */
  async call(
    req: ChatRequest,
    opts: CallOptions = {},
    validate?: (r: ChatResponse) => void,
  ): Promise<CallResult> {
    const body: ChatRequest = {
      ...req,
      usage: { include: true },
      ...(this.opts.dataCollection
        ? { provider: { data_collection: this.opts.dataCollection } }
        : {}),
    }
    const key =
      opts.promptVersion && this.opts.cache ? cacheKey(req.model, opts.promptVersion, body) : null
    if (key) {
      const hit = await this.opts.cache!.get(key)
      if (hit) {
        validate?.(hit)
        return { response: hit, cached: true, costUsd: 0 }
      }
    }
    const label = opts.label ?? `${req.model}${opts.promptVersion ? ` ${opts.promptVersion}` : ''}`
    const estimate = opts.estimateUsd ?? defaultEstimate(body)
    const budget = this.opts.budget
    await budget?.reserve(estimate, label)
    let response: ChatResponse
    try {
      response = await this.transport.send(body, opts.signal)
    } catch (e) {
      // Failed requests are not billed by OpenRouter: release the reservation.
      await budget?.record(0, label)
      throw e
    }
    const costUsd = response.usage?.cost ?? estimate
    await budget?.record(costUsd, label)
    validate?.(response)
    if (key) await this.opts.cache!.set(key, response)
    return { response, cached: false, costUsd }
  }

  /** Structured output validated with `schema`; one repair retry on an invalid answer. */
  async json<S extends z.ZodType>(schema: S, opts: JsonOptions): Promise<JsonResult<z.infer<S>>> {
    const req: ChatRequest = {
      model: opts.model,
      messages: opts.messages,
      response_format: toResponseFormat(schema, opts.name, opts.strict),
      ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
      ...(opts.maxTokens === undefined ? {} : { max_tokens: opts.maxTokens }),
    }
    const check = (r: ChatResponse): z.infer<S> => {
      const parsed = schema.safeParse(parseJsonContent(r.choices[0]?.message.content ?? null))
      if (!parsed.success)
        throw new AiResponseError(
          `response failed schema validation: ${describeZodError(parsed.error)}`,
          r.choices[0]?.message.content ?? undefined,
        )
      return parsed.data
    }
    let problem: AiResponseError
    try {
      const first = await this.call(req, opts, (r) => void check(r))
      return {
        value: check(first.response),
        model: first.response.model || opts.model,
        costUsd: first.costUsd,
        cached: first.cached,
        repaired: false,
      }
    } catch (e) {
      if (!(e instanceof AiResponseError)) throw e
      problem = e
    }
    const repairReq: ChatRequest = {
      ...req,
      messages: [
        ...opts.messages,
        { role: 'assistant', content: problem.raw ?? '' },
        {
          role: 'user',
          content: `Your previous answer was not valid: ${problem.message}. Reply again with only the corrected JSON object that matches the schema.`,
        },
      ],
    }
    const second = await this.call(
      repairReq,
      { ...opts, label: `${opts.label ?? opts.name} (repair)` },
      (r) => void check(r),
    )
    return {
      value: check(second.response),
      model: second.response.model || opts.model,
      costUsd: second.costUsd,
      cached: second.cached,
      repaired: true,
    }
  }

  /** Generates one image; `refs` are style/reference images sent as image inputs. */
  async image(
    prompt: string,
    refs: readonly ImageInput[] = [],
    opts: ImageOptions = {},
  ): Promise<ImageResult> {
    const model = opts.model ?? MODELS.content_image
    const content: ContentPart[] = [
      { type: 'text', text: prompt },
      ...refs.map((r): ContentPart => ({
        type: 'image_url',
        image_url: { url: typeof r === 'string' ? r : toDataUrl(r.mime, r.bytes) },
      })),
    ]
    const req: ChatRequest = {
      model,
      modalities: ['image', 'text'],
      messages: [
        ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
        { role: 'user', content },
      ],
    }
    const extract = (r: ChatResponse) => {
      const message = r.choices[0]?.message
      const url = message?.images?.[0]?.image_url.url
      if (!url) throw new AiResponseError('no image in the response', message?.content ?? undefined)
      const { bytes } = decodeDataUrl(url)
      const mime = sniffImage(bytes)
      if (mime !== 'image/png' && mime !== 'image/webp')
        throw new AiResponseError(`expected a PNG or WebP image, got ${mime ?? 'unknown bytes'}`)
      return { bytes, mime, text: message?.content ?? null }
    }
    const res = await this.call(req, opts, (r) => void extract(r))
    return {
      ...extract(res.response),
      model: res.response.model || model,
      costUsd: res.costUsd,
      cached: res.cached,
    }
  }

  /** Text → MP3 speech. `voice` is the provider voice name (a character's `voice`). */
  async speech(text: string, voice: string, opts: SpeechOptions = {}): Promise<SpeechResult> {
    const model = opts.model ?? MODELS.content_audio
    const req: ChatRequest = {
      model,
      modalities: ['text', 'audio'],
      audio: { voice, format: 'mp3' },
      messages: [
        { role: 'system', content: opts.instructions ?? DEFAULT_TTS_INSTRUCTIONS },
        { role: 'user', content: text },
      ],
    }
    const extract = (r: ChatResponse) => {
      const audio = r.choices[0]?.message.audio
      if (!audio?.data) throw new AiResponseError('no audio in the response')
      const bytes = Buffer.from(audio.data, 'base64')
      if (!looksLikeMp3(bytes)) throw new AiResponseError('audio is not an MP3')
      return { bytes, ...(audio.transcript ? { transcript: audio.transcript } : {}) }
    }
    const res = await this.call(req, opts, (r) => void extract(r))
    return {
      ...extract(res.response),
      model: res.response.model || model,
      costUsd: res.costUsd,
      cached: res.cached,
    }
  }

  /** Speech → text. */
  async transcribe(
    audio: { bytes: Buffer; format: 'mp3' | 'wav' | 'webm' | 'm4a' },
    opts: TranscribeOptions = {},
  ): Promise<{ text: string; model: string; costUsd: number; cached: boolean }> {
    const model = opts.model ?? MODELS.app_transcribe
    const language = opts.language ?? 'Persian (Farsi)'
    const req: ChatRequest = {
      model,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Transcribe this ${language} audio verbatim in its own script. Reply with the transcript only.`,
            },
            {
              type: 'input_audio',
              input_audio: { data: audio.bytes.toString('base64'), format: audio.format },
            },
          ],
        },
      ],
    }
    const extract = (r: ChatResponse) => {
      const text = r.choices[0]?.message.content?.trim()
      if (!text) throw new AiResponseError('empty transcript')
      return text
    }
    const res = await this.call(req, opts, (r) => void extract(r))
    return {
      text: extract(res.response),
      model: res.response.model || model,
      costUsd: res.costUsd,
      cached: res.cached,
    }
  }
}
