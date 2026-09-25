/**
 * @zaboon/ai: the only way Zaboon talks to AI models: OpenRouter's OpenAI-compatible API
 * (ADR 0008, ARCHITECTURE §11).
 *
 * - `AiClient`: chat, structured JSON (zod), image, speech and transcription calls, with a
 *   response cache and a budget ledger.
 * - `FetchTransport`: the real HTTP transport (timeouts, retries with backoff on 429/5xx).
 * - `MockTransport`: canned responses for tests (worker sessions and CI have no keys).
 * - `FileResponseCache`, `FileBudgetLedger`, provenance and pricing helpers for content-cli.
 *
 * Rules: this package NEVER reads environment variables. Callers pass their own key:
 * content-cli → OPENROUTER_API_KEY_BUILD, app server → OPENROUTER_API_KEY_APP.
 */
import type { AiTransport, ChatRequest, ChatResponse } from './types'

export const IMPLEMENTATION: 'stub' | 'real' = 'real'

export { MODELS, type ModelRole } from './models'
export type {
  AiTransport,
  BudgetLedger,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ContentPart,
  FetchLike,
  ResponseCache,
} from './types'
export { AiHttpError, AiResponseError, AiTimeoutError, BudgetExceededError } from './errors'
export {
  DEFAULT_REFERER,
  DEFAULT_TITLE,
  FetchTransport,
  fetchKeyInfo,
  isRetryableStatus,
  listModels,
  OPENROUTER_BASE_URL,
  retryAfterMs,
  type FetchTransportOptions,
  type KeyInfo,
  type OpenRouterModel,
} from './transport'
export {
  AiClient,
  DEFAULT_TTS_INSTRUCTIONS,
  isStrictCompatible,
  parseJsonContent,
  toResponseFormat,
  type AiClientOptions,
  type CallOptions,
  type CallResult,
  type ImageInput,
  type ImageOptions,
  type ImageResult,
  type JsonOptions,
  type JsonResult,
  type SpeechOptions,
  type SpeechResult,
  type TranscribeOptions,
} from './client'
export { cacheKey, FileResponseCache, MemoryResponseCache, stableStringify } from './cache'
export {
  FileBudgetLedger,
  MemoryBudgetLedger,
  type FileBudgetLedgerOptions,
  type LedgerEntry,
  type LedgerState,
} from './budget'
export {
  approxTokens,
  estimateUsd,
  PRICING,
  priceOf,
  type ModelPrice,
  type TokenEstimate,
} from './pricing'
export {
  aiProvenance,
  mediaProvenance,
  parsePromptId,
  promptId,
  type AiProvenance,
  type MediaProvenance,
  type PromptTemplate,
} from './provenance'
export {
  decodeDataUrl,
  extensionFor,
  looksLikeMp3,
  sniffImage,
  toDataUrl,
  type ImageMime,
} from './media'

/** Test transport: returns canned responses keyed by model (or a function of the request). */
export class MockTransport implements AiTransport {
  readonly calls: ChatRequest[] = []
  constructor(
    private readonly respond: (req: ChatRequest) => ChatResponse | Promise<ChatResponse>,
  ) {}
  async send(req: ChatRequest): Promise<ChatResponse> {
    this.calls.push(req)
    return this.respond(req)
  }
}

/** Builds a minimal ChatResponse (tests and recorded fixtures). */
export function chatResponse(
  content: string | null,
  extra: {
    model?: string
    images?: string[]
    audio?: { data: string; transcript?: string }
    cost?: number
  } = {},
): ChatResponse {
  return {
    id: 'gen-mock',
    model: extra.model ?? 'mock',
    choices: [
      {
        message: {
          content,
          ...(extra.images
            ? {
                images: extra.images.map((url) => ({
                  type: 'image_url' as const,
                  image_url: { url },
                })),
              }
            : {}),
          ...(extra.audio ? { audio: extra.audio } : {}),
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 10,
      total_tokens: 20,
      ...(extra.cost === undefined ? {} : { cost: extra.cost }),
    },
  }
}
