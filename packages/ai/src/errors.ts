/** Errors thrown by @zaboon/ai. Messages never include the API key or request headers. */

export class BudgetExceededError extends Error {
  override name = 'BudgetExceededError'
}

/**
 * A non-2xx HTTP response from OpenRouter (after retries, for retryable statuses), or a 2xx whose
 * body is an error object (`inOkResponse`: e.g. a provider that failed mid-answer, which may have
 * been billed).
 */
export class AiHttpError extends Error {
  override name = 'AiHttpError'
  constructor(
    readonly status: number,
    /** The first part of the response body (OpenRouter error JSON), for diagnostics. */
    readonly body: string,
    /** True when the error came inside a 2xx response rather than as the HTTP status. */
    readonly inOkResponse = false,
  ) {
    super(`OpenRouter HTTP ${status}: ${body.slice(0, 300)}`)
  }
}

/** The request did not finish within the transport timeout (after retries). */
export class AiTimeoutError extends Error {
  override name = 'AiTimeoutError'
}

/** The model's answer could not be used (not JSON, failed schema validation, no image/audio). */
export class AiResponseError extends Error {
  override name = 'AiResponseError'
  constructor(
    message: string,
    readonly raw?: string,
  ) {
    super(message)
  }
}
