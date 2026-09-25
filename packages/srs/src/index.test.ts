import { describe, expect, it } from 'vitest'
import { PACKAGE } from './index'

describe('@zaboon/srs', () => {
  it('loads', () => {
    expect(PACKAGE).toBe('srs')
  })
})
