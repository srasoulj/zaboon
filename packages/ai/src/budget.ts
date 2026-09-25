/**
 * Budget ledgers (ARCHITECTURE §11.3: each key has its own credit limit).
 *
 * `FileBudgetLedger` keeps the pipeline's spend in a JSON file guarded by a lock file, so parallel
 * CLI runs on one machine share one hard cap. Before each paid call it can also ask OpenRouter for
 * the key's `limit_remaining` (GET /key), so the cap holds even when the key is used elsewhere.
 */
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { BudgetExceededError } from './errors'
import type { BudgetLedger } from './types'

export interface LedgerEntry {
  label: string
  usd: number
  at: string
}

export interface LedgerState {
  spentUsd: number
  pending: LedgerEntry[]
  entries: LedgerEntry[]
}

export interface FileBudgetLedgerOptions {
  file: string
  /** Hard cap in USD for everything recorded in this file. */
  capUsd: number
  /**
   * Remaining credit on the key in USD (null = unlimited), checked before every reservation.
   * Content-cli passes `() => fetchKeyInfo(...).then(k => k.limit_remaining)`.
   */
  remainingUsd?: () => Promise<number | null>
  /** Give up waiting for the lock after this long. Default 10 s. */
  lockTimeoutMs?: number
  /** A lock file older than this is from a crashed run and is removed. Default 60 s. */
  staleLockMs?: number
  now?: () => Date
}

const round = (usd: number) => Math.round(usd * 1e6) / 1e6
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class FileBudgetLedger implements BudgetLedger {
  private readonly lockFile: string

  constructor(private readonly opts: FileBudgetLedgerOptions) {
    if (!(opts.capUsd >= 0)) throw new Error('FileBudgetLedger needs a non-negative capUsd')
    this.lockFile = `${opts.file}.lock`
  }

  private now(): string {
    return (this.opts.now?.() ?? new Date()).toISOString()
  }

  read(): LedgerState {
    try {
      const raw = JSON.parse(readFileSync(this.opts.file, 'utf8')) as Partial<LedgerState>
      return {
        spentUsd: typeof raw.spentUsd === 'number' ? raw.spentUsd : 0,
        pending: Array.isArray(raw.pending) ? raw.pending : [],
        entries: Array.isArray(raw.entries) ? raw.entries : [],
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        return { spentUsd: 0, pending: [], entries: [] }
      throw new Error(`budget ledger ${this.opts.file} is unreadable: ${(e as Error).message}`, {
        cause: e,
      })
    }
  }

  private write(state: LedgerState): void {
    mkdirSync(dirname(this.opts.file), { recursive: true })
    const tmp = `${this.opts.file}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`)
    renameSync(tmp, this.opts.file)
  }

  private async withLock<T>(fn: (state: LedgerState) => T): Promise<T> {
    mkdirSync(dirname(this.opts.file), { recursive: true })
    const deadline = Date.now() + (this.opts.lockTimeoutMs ?? 10_000)
    for (;;) {
      try {
        const fd = openSync(this.lockFile, 'wx')
        writeSync(fd, String(process.pid))
        closeSync(fd)
        break
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
        try {
          if (Date.now() - statSync(this.lockFile).mtimeMs > (this.opts.staleLockMs ?? 60_000))
            unlinkSync(this.lockFile)
        } catch {
          // the holder released it between our open and stat: just retry
        }
        if (Date.now() > deadline)
          throw new Error(`timed out waiting for ${this.lockFile}`, { cause: e })
        await sleep(15)
      }
    }
    try {
      const state = this.read()
      const result = fn(state)
      this.write(state)
      return result
    } finally {
      try {
        unlinkSync(this.lockFile)
      } catch {
        // already gone (removed as stale by another process)
      }
    }
  }

  async reserve(estimateUsd: number, label: string): Promise<void> {
    if (estimateUsd < 0) throw new Error('estimate must be >= 0')
    // Network first, outside the lock: never hold the file lock across a request.
    const remaining = this.opts.remainingUsd ? await this.opts.remainingUsd() : null
    await this.withLock((state) => {
      const committed = state.spentUsd + state.pending.reduce((a, p) => a + p.usd, 0)
      if (committed + estimateUsd > this.opts.capUsd) {
        throw new BudgetExceededError(
          `${label}: estimated $${estimateUsd.toFixed(4)} would pass the budget cap ($${committed.toFixed(4)} of $${this.opts.capUsd.toFixed(2)} committed)`,
        )
      }
      const pendingHere = state.pending.reduce((a, p) => a + p.usd, 0)
      if (remaining !== null && pendingHere + estimateUsd > remaining) {
        throw new BudgetExceededError(
          `${label}: estimated $${estimateUsd.toFixed(4)} exceeds the key's remaining OpenRouter credit ($${remaining.toFixed(4)})`,
        )
      }
      state.pending.push({ label, usd: round(estimateUsd), at: this.now() })
    })
  }

  /** Records actual spend and releases the oldest reservation with the same label. */
  async record(actualUsd: number, label: string): Promise<void> {
    await this.withLock((state) => {
      const i = state.pending.findIndex((p) => p.label === label)
      if (i >= 0) state.pending.splice(i, 1)
      state.spentUsd = round(state.spentUsd + actualUsd)
      if (actualUsd > 0) state.entries.push({ label, usd: round(actualUsd), at: this.now() })
    })
  }

  async spent(): Promise<number> {
    return this.read().spentUsd
  }
}

/** In-memory ledger with the same cap semantics (tests, app-side per-process budgets). */
export class MemoryBudgetLedger implements BudgetLedger {
  private spentUsd = 0
  private pending: LedgerEntry[] = []
  readonly entries: LedgerEntry[] = []
  constructor(readonly capUsd: number) {}

  async reserve(estimateUsd: number, label: string): Promise<void> {
    const committed = this.spentUsd + this.pending.reduce((a, p) => a + p.usd, 0)
    if (committed + estimateUsd > this.capUsd)
      throw new BudgetExceededError(
        `${label}: estimated $${estimateUsd.toFixed(4)} would pass the budget cap`,
      )
    this.pending.push({ label, usd: estimateUsd, at: new Date().toISOString() })
  }

  async record(actualUsd: number, label: string): Promise<void> {
    const i = this.pending.findIndex((p) => p.label === label)
    if (i >= 0) this.pending.splice(i, 1)
    this.spentUsd = round(this.spentUsd + actualUsd)
    if (actualUsd > 0) this.entries.push({ label, usd: actualUsd, at: new Date().toISOString() })
  }

  async spent(): Promise<number> {
    return this.spentUsd
  }
}
