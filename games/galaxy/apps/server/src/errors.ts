import type { ApiErrorCode } from '@galaxy/shared';

/** An error that maps 1:1 to an API response `{ error: code }` with `status`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
  ) {
    super(code);
    this.name = 'HttpError';
  }
}
