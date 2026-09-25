/** Public types of @zaboon/ai: OpenRouter's OpenAI-compatible chat API (the subset we use). */

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
  response_format?: {
    type: 'json_schema'
    json_schema: { name: string; strict: boolean; schema: unknown }
  }
  modalities?: ('text' | 'image' | 'audio')[]
  /** Audio output. OpenRouter only returns it on a streamed request, which only allows pcm16. */
  audio?: { voice: string; format: 'mp3' | 'wav' | 'pcm16' }
  /** Server-sent events. FetchTransport assembles the chunks into one ChatResponse. */
  stream?: boolean
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

/** Build-time response cache (LEARNING-ENGINE §4.2): keyed by hash(model, prompt version, input). */
export interface ResponseCache {
  get(key: string): Promise<ChatResponse | null>
  set(key: string, response: ChatResponse): Promise<void>
}

/** The `fetch` signature the package uses; injectable so tests never touch the network. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>
