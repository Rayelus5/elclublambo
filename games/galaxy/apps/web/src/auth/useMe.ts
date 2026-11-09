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

/** Staff: admins, superadmins and moderators (who reach only the panel's Moderación). */
export function isStaff(me: MeResponse | null | undefined): boolean {
  return !!me && me.roles.some((r) => r === 'moderator' || r === 'admin' || r === 'superadmin');
}

/** A message is a text, or a text made from the error's details (a live value the server sent with it). */
type Message = string | ((details: Record<string, unknown>) => string);

export function errorText(err: unknown, errors: Record<string, Message>): string | null {
  if (!err) return null;
  const pick = (m: Message | undefined, details: Record<string, unknown>) => (typeof m === 'function' ? m(details) : (m ?? null));
  if (!(err instanceof ApiError)) return pick(errors.internal, {});
  return pick(errors[err.code], err.details) ?? pick(errors.internal, {});
}
