/**
 * @zaboon/session-engine: builds lesson sessions deterministically from content + learner state
 * (docs/LEARNING-ENGINE.md §5–§6).
 *
 * Owner: ws-engine (MVP), ws-typing (Wave 3). All 13 MVP challenge builders plus the P2 typed
 * Persian and tracing builders (builders.ts), the new-word ladder, mix profiles, due-review and
 * open-mistake mixing, distractor rules, letters sessions, the Wave 3 feature gates and the
 * practice-hub modes (generate.ts).
 * A session is stored as refs; `rebuildChallenges(refs, content)` reproduces `generateSession`'s
 * challenges exactly. Re-queueing wrong answers is the player's job: a retry re-sends the same
 * challenge index with a new attempt_seq. `gradeResponse` grades one response for both the player
 * and the server (grade.ts).
 */
export const IMPLEMENTATION: 'stub' | 'real' = 'real'

export type { ContentView } from './content'
export { ContentError } from './content'
export { buildChallenge, NotImplementedError, rebuildChallenges, TRACE_FORMS } from './builders'
export { allocate, generateSession, mvpTwin } from './generate'
export type { GenerateInput, GeneratedSession, LearnerState, SessionFeatures } from './generate'
export { gradeResponse, TRACE_MIN_COVERAGE, TRACE_MIN_PRECISION } from './grade'
export type { GradeContext, ResponseGrade } from './grade'
export { seededRandom } from './random'
export { decodeVariant, encodeVariant } from './variant'
export type { Variant } from './variant'
