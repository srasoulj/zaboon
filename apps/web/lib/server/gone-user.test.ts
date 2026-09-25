import { describe, expect, it } from 'vitest'
import { isGoneUserViolation } from './with-route'

describe('isGoneUserViolation (#27: a deleted or merged account token → 401, not 500)', () => {
  it('recognizes a user_id foreign-key violation, also when a driver wraps it', () => {
    const pg = { code: '23503', constraint_name: 'profiles_user_id_fkey' }
    expect(isGoneUserViolation(pg)).toBe(true)
    expect(isGoneUserViolation({ message: 'Failed query', cause: pg })).toBe(true)
    expect(isGoneUserViolation({ code: '23503', constraint: 'sessions_user_id_fkey' })).toBe(true)
  })

  it('ignores every other error', () => {
    expect(isGoneUserViolation({ code: '23503', constraint_name: 'level_progress_level_fkey' })).toBe(false)
    expect(isGoneUserViolation({ code: '23505', constraint_name: 'profiles_user_id_key' })).toBe(false)
    expect(isGoneUserViolation(new Error('boom'))).toBe(false)
    expect(isGoneUserViolation(undefined)).toBe(false)
  })
})
