/**
 * YAML writing in the house layout of content/fa-en: one list item per block separated by blank
 * lines, token entries and provenance as one-line flow maps, short string lists (glosses, tags,
 * chat options) in flow style, and no line folding (Persian lines must never be wrapped).
 * `setItemFields` edits an existing file in place and keeps its comments.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { Document, isMap, isScalar, isSeq, parseDocument, Scalar, type YAMLMap } from 'yaml'

const TO_STRING = { lineWidth: 0, minContentWidth: 0 } as const

/** The seed files pad flow maps (`{ a: 1 }`) but not flow lists (`[a, b]`). */
const unpadFlowLists = (yaml: string) => yaml.replace(/: \[ (.*) \]$/gm, ': [$1]')

/** Keys whose values are written as flow collections. */
const FLOW_KEYS = new Set([
  'glosses',
  'tags',
  'provenance',
  'options',
  'characters',
  'forms',
  'audio',
])
/** Sequences whose items (maps) are written as flow maps. */
const FLOW_ITEM_KEYS = new Set(['tokens'])
/** Focus id lists inside lesson specs. */
const FLOW_LIST_KEYS = new Set(['lexemes', 'sentences', 'chats', 'letters'])

/** String values quoted like the seed files (answer patterns, glosses, punctuated romanization). */
const QUOTE_KEYS = new Set(['en', 'faAccept', 'gloss'])
const QUOTE_IF_PUNCTUATED = new Set(['translit', 'translitFormal'])

function quote(node: unknown): void {
  if (isScalar(node) && typeof node.value === 'string') node.type = Scalar.QUOTE_DOUBLE
  if (isSeq(node)) node.items.forEach(quote)
}

function styleMap(map: YAMLMap): void {
  for (const pair of map.items) {
    const key = String((pair.key as { value?: unknown })?.value ?? pair.key)
    const value = pair.value
    if (QUOTE_KEYS.has(key)) quote(value)
    if (QUOTE_IF_PUNCTUATED.has(key) && isScalar(value) && /[?!.,]/.test(String(value.value)))
      quote(value)
    if (FLOW_ITEM_KEYS.has(key) && isSeq(value))
      for (const item of value.items) if (isMap(item)) styleMap(item)
    if (FLOW_KEYS.has(key) && (isMap(value) || isSeq(value))) value.flow = true
    else if (FLOW_ITEM_KEYS.has(key) && isSeq(value)) {
      for (const item of value.items) if (isMap(item)) item.flow = true
    } else if (FLOW_LIST_KEYS.has(key) && isSeq(value)) value.flow = true
    if (isMap(value) && !value.flow) styleMap(value)
    if (isSeq(value) && !value.flow) for (const item of value.items) if (isMap(item)) styleMap(item)
  }
}

function toYaml(value: unknown): string {
  const doc = new Document(value)
  if (isMap(doc.contents)) styleMap(doc.contents)
  if (isSeq(doc.contents)) for (const item of doc.contents.items) if (isMap(item)) styleMap(item)
  return unpadFlowLists(doc.toString(TO_STRING))
}

/** A `#` comment block, word-wrapped at 100 columns. */
export function comment(text: string): string {
  const lines: string[] = []
  for (const para of text.trim().split('\n')) {
    let line = '#'
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line.length + 1 + word.length > 100 && line !== '#') {
        lines.push(line)
        line = '#'
      }
      line += ` ${word}`
    }
    lines.push(line)
  }
  return lines.join('\n')
}

/** A list file (lexemes/sentences/chats): header comment, then items separated by blank lines. */
export function listToYaml(items: readonly object[], header?: string): string {
  const body = items.map((item) => toYaml([item])).join('\n')
  return `${header ? `${comment(header)}\n\n` : ''}${body}`
}

/** A single-document file (units/<unit>.yaml). */
export function docToYaml(value: object, header?: string): string {
  return `${header ? `${comment(header)}\n` : ''}${toYaml(value)}`
}

/**
 * Sets fields on the list item with `id` (or on the document root when `id` is null) in an
 * existing YAML file, keeping comments and formatting elsewhere. Nested paths use arrays.
 */
export function setItemFields(
  file: string,
  id: string | null,
  fields: readonly { path: readonly string[]; value: unknown }[],
): void {
  const doc = parseDocument(readFileSync(file, 'utf8'))
  let target: YAMLMap | null = null
  if (id === null) target = isMap(doc.contents) ? doc.contents : null
  else if (isSeq(doc.contents)) {
    target =
      (doc.contents.items.find((it) => isMap(it) && (it.get('id') as unknown) === id) as YAMLMap) ??
      null
  } else if (isMap(doc.contents)) {
    // letters.yaml: { letters: [...] }
    for (const pair of doc.contents.items) {
      if (isSeq(pair.value)) {
        const hit = pair.value.items.find((it) => isMap(it) && (it.get('id') as unknown) === id)
        if (hit) target = hit as YAMLMap
      }
    }
  }
  if (!target) throw new Error(`${file}: no item ${id ?? '(root)'}`)
  for (const { path, value } of fields) {
    if (value === undefined) target.deleteIn(path as string[])
    else {
      // A new nested map (e.g. audio) is written in flow style like the rest of the file.
      const parent = path.length > 1 ? target.getIn(path.slice(0, -1) as string[]) : target
      if (path.length > 1 && parent === undefined) {
        const node = doc.createNode({ [path.at(-1)!]: value })
        node.flow = true
        target.setIn(path.slice(0, -1) as string[], node)
      } else target.setIn(path as string[], value)
    }
  }
  writeFileSync(file, unpadFlowLists(doc.toString(TO_STRING)))
}
