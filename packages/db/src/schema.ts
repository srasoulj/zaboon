/**
 * Drizzle table definitions mirroring supabase/migrations (the SQL files are the source of truth;
 * CI checks this file against the migrated database). ws-db owns and extends this file.
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })

export const profiles = pgTable('profiles', {
  userId: uuid('user_id').primaryKey(),
  timezone: text('timezone').notNull().default('UTC'),
  tzChangedAt: tstz('tz_changed_at'),
  ageConfirmed: boolean('age_confirmed').notNull().default(false),
  onboarded: boolean('onboarded').notNull().default(false),
  settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
})

export const publicProfiles = pgTable('public_profiles', {
  userId: uuid('user_id').primaryKey(),
  username: text('username').unique(),
  displayName: text('display_name'),
  avatar: jsonb('avatar'),
  streakCurrent: integer('streak_current').notNull().default(0),
  xpTotal: integer('xp_total').notNull().default(0),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
})

export const enrollments = pgTable(
  'enrollments',
  {
    userId: uuid('user_id').notNull(),
    courseId: text('course_id').notNull(),
    currentLevelId: text('current_level_id'),
    xpTotal: integer('xp_total').notNull().default(0),
    contentVersion: integer('content_version').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.courseId] })],
)

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  courseId: text('course_id').notNull(),
  levelId: text('level_id'),
  lessonIndex: integer('lesson_index').notNull().default(0),
  kind: text('kind').notNull(),
  contentVersion: integer('content_version').notNull(),
  seed: text('seed').notNull(),
  challengeRefs: jsonb('challenge_refs').notNull(),
  tz: text('tz').notNull(),
  startedAt: tstz('started_at').notNull().defaultNow(),
  expiresAt: tstz('expires_at').notNull(),
  status: text('status').notNull().default('started'),
  completedAt: tstz('completed_at'),
  result: jsonb('result'),
  graderVersion: integer('grader_version').notNull(),
})

export const sessionEvents = pgTable(
  'session_events',
  {
    sessionId: uuid('session_id').notNull(),
    userId: uuid('user_id').notNull(),
    attemptSeq: integer('attempt_seq').notNull(),
    challengeIndex: integer('challenge_index').notNull(),
    kind: text('kind').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.attemptSeq] })],
)

export const xpLedger = pgTable('xp_ledger', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid('user_id').notNull(),
  amount: integer('amount').notNull(),
  reason: text('reason').notNull(),
  sessionId: uuid('session_id'),
  occurredAt: tstz('occurred_at').notNull(),
  localDate: date('local_date', { mode: 'string' }).notNull(),
})

export const dailyActivity = pgTable(
  'daily_activity',
  {
    userId: uuid('user_id').notNull(),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    xp: integer('xp').notNull().default(0),
    sessions: integer('sessions').notNull().default(0),
    goalMet: boolean('goal_met').notNull().default(false),
    freezeUsed: boolean('freeze_used').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.localDate] })],
)

export const streaks = pgTable('streaks', {
  userId: uuid('user_id').primaryKey(),
  current: integer('current').notNull().default(0),
  longest: integer('longest').notNull().default(0),
  lastActiveDate: date('last_active_date', { mode: 'string' }),
  freezes: integer('freezes').notNull().default(0),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
})

export const lives = pgTable('lives', {
  userId: uuid('user_id').primaryKey(),
  policy: text('policy').notNull().default('hearts'),
  count: integer('count').notNull(),
  updatedAt: tstz('updated_at').notNull(),
})

export const contentVersions = pgTable(
  'content_versions',
  {
    courseId: text('course_id').notNull(),
    version: integer('version').notNull(),
    bundlePath: text('bundle_path').notNull(),
    minAppVersion: text('min_app_version').notNull().default('0.1.0'),
    includesDrafts: boolean('includes_drafts').notNull().default(false),
    isCurrent: boolean('is_current').notNull().default(false),
    publishedAt: tstz('published_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.courseId, t.version] })],
)

export const appConfig = pgTable('app_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
})
