/**
 * Provenance helpers (LEARNING-ENGINE §2.3): AI drafts record the model ID and the versioned
 * prompt template (`<name>@<version>`, e.g. `draft-unit@1`) that produced them.
 */

export interface PromptTemplate<Input> {
  /** Stable template name, e.g. "draft-unit". */
  name: string
  /** Bump on any wording change: it invalidates the response cache and is recorded in provenance. */
  version: number
  system: string
  user: (input: Input) => string
}

/** "draft-unit@3" */
export function promptId(t: { name: string; version: number }): string {
  return `${t.name}@${t.version}`
}

export function parsePromptId(id: string): { name: string; version: number } {
  const m = /^([a-z0-9][a-z0-9/-]*)@(\d+)$/.exec(id)
  if (!m) throw new Error(`invalid prompt id: ${id} (expected name@version)`)
  return { name: m[1]!, version: Number(m[2]) }
}

export interface AiProvenance {
  model: string
  prompt: string
  generatedAt: string
  notes?: string
}

/** Provenance for an AI-drafted content item (matches content-schema's Provenance). */
export function aiProvenance(
  model: string,
  template: { name: string; version: number } | string,
  opts: { now?: Date; notes?: string } = {},
): AiProvenance {
  const prompt = typeof template === 'string' ? template : promptId(template)
  parsePromptId(prompt)
  return {
    model,
    prompt,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    ...(opts.notes ? { notes: opts.notes } : {}),
  }
}

/** Sidecar written next to every generated asset (DESIGN-SYSTEM §7.4). */
export interface MediaProvenance {
  asset: string
  model: string
  prompt: string
  references?: string[]
  voice?: string
  input?: string
  generatedAt: string
  status: 'draft' | 'approved'
  approvedBy?: string
}

export function mediaProvenance(
  asset: string,
  model: string,
  template: { name: string; version: number } | string,
  extra: { references?: string[]; voice?: string; input?: string; now?: Date } = {},
): MediaProvenance {
  const base = aiProvenance(model, template, { now: extra.now })
  return {
    asset,
    model: base.model,
    prompt: base.prompt,
    ...(extra.references?.length ? { references: extra.references } : {}),
    ...(extra.voice ? { voice: extra.voice } : {}),
    ...(extra.input ? { input: extra.input } : {}),
    generatedAt: base.generatedAt,
    status: 'draft',
  }
}
