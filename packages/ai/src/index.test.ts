import { describe, expect, it } from 'vitest'
import { PACKAGE } from './index'

describe('@zaboon/ai', () => {
  it('loads', () => {
    expect(PACKAGE).toBe('ai')
  })
})
