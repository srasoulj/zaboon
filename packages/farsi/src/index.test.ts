import { describe, expect, it } from 'vitest'
import { PACKAGE } from './index'

describe('@zaboon/farsi', () => {
  it('loads', () => {
    expect(PACKAGE).toBe('farsi')
  })
})
