import { describe, expect, it } from 'vitest'
import { PACKAGE } from './index'

describe('@zaboon/contracts', () => {
  it('loads', () => {
    expect(PACKAGE).toBe('contracts')
  })
})
