import { describe, expect, it } from 'vitest'
import { PACKAGE } from './index'

describe('@zaboon/grader', () => {
  it('loads', () => {
    expect(PACKAGE).toBe('grader')
  })
})
