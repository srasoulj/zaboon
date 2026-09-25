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
  exportAccount: route({
    method: 'GET',
    path: '/api/account/export',
    auth: 'user',
    phase: 'mvp',
    bucket: 'default',
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
