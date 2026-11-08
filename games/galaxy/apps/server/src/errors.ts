import type { ApiErrorCode } from '@galaxy/shared';

/** An error that maps 1:1 to an API response `{ error: code }` with `status`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    /** Extra fields of the body (the issues of an invalid config). */
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'HttpError';
  }
}
