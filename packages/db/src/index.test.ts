import { describe, expect, it } from 'vitest'
import { PACKAGE } from './index'

describe('@zaboon/db', () => {
  it('loads', () => {
    expect(PACKAGE).toBe('db')
  })
})
