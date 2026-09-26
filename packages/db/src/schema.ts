/**
 * Drizzle table definitions mirroring supabase/migrations (the SQL files are the source of truth;
 * CI checks this file against the migrated database). ws-db owns and extends this file.
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
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

// ---------------------------------------------------------------------------------------------
// MVP tables added by 20260925000200_mvp_tables.sql
// ---------------------------------------------------------------------------------------------
export const consents = pgTable(
  'consents',
  {
    userId: uuid('user_id').notNull(),
    kind: text('kind').$type<'analytics' | 'marketing'>().notNull(),
    granted: boolean('granted').notNull(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind] })],
)

export const levelProgress = pgTable(
  'level_progress',
  {
    userId: uuid('user_id').notNull(),
    courseId: text('course_id').notNull(),
    levelId: text('level_id').notNull(),
    lessonsDone: integer('lessons_done').notNull().default(0),
    legendary: boolean('legendary').notNull().default(false),
    completedAt: tstz('completed_at'),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.courseId, t.levelId] })],
)

export const sessionAnswers = pgTable(
  'session_answers',
  {
    sessionId: uuid('session_id').notNull(),
    userId: uuid('user_id').notNull(),
    idx: integer('idx').notNull(),
    attemptSeq: integer('attempt_seq').notNull(),
    challengeType: text('challenge_type').notNull(),
    itemRefs: text('item_refs').array().notNull().default(sql`'{}'`),
    contentVersion: integer('content_version').notNull(),
    response: jsonb('response').notNull(),
    verdict: text('verdict').notNull(),
    ms: integer('ms').notNull(),
    hinted: boolean('hinted').notNull().default(false),
    rolledUp: boolean('rolled_up').notNull().default(false),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.idx, t.attemptSeq] })],
)

export const userItems = pgTable(
  'user_items',
  {
    userId: uuid('user_id').notNull(),
    item: text('item').notNull(),
    qty: integer('qty').notNull().default(0),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.item] })],
)

/** FSRS columns shared by lexeme_memory and letter_memory (mirror the contracts' FsrsCard). */
const fsrsColumns = () => ({
  due: tstz('due').notNull(),
  stability: doublePrecision('stability').notNull(),
  difficulty: doublePrecision('difficulty').notNull(),
  elapsedDays: doublePrecision('elapsed_days').notNull().default(0),
  scheduledDays: doublePrecision('scheduled_days').notNull().default(0),
  learningSteps: integer('learning_steps').notNull().default(0),
  reps: integer('reps').notNull().default(0),
  lapses: integer('lapses').notNull().default(0),
  state: smallint('state').notNull().default(0),
  lastReview: tstz('last_review'),
  exposures: integer('exposures').notNull().default(0),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
})

export const lexemeMemory = pgTable(
  'lexeme_memory',
  {
    userId: uuid('user_id').notNull(),
    lexemeId: text('lexeme_id').notNull(),
    ...fsrsColumns(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.lexemeId] })],
)

export const letterMemory = pgTable(
  'letter_memory',
  {
    userId: uuid('user_id').notNull(),
    letterId: text('letter_id').notNull(),
    ...fsrsColumns(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.letterId] })],
)

export const mistakes = pgTable(
  'mistakes',
  {
    userId: uuid('user_id').notNull(),
    itemRef: text('item_ref').notNull(),
    timesWrong: integer('times_wrong').notNull().default(1),
    lastWrongAt: tstz('last_wrong_at').notNull(),
    resolvedAt: tstz('resolved_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemRef] })],
)

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  sessionId: uuid('session_id'),
  itemRef: text('item_ref').notNull(),
  kind: text('kind').notNull(),
  answer: text('answer'),
  text: text('text'),
  status: text('status').notNull().default('new'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
})

export interface TopWrongAnswer {
  answer: string
  count: number
}

export const itemStats = pgTable(
  'item_stats',
  {
    itemRef: text('item_ref').notNull(),
    contentVersion: integer('content_version').notNull(),
    attempts: integer('attempts').notNull().default(0),
    wrong: integer('wrong').notNull().default(0),
    errorRate: doublePrecision('error_rate').notNull().default(0),
    topWrongAnswers: jsonb('top_wrong_answers').$type<TopWrongAnswer[]>().notNull().default(sql`'[]'::jsonb`),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.itemRef, t.contentVersion] })],
)

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  tokens: doublePrecision('tokens').notNull(),
  updatedAt: tstz('updated_at').notNull(),
})

// ---------------------------------------------------------------------------------------------
// P2 tables added by 20260925000300_p2_tables.sql
// ---------------------------------------------------------------------------------------------
export const wallet = pgTable('wallet', {
  userId: uuid('user_id').primaryKey(),
  coins: integer('coins').notNull().default(0),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
})

export const coinLedger = pgTable('coin_ledger', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid('user_id').notNull(),
  amount: integer('amount').notNull(),
  reason: text('reason').notNull(),
  ref: text('ref'),
  createdAt: tstz('created_at').notNull().defaultNow(),
})

export const leagueWeeks = pgTable('league_weeks', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  startsAt: tstz('starts_at').notNull(),
  endsAt: tstz('ends_at').notNull(),
  closedAt: tstz('closed_at'),
})

export const leagueCohorts = pgTable('league_cohorts', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  weekId: bigint('week_id', { mode: 'number' }).notNull(),
  tier: text('tier').notNull(),
  size: integer('size').notNull().default(0),
  createdAt: tstz('created_at').notNull().defaultNow(),
})

export const leagueMembers = pgTable(
  'league_members',
  {
    cohortId: bigint('cohort_id', { mode: 'number' }).notNull(),
    weekId: bigint('week_id', { mode: 'number' }).notNull(),
    userId: uuid('user_id').notNull(),
    weeklyXp: integer('weekly_xp').notNull().default(0),
    finalRank: integer('final_rank'),
    outcome: text('outcome').$type<'promote' | 'stay' | 'demote'>(),
    joinedAt: tstz('joined_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.cohortId, t.userId] })],
)

export const userLeague = pgTable('user_league', {
  userId: uuid('user_id').primaryKey(),
  tier: text('tier').notNull().default('mes'),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
})

export const questDefs = pgTable('quest_defs', {
  id: text('id').primaryKey(),
  template: text('template').notNull(),
  target: integer('target').notNull(),
  reward: integer('reward').notNull(),
  active: boolean('active').notNull().default(true),
})

export const userQuests = pgTable(
  'user_quests',
  {
    userId: uuid('user_id').notNull(),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    questId: text('quest_id').notNull(),
    progress: integer('progress').notNull().default(0),
    claimed: boolean('claimed').notNull().default(false),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.localDate, t.questId] })],
)

export const entitlements = pgTable(
  'entitlements',
  {
    userId: uuid('user_id').notNull(),
    entitlement: text('entitlement').notNull(),
    source: text('source').notNull(),
    expiresAt: tstz('expires_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.entitlement] })],
)

export const webhookEvents = pgTable('webhook_events', {
  eventId: text('event_id').primaryKey(),
  type: text('type').notNull(),
  receivedAt: tstz('received_at').notNull().defaultNow(),
})

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  endpoint: text('endpoint').notNull().unique(),
  keys: jsonb('keys').$type<{ p256dh: string; auth: string }>().notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
})

// ---------------------------------------------------------------------------------------------
// P2 speak (Wave 4) added by 20260927000000_speech_quota.sql
// ---------------------------------------------------------------------------------------------
/** Transcriptions per learner per UTC day (AppConfig.speech.dailyQuota). Never the audio. */
export const speechUsage = pgTable(
  'speech_usage',
  {
    userId: uuid('user_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    count: integer('count').notNull().default(0),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
)
