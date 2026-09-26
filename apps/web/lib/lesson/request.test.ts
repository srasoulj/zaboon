/** The createSession body (P2 speak: `speakPaused` only while the pause runs). */
import { describe, expect, it } from 'vitest'
import { CreateSessionRequest } from '@zaboon/contracts'
import { createSessionBody, requestKey, type LessonRequest } from './request'

const lesson: LessonRequest = { courseId: 'fixture', kind: 'lesson', levelId: 'u01-v1' }
const practice: LessonRequest = {
  courseId: 'fa-en',
  kind: 'practice',
  levelId: null,
  mode: 'listening',
}

describe('createSessionBody', () => {
  it('without a speak pause: exactly the pre-Wave-4 body, with no speakPaused key', () => {
    for (const speakPaused of [undefined, false]) {
      const body = createSessionBody(lesson, { tz: 'Asia/Tehran', speakPaused })
      expect(body).toEqual({
        courseId: 'fixture',
        kind: 'lesson',
        levelId: 'u01-v1',
        tz: 'Asia/Tehran',
      })
      expect(Object.keys(body)).not.toContain('speakPaused')
    }
    expect(createSessionBody(practice, { tz: 'UTC' })).toEqual({
      courseId: 'fa-en',
      kind: 'practice',
      mode: 'listening',
      tz: 'UTC',
    })
  })

  it('while the pause runs: speakPaused true, and the body is contract-valid', () => {
    const body = createSessionBody(lesson, { tz: 'UTC', speakPaused: true })
    expect(body).toMatchObject({ speakPaused: true, levelId: 'u01-v1' })
    expect(CreateSessionRequest.parse(body)).toMatchObject({ speakPaused: true })
    expect(
      CreateSessionRequest.parse(createSessionBody(practice, { tz: 'UTC' })),
    ).not.toHaveProperty('speakPaused')
  })

  it('the pause never changes the lesson identity (requestKey is unchanged)', () => {
    // The pause is device state outside LessonRequest: the key stays the MVP/Wave 3 key, so
    // saved snapshots keep resuming and the in-flight createSession is shared.
    expect(requestKey(lesson)).toBe('fixture|lesson|u01-v1')
    expect(requestKey(practice)).toBe('fa-en|practice||listening')
    createSessionBody(lesson, { tz: 'UTC', speakPaused: true })
    expect(requestKey(lesson)).toBe('fixture|lesson|u01-v1')
    expect(lesson).toEqual({ courseId: 'fixture', kind: 'lesson', levelId: 'u01-v1' })
  })
})
