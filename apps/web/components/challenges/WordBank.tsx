'use client'
import { TileBank, type Tile, type TileLang } from '@zaboon/ui'
import { useState } from 'react'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import { gradedState, idsForValues, tilesValue } from './shared'

export interface WordBankProps extends Pick<
  ChallengeRendererProps,
  'response' | 'onResponse' | 'phase' | 'verdict'
> {
  /** Whole words (a ZWNJ compound is one tile); duplicates allowed. */
  words: readonly string[]
  lang: TileLang
}

/**
 * The kit's TileBank wired to a `{kind:'tiles'}` draft: the answer is the placed words in order,
 * and an empty answer line clears the draft. The answer line's direction is the answer language.
 */
export function WordBank({ words, lang, response, onResponse, phase, verdict }: WordBankProps) {
  const tiles: Tile[] = words.map((text, i) => ({ id: `t${i}`, text, lang }))
  const [answer, setAnswer] = useState<string[]>(() => idsForValues(words, tilesValue(response)))
  const text = new Map(tiles.map((t) => [t.id, t.text]))
  const onChange = (ids: string[]) => {
    if (phase !== 'answering') return
    setAnswer(ids)
    onResponse(ids.length > 0 ? { kind: 'tiles', value: ids.map((id) => text.get(id)!) } : null)
  }
  return (
    <TileBank
      tiles={tiles}
      answer={answer}
      onChange={onChange}
      dir={lang === 'fa' ? 'rtl' : 'ltr'}
      disabled={phase !== 'answering'}
      state={gradedState(phase, verdict)}
    />
  )
}
