/**
 * Cost estimates for budget reservations and `--dry-run`. Prices are USD per million tokens, from
 * OpenRouter's public model list on 2026-09-25 (ARCHITECTURE §11.1). They only size reservations:
 * the ledger records OpenRouter's reported `usage.cost` after each call.
 */
import type { ChatMessage } from './types'

export interface ModelPrice {
  input: number
  output: number
  imageOutput?: number
  audioInput?: number
  audioOutput?: number
}

export const PRICING: Readonly<Record<string, ModelPrice>> = {
  'openai/gpt-6-astra': { input: 10, output: 50 },
  'openai/gpt-6-sol': { input: 2, output: 10 },
  'openai/gpt-6-luna': { input: 0.1, output: 0.5 },
  'openai/gpt-5.4-image-2': { input: 8, output: 15, imageOutput: 30 },
  'openai/gpt-audio': { input: 2.5, output: 10, audioInput: 32, audioOutput: 64 },
  'openai/gpt-audio-mini': { input: 0.6, output: 2.4 },
}

/** Used for models missing from the table: the most expensive text prices we pin. */
const FALLBACK: ModelPrice = {
  input: 10,
  output: 50,
  imageOutput: 30,
  audioInput: 32,
  audioOutput: 64,
}

export function priceOf(model: string): ModelPrice {
  const [base, variant] = model.split(':') as [string, string | undefined]
  const p = PRICING[base] ?? FALLBACK
  if (variant !== 'batch') return p
  const half = (n: number | undefined) => (n === undefined ? undefined : n / 2)
  return {
    input: p.input / 2,
    output: p.output / 2,
    imageOutput: half(p.imageOutput),
    audioInput: half(p.audioInput),
    audioOutput: half(p.audioOutput),
  }
}

export interface TokenEstimate {
  inputTokens: number
  outputTokens: number
  imageOutputTokens?: number
  audioInputTokens?: number
  audioOutputTokens?: number
}

export function estimateUsd(model: string, t: TokenEstimate): number {
  const p = priceOf(model)
  const usd =
    t.inputTokens * p.input +
    t.outputTokens * p.output +
    (t.imageOutputTokens ?? 0) * (p.imageOutput ?? p.output) +
    (t.audioInputTokens ?? 0) * (p.audioInput ?? p.input) +
    (t.audioOutputTokens ?? 0) * (p.audioOutput ?? p.output)
  return usd / 1_000_000
}

/**
 * A deliberately high token estimate: 1 token per 3 characters (Persian script tokenizes worse
 * than English), plus a flat allowance per image or audio part.
 */
export function approxTokens(messages: readonly ChatMessage[]): number {
  let chars = 0
  let media = 0
  for (const m of messages) {
    if (typeof m.content === 'string') chars += m.content.length
    else
      for (const part of m.content) {
        if (part.type === 'text') chars += part.text.length
        else media += 1_500
      }
  }
  return Math.ceil(chars / 3) + media + 8 * messages.length
}
