/**
 * A rehype plugin for guidebooks: Persian written straight into the markdown (outside `<fa>`)
 * still needs `lang="fa" dir="rtl"` (CLAUDE.md rule 5), so each run of Arabic-script words in a
 * text node becomes an `fa` element, which the renderer draws with FaText. Runs are whole words:
 * a run starts and ends on an Arabic-script character and keeps ZWNJ/ZWJ inside it. Text in
 * `fa`, `code` and `pre` is left alone.
 */

/** The parts of a hast node the plugin touches (hast's types are not a direct dependency). */
export interface HastLike {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastLike[]
}

const ARABIC = '\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF'
/** An Arabic-script word, then more words joined by spaces; ZWNJ/ZWJ stay inside words. */
const RUN = new RegExp(
  `[${ARABIC}](?:[${ARABIC}\\u200C\\u200D]|[ \\t\\n\\u00A0]+(?=[${ARABIC}]))*`,
  'g',
)
export const ARABIC_SCRIPT = new RegExp(`[${ARABIC}]`)

const SKIP: ReadonlySet<string> = new Set(['fa', 'code', 'pre', 'script', 'style'])

/** Splits a text value into text and `fa` element nodes. */
export function splitPersianRuns(value: string): HastLike[] {
  const out: HastLike[] = []
  let at = 0
  for (const m of value.matchAll(RUN)) {
    const start = m.index
    if (start > at) out.push({ type: 'text', value: value.slice(at, start) })
    out.push({
      type: 'element',
      tagName: 'fa',
      properties: {},
      children: [{ type: 'text', value: m[0] }],
    })
    at = start + m[0].length
  }
  if (at < value.length) out.push({ type: 'text', value: value.slice(at) })
  return out
}

function wrap(node: HastLike): void {
  if (!node.children) return
  if (node.type === 'element' && SKIP.has(node.tagName ?? '')) return
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text' && child.value && ARABIC_SCRIPT.test(child.value))
      return splitPersianRuns(child.value)
    wrap(child)
    return [child]
  })
}

/** `rehypePlugins={[…, rehypePersianRuns]}` (after sanitizing, so the `fa` it adds is trusted). */
export function rehypePersianRuns() {
  return (tree: HastLike) => {
    wrap(tree)
  }
}
