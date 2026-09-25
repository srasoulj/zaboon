/**
 * Wiring for the AI commands (draft, suggest, art, tts): the build key from the environment, the
 * response cache, the budget ledger and dry-run cost reports. @zaboon/ai never reads env vars;
 * this file is the one place content-cli does (OPENROUTER_API_KEY_BUILD, ADR 0008).
 */
import { join } from 'node:path'
import {
  AiClient,
  approxTokens,
  estimateUsd,
  fetchKeyInfo,
  FileBudgetLedger,
  FileResponseCache,
  type AiTransport,
  type ChatMessage,
  type FetchLike,
} from '@zaboon/ai'

export const BUILD_KEY_ENV = 'OPENROUTER_API_KEY_BUILD'
/** Default hard cap for the build key: its OpenRouter credit limit today (LEARNING-ENGINE §4.2). */
export const DEFAULT_BUDGET_USD = 10

export class MissingKeyError extends Error {
  override name = 'MissingKeyError'
}

export function requireBuildKey(env: NodeJS.ProcessEnv): string {
  const key = env[BUILD_KEY_ENV]?.trim()
  if (!key)
    throw new MissingKeyError(
      `${BUILD_KEY_ENV} is not set. The AI commands need the content pipeline's OpenRouter key ` +
        '(see .env.example); use --dry-run to preview prompts and costs without it.',
    )
  return key
}

export interface AiContextOptions {
  env: NodeJS.ProcessEnv
  /** Repository root: the cache and ledger live in <root>/.local/ (git-ignored). */
  root: string
  budgetUsd?: number
  /** Tests: a MockTransport instead of the network. */
  transport?: AiTransport
  fetch?: FetchLike
}

export interface AiContext {
  ai: AiClient
  budget: FileBudgetLedger
  cacheDir: string
  ledgerFile: string
}

export function createAiContext(opts: AiContextOptions): AiContext {
  const apiKey = requireBuildKey(opts.env)
  const cacheDir = join(opts.root, '.local/ai-cache')
  const ledgerFile = join(opts.root, '.local/ai-budget.json')
  const budget = new FileBudgetLedger({
    file: ledgerFile,
    capUsd: opts.budgetUsd ?? DEFAULT_BUDGET_USD,
    // Tests inject a transport and have no network: skip the remote credit check there.
    remainingUsd: opts.transport
      ? undefined
      : async () => (await fetchKeyInfo({ apiKey, fetch: opts.fetch })).limit_remaining,
  })
  const ai = new AiClient({
    apiKey,
    transport: opts.transport,
    fetch: opts.fetch,
    budget,
    cache: new FileResponseCache(cacheDir),
    appName: 'Zaboon content-cli',
  })
  return { ai, budget, cacheDir, ledgerFile }
}

export interface DryRunCall {
  label: string
  model: string
  messages: ChatMessage[]
  maxOutputTokens: number
  imageOutputTokens?: number
  audioOutputTokens?: number
}

/** Prints the prompts and a cost estimate per call; returns the total estimate in USD. */
export function printDryRun(calls: readonly DryRunCall[], log: (line: string) => void): number {
  let total = 0
  for (const c of calls) {
    const inputTokens = approxTokens(c.messages)
    const usd = estimateUsd(c.model, {
      inputTokens,
      outputTokens: c.maxOutputTokens,
      imageOutputTokens: c.imageOutputTokens,
      audioOutputTokens: c.audioOutputTokens,
    })
    total += usd
    log(`── ${c.label} · ${c.model} · ~${inputTokens} input tokens · ≤ $${usd.toFixed(4)}`)
    for (const m of c.messages) {
      const text =
        typeof m.content === 'string'
          ? m.content
          : m.content.map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join('\n')
      log(`[${m.role}]\n${text}\n`)
    }
  }
  log(`dry run: ${calls.length} call(s), estimated at most $${total.toFixed(4)}; nothing was sent`)
  return total
}
