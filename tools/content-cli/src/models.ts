/**
 * `models check` (LEARNING-ENGINE §4.1 step 6, ARCHITECTURE §11.1): lists OpenRouter's public
 * models (no key needed) and flags, for each pinned model, newer versions in the same family, so
 * upgrades are deliberate. A pinned model missing from the list is flagged too (deprecation).
 *
 * Family: the model id with every version number replaced by `#` (openai/gpt-5.4-image-2 →
 * openai/gpt-#-image-#), or the pinned id plus a numeric suffix (openai/gpt-audio →
 * openai/gpt-audio-2025-…). "Newer" compares the version numbers, then the `created` date.
 */
import { MODELS, listModels, type FetchLike, type OpenRouterModel } from '@zaboon/ai'

export interface ModelFinding {
  role: string
  pinned: string
  available: boolean
  newer: string[]
}

const VERSION = /\d+(?:\.\d+)*/g

export function family(id: string): string {
  return id.split(':')[0]!.replace(VERSION, '#')
}

export function versionOf(id: string): number[] {
  return (id.split(':')[0]!.match(VERSION) ?? []).flatMap((v) => v.split('.').map(Number))
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function findNewer(pinned: string, models: readonly OpenRouterModel[]): string[] {
  const base = pinned.split(':')[0]!
  const fam = family(base)
  const mine = models.find((m) => m.id === base)
  const out = models.filter((m) => {
    const id = m.id.split(':')[0]!
    if (id === base || m.id.includes(':')) return false
    if (family(id) === fam) {
      const cmp = compareVersions(versionOf(id), versionOf(base))
      if (cmp !== 0) return cmp > 0
      return Boolean(mine?.created && m.created && m.created > mine.created)
    }
    // Dated or numbered snapshots of an unversioned id, e.g. openai/gpt-audio-2026-01-15.
    return id.startsWith(`${base}-`) && /^\d/.test(id.slice(base.length + 1))
  })
  return out.map((m) => m.id).sort()
}

export async function checkModels(
  opts: { fetch?: FetchLike; pinned?: Readonly<Record<string, string>> } = {},
): Promise<ModelFinding[]> {
  const models = await listModels({ fetch: opts.fetch })
  const ids = new Set(models.map((m) => m.id))
  return Object.entries(opts.pinned ?? MODELS).map(([role, pinned]) => ({
    role,
    pinned,
    // `:batch` variants are request modifiers, not separate list entries.
    available: ids.has(pinned) || ids.has(pinned.split(':')[0]!),
    newer: findNewer(pinned, models),
  }))
}

export function formatFindings(findings: readonly ModelFinding[]): string[] {
  return findings.map((f) => {
    if (!f.available) return `✘ ${f.role}: ${f.pinned} is no longer listed on OpenRouter`
    if (f.newer.length)
      return `! ${f.role}: ${f.pinned} is pinned; newer in this family: ${f.newer.join(', ')}`
    return `✔ ${f.role}: ${f.pinned} is the newest in its family`
  })
}
