import type { MeResponse } from '@galaxy/shared';
import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '../api/client';

export const ME_KEY = ['me'] as const;

/** The signed-in profile, or null when there is no session (a 401 is an answer, not an error: no redirect loops). */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<MeResponse | null> => {
      try {
        return await api<MeResponse>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

export function isAdmin(me: MeResponse | null | undefined): boolean {
  return !!me && me.roles.some((r) => r === 'admin' || r === 'superadmin');
}

export function errorText(err: unknown, errors: Record<string, string>): string | null {
  if (!err) return null;
  return err instanceof ApiError ? (errors[err.code] ?? errors.internal ?? null) : (errors.internal ?? null);
}
