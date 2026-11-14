// Registered error codes. Every failure a client sees carries one of these.
export const errorStatus = {
  not_found: 404,
  invalid_input: 400,
  unauthorized: 401,
  stale_revision: 409,
  worker_error: 500,
  worker_timeout: 504,
  unsupported: 501,
  upstream_fetch_failed: 502,
  rate_limited: 429,
  payload_too_large: 413,
} as const;

export type ErrorCode = keyof typeof errorStatus;

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
  get status(): number {
    return errorStatus[this.code];
  }
}

export function isErrorCode(code: unknown): code is ErrorCode {
  return typeof code === "string" && Object.hasOwn(errorStatus, code);
}
