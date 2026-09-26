/**
 * Route registry: one entry per API endpoint. Route handlers are built with `withRoute(routes.x, …)`
 * and the browser client with `api.x(…)`, so both sides share one definition (ADR 0009).
 */
import type { z } from 'zod'
import * as c from './schemas'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'
/**
 * none   = public
 * user   = any signed-in user, including anonymous guests
 * member = a linked (non-anonymous) account
 * admin  = app_metadata.role === 'admin'
 * cron   = Vercel Cron secret header
 * dev    = only compiled/served in AUTH_MODE=local
 */
export type RouteAuth = 'none' | 'user' | 'member' | 'admin' | 'cron' | 'dev'
export type Phase = 'mvp' | 'p2' | 'p3'

/** The largest request body a route accepts unless it sets `maxBodyBytes` (256 KiB). */
export const DEFAULT_MAX_BODY_BYTES = 262_144

export interface RouteDef<
  Req extends z.ZodType | undefined = z.ZodType | undefined,
  Res extends z.ZodType = z.ZodType,
> {
  method: HttpMethod
  /** Path with `:param` placeholders. */
  path: string
  auth: RouteAuth
  phase: Phase
  /** Rate-limit bucket (AppConfig.rateLimits key). */
  bucket: string
  /**
   * The largest request body accepted, in bytes (default DEFAULT_MAX_BODY_BYTES). A bigger one is
   * refused with 400 `validation` before it is parsed.
   */
  maxBodyBytes?: number
  request: Req
  response: Res
}

/** Keeps each route's `auth` literal, so `withRoute` can type `ctx.user` as non-null where sign-in is required. */
function route<const A extends RouteAuth, Req extends z.ZodType | undefined, Res extends z.ZodType>(
  def: RouteDef<Req, Res> & { auth: A },
): RouteDef<Req, Res> & { auth: A } {
  return def
}

export const routes = {
  meta: route({
    method: 'GET',
    path: '/api/meta',
    auth: 'none',
    phase: 'mvp',
    bucket: 'default',
    request: undefined,
    response: c.MetaResponse,
  }),

  onboarding: route({
    method: 'POST',
    path: '/api/onboarding',
    auth: 'user',
    phase: 'mvp',
    bucket: 'default',
    request: c.OnboardingRequest,
    response: c.HomeResponse,
  }),
  home: route({
    method: 'GET',
    path: '/api/home',
    auth: 'user',
    phase: 'mvp',
    bucket: 'default',
    request: undefined,
    response: c.HomeResponse,
  }),
  path: route({
    method: 'GET',
    path: '/api/path',
    auth: 'user',
    phase: 'mvp',
    bucket: 'default',
    request: undefined,
    response: c.PathResponse,
  }),
  letters: route({
    method: 'GET',
    path: '/api/letters',
    auth: 'user',
    phase: 'mvp',
    bucket: 'default',
    request: undefined,
    response: c.LettersResponse,
  }),
  words: route({
    method: 'GET',
    path: '/api/words',
    auth: 'user',
    phase: 'mvp',
    bucket: 'default',
    request: undefined,
    response: c.WordsResponse,
  }),
  guidebook: route({
    method: 'GET',
    path: '/api/guidebooks/:unitId',
    auth: 'user',
    phase: 'mvp',
    bucket: 'default',
    request: undefined,
    response: c.GuidebookResponse,
  }),
  profile: route({
    method: 'GET',
    path: '/api/profile',
    auth: 'user',
    phase: 'mvp',
    bucket: 'default',
    request: undefined,
    response: c.ProfileResponse,
  }),
  updateProfile: route({
    method: 'PATCH',
    path: '/api/profile',
    auth: 'user',
    phase: 'mvp',
    bucket: 'default',
    request: c.ProfilePatch,
    response: c.ProfileResponse,
  }),
  settings: route({
    method: 'GET',
    path: '/api/settings',
    auth: 'user',
    phase: 'mvp',
    bucket: 'default',
    request: undefined,
    response: c.Settings,
  }),
  updateSettings: route({
    method: 'PATCH',
    path: '/api/settings',
    auth: 'user',
    phase: 'mvp',
    bucket: 'default',
    request: c.SettingsPatch,
    response: c.Settings,
  }),

  createSession: route({
    method: 'POST',
    path: '/api/sessions',
    auth: 'user',
    phase: 'mvp',
    bucket: 'sessions',
    request: c.CreateSessionRequest,
    response: c.CreateSessionResponse,
  }),
  sessionEvent: route({
    method: 'POST',
    path: '/api/sessions/:id/events',
    auth: 'user',
    phase: 'mvp',
    bucket: 'events',
    request: c.SessionEventRequest,
    response: c.SessionEventResponse,
  }),
  completeSession: route({
    method: 'POST',
    path: '/api/sessions/:id/complete',
    auth: 'user',
    phase: 'mvp',
    bucket: 'complete',
    request: c.CompleteSessionRequest,
    response: c.SessionResult,
  }),

  mergeAccount: route({
    method: 'POST',
    path: '/api/account/merge',
    auth: 'member',
    phase: 'mvp',
    bucket: 'auth',
    request: c.MergeRequest,
    response: c.MergeResponse,
  }),
  /** Reads every row of the learner's: its own, much smaller rate-limit bucket. */
  exportAccount: route({
    method: 'GET',
    path: '/api/account/export',
    auth: 'user',
    phase: 'mvp',
    bucket: 'export',
    request: undefined,
    response: c.ExportResponse,
  }),
  deleteAccount: route({
    method: 'DELETE',
    path: '/api/account',
    auth: 'user',
    phase: 'mvp',
    bucket: 'auth',
    request: undefined,
    response: c.DeleteAccountResponse,
  }),

  createReport: route({
    method: 'POST',
    path: '/api/reports',
    auth: 'user',
    phase: 'mvp',
    bucket: 'reports',
    request: c.CreateReportRequest,
    response: c.CreateReportResponse,
  }),
  adminReports: route({
    method: 'GET',
    path: '/api/admin/reports',
    auth: 'admin',
    phase: 'mvp',
    bucket: 'default',
    request: undefined,
    response: c.AdminReportsResponse,
  }),
  adminUpdateReport: route({
    method: 'PATCH',
    path: '/api/admin/reports/:id',
    auth: 'admin',
    phase: 'mvp',
    bucket: 'default',
    request: c.AdminReportPatch,
    response: c.ReportDto,
  }),

  // --- P2 engagement (Wave 3). The learner routes answer 404 `not_found` while their feature
  // flag is off (leaderboard: leagues; quests: quests; shop, purchase, refillLives: shop;
  // practice: practiceHub). The rollover cron runs regardless: it is idempotent and has nothing
  // to close while nobody has joined a league.
  leaderboard: route({
    method: 'GET',
    path: '/api/leaderboard',
    auth: 'member',
    phase: 'p2',
    bucket: 'default',
    request: undefined,
    response: c.LeaderboardResponse,
  }),
  quests: route({
    method: 'GET',
    path: '/api/quests',
    auth: 'user',
    phase: 'p2',
    bucket: 'default',
    request: undefined,
    response: c.QuestsResponse,
  }),
  shop: route({
    method: 'GET',
    path: '/api/shop',
    auth: 'user',
    phase: 'p2',
    bucket: 'default',
    request: undefined,
    response: c.ShopResponse,
  }),
  purchase: route({
    method: 'POST',
    path: '/api/shop/purchase',
    auth: 'user',
    phase: 'p2',
    bucket: 'shop',
    request: c.PurchaseRequest,
    response: c.PurchaseResponse,
  }),
  refillLives: route({
    method: 'POST',
    path: '/api/lives/refill',
    auth: 'user',
    phase: 'p2',
    bucket: 'shop',
    request: c.RefillLivesRequest,
    response: c.PurchaseResponse,
  }),
  practice: route({
    method: 'GET',
    path: '/api/practice',
    auth: 'user',
    phase: 'p2',
    bucket: 'default',
    request: undefined,
    response: c.PracticeResponse,
  }),
  /** Vercel Cron sends GET with `Authorization: Bearer $CRON_SECRET` (apps/web/vercel.json). */
  leagueRollover: route({
    method: 'GET',
    path: '/api/cron/league-rollover',
    auth: 'cron',
    phase: 'p2',
    bucket: 'cron',
    request: undefined,
    response: c.LeagueRolloverResponse,
  }),

  // --- P2 Wave 4: speak (stories play through the session routes). transcribe answers 404
  // `not_found` while flags.speak is off, and 503 `unavailable` while a server secret or the
  // transcription provider is missing.
  /**
   * One recording of a speak challenge in the caller's open session → transcript + signed token.
   * 404 (flag off, or not your session); 400 (not a speak challenge, audio too big or too long);
   * 409 (session completed); 410 (expired); 429 (`rate_limited`, or `quota_exceeded` for the
   * day); 503.
   */
  transcribe: route({
    method: 'POST',
    path: '/api/speech/transcribe',
    auth: 'user',
    phase: 'p2',
    bucket: 'speech',
    // The base64 audio alone may be 700 000 characters (TranscribeRequest).
    maxBodyBytes: 1_048_576,
    request: c.TranscribeRequest,
    response: c.TranscribeResponse,
  }),

  devAnonymous: route({
    method: 'POST',
    path: '/api/dev/auth/anonymous',
    auth: 'dev',
    phase: 'mvp',
    bucket: 'auth',
    request: undefined,
    response: c.DevTokenResponse,
  }),
  devSignIn: route({
    method: 'POST',
    path: '/api/dev/auth/sign-in',
    auth: 'dev',
    phase: 'mvp',
    bucket: 'auth',
    request: c.DevSignInRequest,
    response: c.DevTokenResponse,
  }),
  devLink: route({
    method: 'POST',
    path: '/api/dev/auth/link',
    auth: 'dev',
    phase: 'mvp',
    bucket: 'auth',
    request: c.DevLinkRequest,
    response: c.DevTokenResponse,
  }),
  devAdmin: route({
    method: 'POST',
    path: '/api/dev/auth/admin',
    auth: 'dev',
    phase: 'mvp',
    bucket: 'auth',
    request: undefined,
    response: c.DevTokenResponse,
  }),
  devRefresh: route({
    method: 'POST',
    path: '/api/dev/auth/refresh',
    auth: 'dev',
    phase: 'mvp',
    bucket: 'auth',
    request: c.DevRefreshRequest,
    response: c.DevTokenResponse,
  }),
} as const

export type Routes = typeof routes
export type RouteName = keyof Routes
export type RouteRequest<N extends RouteName> = Routes[N]['request'] extends z.ZodType
  ? z.input<Routes[N]['request']>
  : undefined
export type RouteResponse<N extends RouteName> = z.output<Routes[N]['response']>

/** Fills `:param` placeholders. */
export function buildPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([a-zA-Z]+)/g, (_, k: string) => {
    const v = params[k]
    if (v === undefined) throw new Error(`missing path param ${k} for ${path}`)
    return encodeURIComponent(v)
  })
}
