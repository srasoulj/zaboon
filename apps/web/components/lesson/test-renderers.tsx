'use client'
/**
 * Test-only renderers (local auth mode only): one generic panel for every challenge type with
 * "answer correctly" / "answer wrong" buttons, so the player's e2e specs drive the real API without
 * depending on how each real renderer (ws-renderers) looks. Enabled with
 * localStorage['zaboon.testRenderers'] = '1' when NEXT_PUBLIC_AUTH_MODE=local; never in production.
 */
import type { Challenge, ChallengeResponse } from '@zaboon/contracts'
import { canonical } from '@zaboon/grader'
import type { ChallengeRenderer, ChallengeRendererProps } from '../../lib/challenge-registry'
import type { RendererResolver } from './services'

export const TEST_RENDERERS_KEY = 'zaboon.testRenderers'

export function testRenderersEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_AUTH_MODE !== 'local') return false
  try {
    return globalThis.localStorage?.getItem(TEST_RENDERERS_KEY) === '1'
  } catch {
    return false
  }
}

/** A response the grader accepts (the first accepted answer). */
export function correctResponse(c: Challenge): ChallengeResponse {
  switch (c.type) {
    case 'select_image':
    case 'select_translation':
    case 'cloze_choice':
    case 'complete_chat':
    case 'letter_sound':
    case 'read_word':
      return { kind: 'choice', value: c.answer }
    case 'translate_bank':
    case 'listen_tap':
      return { kind: 'tiles', value: canonical(c.graph).split(' ').filter(Boolean) }
    case 'translate_type':
    case 'listen_type':
    case 'cloze_type':
      return { kind: 'text', value: canonical(c.graph) }
    case 'speak':
      return { kind: 'audio', transcript: canonical(c.graph) }
    case 'match_pairs':
    case 'letter_forms':
      return { kind: 'pairs', value: c.pairs.map((_, i) => [i, i] as [number, number]) }
    case 'build_word':
      return { kind: 'tiles', value: [...c.answer] }
    case 'letter_intro':
    case 'letter_trace':
    case 'story':
      return { kind: 'none' }
  }
}

/** A response the grader rejects. */
export function wrongResponse(c: Challenge): ChallengeResponse {
  if ('answer' in c && typeof c.answer === 'number' && 'choices' in c)
    return { kind: 'choice', value: (c.answer + 1) % c.choices.length }
  if (c.type === 'translate_type') return { kind: 'text', value: 'zzz' }
  if (c.type === 'match_pairs' || c.type === 'letter_forms') return { kind: 'pairs', value: [] }
  if (c.type === 'translate_bank' || c.type === 'listen_tap' || c.type === 'build_word')
    return { kind: 'tiles', value: [] }
  return { kind: 'choice', value: 99 } // a mismatched kind is always wrong
}

export function TestRenderer({ challenge, onResponse, onMismatch, phase, response }: ChallengeRendererProps) {
  const locked = phase !== 'answering'
  return (
    <div
      data-testid="test-renderer"
      data-type={challenge.type}
      data-index={challenge.index}
      data-phase={phase}
      data-response={response ? JSON.stringify(response) : ''}
      className="flex flex-col items-center gap-3 text-center"
    >
      <p className="font-bold">
        Test renderer: <code>{challenge.type}</code> #{challenge.index}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          disabled={locked}
          className="card-3d px-3 py-2"
          data-testid="test-answer-correct"
          onClick={() => onResponse(correctResponse(challenge))}
        >
          Answer correctly
        </button>
        <button
          type="button"
          disabled={locked}
          className="card-3d px-3 py-2"
          data-testid="test-answer-wrong"
          onClick={() => onResponse(wrongResponse(challenge))}
        >
          Answer wrong
        </button>
        {(challenge.type === 'match_pairs' || challenge.type === 'letter_forms') && (
          <button
            type="button"
            disabled={locked}
            className="card-3d px-3 py-2"
            data-testid="test-mismatch"
            onClick={onMismatch}
          >
            Wrong pair
          </button>
        )}
      </div>
    </div>
  )
}

/** Every type gets the generic test panel (it accepts any challenge). */
export const resolveTestRenderer: RendererResolver = <T extends Challenge['type']>(_type: T) =>
  TestRenderer as ChallengeRenderer<Extract<Challenge, { type: T }>>
