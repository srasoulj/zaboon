/**
 * @zaboon/ai: the only way Zaboon talks to AI models: OpenRouter's OpenAI-compatible API
 * (ADR 0008, ARCHITECTURE §11).
 *
 * Wave 0 STUB: the public types, the pinned model registry and a mock transport. Owner:
 * ws-content-cli, who implements the fetch transport, structured outputs (zod → JSON schema),
 * image and audio calls, the response cache, the budget ledger and provenance.
 *
 * Rules: this package NEVER reads environment variables. Callers pass their own key:
 * content-cli → OPENROUTER_API_KEY_BUILD, app server → OPENROUTER_API_KEY_APP.
 */
export const IMPLEMENTATION: 'stub' | 'real' = 'stub'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

/** Mirrors packages/ai/ai.models.yaml (a test keeps them in sync). */
export const MODELS = {
  content_text: 'openai/gpt-6-astra',
  content_text_batch: 'openai/gpt-6-astra:batch',
  content_image: 'openai/gpt-5.4-image-2',
  content_audio: 'openai/gpt-audio',
  app_transcribe: 'openai/gpt-audio-mini',
  app_explain: 'openai/gpt-6-luna',
  app_roleplay: 'openai/gpt-6-sol',
} as const
export type ModelRole = keyof typeof MODELS

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: 'mp3' | 'wav' | 'webm' | 'm4a' } }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

/** OpenRouter /chat/completions request (subset we use). */
export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  response_format?: { type: 'json_schema'; json_schema: { name: string; strict: boolean; schema: unknown } }
  modalities?: ('text' | 'image' | 'audio')[]
  audio?: { voice: string; format: 'mp3' | 'wav' }
  max_tokens?: number
  temperature?: number
  provider?: { data_collection?: 'allow' | 'deny' }
  usage?: { include: boolean }
}

export interface ChatResponse {
  id: string
  model: string
  choices: {
    message: {
      content: string | null
      images?: { type: 'image_url'; image_url: { url: string } }[]
      audio?: { data: string; transcript?: string }
    }
    finish_reason: string | null
  }[]
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost?: number }
}

export interface AiTransport {
  send(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>
}

/** Tracks spend against a hard cap (content pipeline: the key's remaining credit). */
export interface BudgetLedger {
  /** Throws BudgetExceededError if spending `estimateUsd` more would pass the cap. */
  reserve(estimateUsd: number, label: string): Promise<void>
  record(actualUsd: number, label: string): Promise<void>
  spent(): Promise<number>
}

export class BudgetExceededError extends Error {}

export interface AiClientOptions {
  apiKey: string
  transport?: AiTransport
  budget?: BudgetLedger
  /** Sent as HTTP-Referer / X-Title for OpenRouter attribution. */
  appName?: string
  /** App runtime calls set 'deny' (no provider data collection). */
  dataCollection?: 'allow' | 'deny'
}

/** Test transport: returns canned responses keyed by model (or a function of the request). */
export class MockTransport implements AiTransport {
  readonly calls: ChatRequest[] = []
  constructor(private readonly respond: (req: ChatRequest) => ChatResponse) {}
  async send(req: ChatRequest): Promise<ChatResponse> {
    this.calls.push(req)
    return this.respond(req)
  }
}

/** Minimal client surface; ws-content-cli fills in json(), image(), speech(), transcribe(). */
export class AiClient {
  constructor(private readonly opts: AiClientOptions) {
    if (!opts.apiKey && !opts.transport) throw new Error('AiClient needs an apiKey or a transport')
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!this.opts.transport) throw new Error('fetch transport not implemented yet (ws-content-cli)')
    const body: ChatRequest = {
      ...req,
      usage: { include: true },
      ...(this.opts.dataCollection ? { provider: { data_collection: this.opts.dataCollection } } : {}),
    }
    return this.opts.transport.send(body)
  }
}
