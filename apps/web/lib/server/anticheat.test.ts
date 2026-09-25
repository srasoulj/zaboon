import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_CONFIG } from '@zaboon/contracts'
import { timingFlags } from './anticheat'

const config = DEFAULT_APP_CONFIG // minMsPerChallenge: 800

describe('timingFlags', () => {
  it('flags a session whose typical answer is faster than the minimum', () => {
    expect(timingFlags({ answerMs: [100, 200, 300], config })).toEqual(['impossible_answer_times'])
    expect(timingFlags({ answerMs: [100, 200, 5000, 6000, 300], config })).toEqual([
      'impossible_answer_times',
    ])
  })

  it('tolerates a few quick taps among normal answers', () => {
    expect(timingFlags({ answerMs: [100, 1500, 2000, 900, 50], config })).toEqual([])
    expect(timingFlags({ answerMs: [800, 800], config })).toEqual([])
  })

  it('does not flag a session with no rated answers', () => {
    expect(timingFlags({ answerMs: [], config })).toEqual([])
  })
})
