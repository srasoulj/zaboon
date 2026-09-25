import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MVP_CHALLENGE_TYPES } from '@zaboon/contracts'
import { gradeResponse } from '@zaboon/session-engine'
import { renderers } from '../index'
import { FIXTURES, renderChallenge } from '../testing'
import { correctResponse, wrongResponse } from '../fixtures/samples'

describe('renderers', () => {
  it('has one real renderer per MVP type and per optional P2 type', () => {
    const types = [...MVP_CHALLENGE_TYPES, 'listen_type', 'cloze_type', 'letter_trace']
    expect(Object.keys(renderers).sort()).toEqual(types.sort())
    expect(new Set(Object.values(renderers)).size).toBe(types.length)
  })

  it.each(FIXTURES.map((c) => [`${c.type}#${c.index}`, c] as const))(
    '%s renders with an instruction heading in a named section, answering and feedback',
    (_, c) => {
      const a = renderChallenge(c)
      expect(screen.getByRole('region')).toHaveAccessibleName(
        screen.getByRole('heading', { level: 2 }).textContent!,
      )
      a.unmount()
      renderChallenge(c, { phase: 'feedback', response: correctResponse(c) })
      expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
    },
  )

  it('every sample correct response grades correct', () => {
    for (const c of FIXTURES)
      expect([c.type, gradeResponse(c, correctResponse(c)).verdict]).toEqual([c.type, 'correct'])
  })

  it('every sample wrong response grades wrong (matching and letter_intro cannot be wrong)', () => {
    for (const c of FIXTURES) {
      if (['match_pairs', 'letter_forms', 'letter_intro'].includes(c.type)) continue
      expect([c.type, gradeResponse(c, wrongResponse(c)).verdict]).toEqual([c.type, 'wrong'])
    }
  })

  it('every Persian element carries lang="fa" and dir="rtl"', () => {
    for (const c of FIXTURES) {
      const h = renderChallenge(c, { display: { transliteration: true, vowelMarks: true } })
      for (const el of h.container.querySelectorAll('[lang="fa"]'))
        expect(el.getAttribute('dir')).toBe('rtl')
      h.unmount()
    }
  })
})
