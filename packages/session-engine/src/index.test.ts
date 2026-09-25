import { describe, expect, it } from 'vitest'
import { PACKAGE } from './index'

describe('@zaboon/session-engine', () => {
  it('loads', () => {
    expect(PACKAGE).toBe('session-engine')
  })
})
