import { describe, expect, it } from 'vitest'
import { PACKAGE } from './index'

describe('@zaboon/content-schema', () => {
  it('loads', () => {
    expect(PACKAGE).toBe('content-schema')
  })
})
