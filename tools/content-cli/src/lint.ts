/**
 * Normalization lint for Persian fields (LEARNING-ENGINE §1.5 "Content lint", STYLE.md §3–§5):
 * no Arabic yeh/kaf, no Arabic-Indic digits, no ASCII `? ; ,`, no tatweel and no ZWJ.
 *
 * `fixPersianText` applies the same rules as automatic fixes; `draft` runs it over model output so
 * a slipped Arabic ي never reaches review.
 */
import { patternList } from '@zaboon/content-schema'
import type { LoadedCourse } from './load'

export interface LintRule {
  id: string
  pattern: RegExp
  message: string
  fix?: (match: string) => string
}

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'

export const FA_LINT_RULES: readonly LintRule[] = [
  {
    id: 'arabic-yeh',
    pattern: /[\u064A\u0649]/g,
    message: 'Arabic yeh (ي/ى); use Persian ی (U+06CC)',
    fix: () => 'ی',
  },
  {
    id: 'arabic-kaf',
    pattern: /\u0643/g,
    message: 'Arabic kaf (ك); use Persian ک (U+06A9)',
    fix: () => 'ک',
  },
  {
    id: 'arabic-indic-digit',
    pattern: /[\u0660-\u0669]/g,
    message: 'Arabic-Indic digit; use Persian digits ۰–۹ (U+06F0–U+06F9)',
    fix: (d) => PERSIAN_DIGITS[d.charCodeAt(0) - 0x0660]!,
  },
  { id: 'ascii-question', pattern: /\?/g, message: 'ASCII "?"; use ؟ (U+061F)', fix: () => '؟' },
  { id: 'ascii-semicolon', pattern: /;/g, message: 'ASCII ";"; use ؛ (U+061B)', fix: () => '؛' },
  { id: 'ascii-comma', pattern: /,/g, message: 'ASCII ","; use ، (U+060C)', fix: () => '،' },
  { id: 'tatweel', pattern: /\u0640/g, message: 'tatweel (U+0640) is not allowed', fix: () => '' },
  {
    id: 'zwj',
    pattern: /\u200D/g,
    message: 'ZWJ (U+200D) is for UI letter forms only; use ZWNJ (U+200C)',
  },
]

/** The lint rules a string breaks (each rule once). */
export function lintPersian(text: string): LintRule[] {
  return FA_LINT_RULES.filter((r) => new RegExp(r.pattern.source).test(text))
}

/** Applies every fixable rule. */
export function fixPersianText(text: string): string {
  let out = text.normalize('NFC')
  for (const r of FA_LINT_RULES) if (r.fix) out = out.replace(r.pattern, r.fix)
  return out
}

/** Every Persian field in a course, with a label and the file it came from. */
export function persianFields(
  course: LoadedCourse,
): { file: string; where: string; text: string }[] {
  const out: { file: string; where: string; text: string }[] = []
  const src = (kind: string, id: string) => course.sources.get(`${kind}:${id}`) ?? '?'
  const add = (file: string, where: string, text: string | undefined) => {
    if (text !== undefined) out.push({ file, where, text })
  }
  for (const l of course.lexemes) {
    const file = src('lexeme', l.id)
    add(file, `lexeme ${l.id} fa`, l.fa)
    add(file, `lexeme ${l.id} faFormal`, l.faFormal)
    add(file, `lexeme ${l.id} faVocalized`, l.faVocalized)
    for (const [k, v] of Object.entries(l.forms ?? {})) add(file, `lexeme ${l.id} forms.${k}`, v)
  }
  for (const s of course.sentences) {
    const file = src('sentence', s.id)
    add(file, `sentence ${s.id} fa`, s.fa)
    add(file, `sentence ${s.id} faFormal`, s.faFormal)
    add(file, `sentence ${s.id} faVocalized`, s.faVocalized)
    s.tokens.forEach((t, i) => add(file, `sentence ${s.id} tokens[${i}].surface`, t.surface))
    patternList(s.faAccept).forEach((p, i) => add(file, `sentence ${s.id} faAccept[${i}]`, p))
  }
  for (const st of course.stories) {
    const file = src('story', st.id)
    add(file, `story ${st.id} titleFa`, st.titleFa)
    st.lines.forEach((l, i) => {
      add(file, `story ${st.id} line ${i + 1} fa`, l.fa)
      add(file, `story ${st.id} line ${i + 1} faVocalized`, l.faVocalized)
      l.tokens.forEach((t, j) =>
        add(file, `story ${st.id} line ${i + 1} tokens[${j}].surface`, t.surface),
      )
    })
  }
  for (const l of course.letters?.letters ?? []) add('letters.yaml', `letter ${l.id}`, l.letter)
  for (const c of course.characters)
    add(src('character', c.id), `character ${c.id} nameFa`, c.nameFa)
  course.variants.forEach((set, i) =>
    set.forEach((v, j) => add('orthography-variants.yaml', `variant set ${i + 1}[${j}]`, v)),
  )
  return out
}
