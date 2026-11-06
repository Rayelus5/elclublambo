import { API_ERROR_CODES, type ApiErrorCode } from '@galaxy/shared';
import { useUi } from '../state/ui';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

const KNOWN = new Set<string>(API_ERROR_CODES);

/**
 * JSON call to the game API (`/galaxy/api` + path), same-origin cookies. Errors always become ApiError with a known
 * code; a network failure or an unexpected body is `internal`. A 503 maintenance flips the global maintenance flag.
 */
export async function api<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  let res: Response;
  try {
    res = await fetch(`/galaxy/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError('internal', 0);
  }
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => undefined);
  if (res.ok) return body as T;
  const raw = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  const code = typeof raw === 'string' && KNOWN.has(raw) ? (raw as ApiErrorCode) : 'internal';
  if (code === 'maintenance') useUi.getState().setMaintenance(true);
  throw new ApiError(code, res.status);
}
