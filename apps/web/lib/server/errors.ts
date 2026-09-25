import { ERROR_STATUS, type ErrorCode, type ErrorEnvelope } from '@zaboon/contracts'

/** An error with a contract error code; `withRoute` turns it into the error envelope. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly headers: Record<string, string> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }

  get status(): number {
    return ERROR_STATUS[this.code]
  }
}

export function errorResponse(err: ApiError): Response {
  const body: ErrorEnvelope = {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details === undefined ? {} : { details: err.details }),
    },
  }
  return Response.json(body, {
    status: err.status,
    headers: { 'cache-control': 'no-store', ...err.headers },
  })
}
