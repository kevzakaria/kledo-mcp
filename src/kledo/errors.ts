import { ZodError } from 'zod'

export type KledoErrorCode =
  | 'AUTH_INVALID'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_REQUEST_FAILED'
  | 'UPSTREAM_RESPONSE_TOO_LARGE'
  | 'UPSTREAM_TIMEOUT'
  | 'REQUEST_CANCELLED'
  | 'SCHEMA_MISMATCH'
  | 'INVALID_CURSOR'
  | 'INVALID_ARGUMENT'
  | 'AMBIGUOUS'
  | 'UNSUPPORTED_OPERATION'
  | 'INTERNAL_ERROR'

export interface PublicKledoError {
  code: KledoErrorCode
  message: string
  retryable: boolean
}

export class KledoError extends Error {
  readonly code: KledoErrorCode
  readonly retryable: boolean

  constructor(code: KledoErrorCode, message: string, retryable = false) {
    super(message)
    this.name = 'KledoError'
    this.code = code
    this.retryable = retryable
  }
}

export function errorForHttpStatus(status: number): KledoError {
  if (status === 401) return new KledoError('AUTH_INVALID', 'Kledo authentication failed')
  if (status === 403) return new KledoError('FORBIDDEN', 'Kledo denied access to this data')
  if (status === 404) return new KledoError('NOT_FOUND', 'The requested Kledo record was not found')
  if (status === 429) return new KledoError('RATE_LIMITED', 'Kledo rate limit reached', true)
  if (status === 502 || status === 503 || status === 504) {
    return new KledoError('UPSTREAM_UNAVAILABLE', 'Kledo is temporarily unavailable', true)
  }
  return new KledoError('UPSTREAM_REQUEST_FAILED', 'Kledo request failed', status >= 500)
}

export function publicKledoError(error: unknown): PublicKledoError {
  if (error instanceof KledoError) {
    return { code: error.code, message: error.message, retryable: error.retryable }
  }
  if (error instanceof ZodError) {
    return {
      code: 'SCHEMA_MISMATCH',
      message: 'Kledo returned data in an unexpected format',
      retryable: false,
    }
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'The Kledo MCP server could not complete the request',
    retryable: false,
  }
}
