import { describe, expect, it } from 'vitest'
import { PACKAGE } from './index'

describe('@zaboon/game-rules', () => {
  it('loads', () => {
    expect(PACKAGE).toBe('game-rules')
  })
})
